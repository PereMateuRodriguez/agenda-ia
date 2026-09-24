"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Calendar, CalendarError, eventSchema, MAX_EVENTS, type CalendarEvent, type NewEvent } from "@/lib/calendar";
import { streamChat, streamInforme } from "@/lib/client";
import { huella, type Periodo } from "@/lib/diario";
import { download } from "@/lib/download";
import { icsFileName, toICS } from "@/lib/ics";
import {
  ALMACEN_VACIO,
  almacenSchema,
  avisoPendiente,
  claveInforme,
  desactualizado,
  diarioEnMarkdown,
  guardarInforme,
  nombreArchivo,
  nuevoGuardado,
  peticionInforme,
  type Almacen,
  type InformeGuardado,
} from "@/lib/informes-guardados";
import { newId } from "@/lib/ids";
import { MAX_HISTORY, type ProviderStatus } from "@/lib/protocol";
import { sampleEvents } from "@/lib/samples";
import { load, save } from "@/lib/storage";
import { addDays, dateOf, MESES, nowIn, startOfWeek, type LocalDate, type LocalDateTime } from "@/lib/time";
import Chat, { type UiMessage } from "./Chat";
import DayList from "./DayList";
import Diario from "./Diario";
import EventDialog, { type EditorState } from "./EventDialog";
import InformeDialog from "./InformeDialog";
import WeekView from "./WeekView";

const STORAGE_KEY = "agenda-ia:v1";
/**
 * El diario va en su propia clave: es lo único que no se puede rehacer. Así
 * «Reiniciar» —que vuelve a la agenda de ejemplo— no lo toca, y una agenda
 * corrupta no se lo lleva por delante al validarla.
 */
const DIARIO_KEY = "agenda-ia:diario:v1";
const STORED_MESSAGES = 60;
const storedEventsSchema = z.array(eventSchema).max(MAX_EVENTS);
const REPO_URL = "https://github.com/PereMateuRodriguez/agenda-ia";

interface Stored {
  events: CalendarEvent[];
  messages: UiMessage[];
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  } catch {
    return "Europe/Madrid";
  }
}

function weekLabel(weekStart: LocalDate): string {
  const end = addDays(weekStart, 6);
  const [d1, m1, y1] = [Number(weekStart.slice(8)), Number(weekStart.slice(5, 7)), weekStart.slice(0, 4)];
  const [d2, m2, y2] = [Number(end.slice(8)), Number(end.slice(5, 7)), end.slice(0, 4)];
  const mes = (m: number) => MESES[m - 1].slice(0, 3);
  if (y1 !== y2) return `${d1} ${mes(m1)} ${y1} – ${d2} ${mes(m2)} ${y2}`;
  if (m1 !== m2) return `${d1} ${mes(m1)} – ${d2} ${mes(m2)} ${y2}`;
  return `${d1} – ${d2} ${MESES[m1 - 1]} ${y2}`;
}

/** Qué eventos son nuevos o han cambiado, para iluminarlos. */
function changedIds(before: CalendarEvent[], after: CalendarEvent[]): string[] {
  const old = new Map(before.map((e) => [e.id, JSON.stringify(e)]));
  return after.filter((e) => old.get(e.id) !== JSON.stringify(e)).map((e) => e.id);
}

export default function AgendaApp() {
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [timeZone, setTimeZone] = useState("Europe/Madrid");
  const [now, setNow] = useState<LocalDateTime>("2026-01-01T00:00");
  const [weekStart, setWeekStart] = useState<LocalDate>("2025-12-29");
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ProviderStatus | { error: string } | null>(null);
  // En móvil se ve una columna u otra; en escritorio, las dos. La de la
  // derecha es el asistente o el diario.
  const [tab, setTab] = useState<"agenda" | "panel">("agenda");
  const [panel, setPanel] = useState<"asistente" | "diario">("asistente");
  const [almacen, setAlmacen] = useState<Almacen>(ALMACEN_VACIO);
  const [diarioGuardado, setDiarioGuardado] = useState(true);
  const [generando, setGenerando] = useState<{ clave: string; progreso: string } | null>(null);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);
  const [viendo, setViendo] = useState<InformeGuardado | null>(null);
  const informeAbort = useRef<AbortController | null>(null);
  /** Lo último que hay en el navegador, para no reescribirlo si no ha cambiado nada. */
  const diarioEnDisco = useRef<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [undoableId, setUndoableId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Todo depende de la hora y del almacenamiento del navegador, así que la
  // agenda se monta en el cliente; el servidor solo pinta el armazón.
  useEffect(() => {
    const tz = localTimeZone();
    const current = nowIn(tz);
    setTimeZone(tz);
    setNow(current);
    setWeekStart(startOfWeek(dateOf(current)));

    // Lo guardado se valida igual que lo que llega al servidor: una agenda
    // corrupta rompería cada petición con un 400 sin que se entendiera por qué.
    const stored = load<Stored>(STORAGE_KEY);
    const storedEvents = storedEventsSchema.safeParse(stored?.events);
    if (stored && storedEvents.success) {
      setEvents(storedEvents.data);
      // Una respuesta que se quedó a medias al cerrar la pestaña ya no va a llegar.
      setMessages(
        (stored.messages ?? []).map((m) =>
          m.role === "assistant" && m.status === "pending"
            ? { ...m, status: "error", content: "Se interrumpió al recargar la página." }
            : m,
        ),
      );
    } else {
      setEvents(sampleEvents(current));
    }
    // Si lo guardado no pasa la validación no se pisa: se deja en el
    // navegador tal cual, por si se puede recuperar a mano, y se empieza en
    // blanco sin escribir encima hasta que haya algo nuevo.
    const storedDiario = almacenSchema.safeParse(load(DIARIO_KEY));
    const inicial = storedDiario.success ? storedDiario.data : ALMACEN_VACIO;
    setAlmacen(inicial);
    diarioEnDisco.current = JSON.stringify(inicial);
    setReady(true);

    const tick = setInterval(() => setNow(nowIn(tz)), 30_000);
    return () => clearInterval(tick);
  }, []);

  // Se guarda la conversación reciente, sin la copia de la agenda que lleva
  // cada respuesta para deshacerla: tras recargar ya no se ofrece deshacer, y
  // con muchos mensajes esas copias llenarían el almacenamiento.
  useEffect(() => {
    if (!ready) return;
    const recent = messages.slice(-STORED_MESSAGES).map((m) => {
      if (m.role !== "assistant" || !m.before) return m;
      const { before: _before, ...rest } = m;
      return rest;
    });
    save(STORAGE_KEY, { events, messages: recent } satisfies Stored);
  }, [ready, events, messages]);

  // Se escribe a cada tecla, así que se espera un momento antes de guardar:
  // serializar el diario entero en cada pulsación es trabajo tirado.
  useEffect(() => {
    if (!ready) return;
    const json = JSON.stringify(almacen);
    if (json === diarioEnDisco.current) return;
    const t = setTimeout(() => {
      const ok = save(DIARIO_KEY, almacen);
      if (ok) diarioEnDisco.current = json;
      setDiarioGuardado(ok);
    }, 400);
    return () => clearTimeout(t);
  }, [ready, almacen]);

  useEffect(() => {
    fetch("/api/estado")
      .then((r) => r.json())
      .then((data: ProviderStatus | { error: string }) => setStatus(data))
      .catch(() => setStatus({ error: "No se puede contactar con el servidor." }));
  }, []);

  /** Ilumina los eventos que han cambiado y, si caen en otra semana, va a esa semana. */
  const reveal = useCallback((ids: string[], list: CalendarEvent[]) => {
    setHighlight(new Set(ids));
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHighlight(new Set()), 2600);
    const first = list.find((e) => e.id === ids[0]);
    if (first) setWeekStart(startOfWeek(dateOf(first.start)));
  }, []);

  const updateAssistant = (id: string, patch: (m: Extract<UiMessage, { role: "assistant" }>) => UiMessage) =>
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === "assistant" ? patch(m) : m)));

  const send = async (text: string) => {
    if (busy) return;
    const before = events;
    const history = messages
      .filter((m) => m.role === "user" || m.status === "done")
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
    const userId = newId("msg");
    const assistantId = newId("msg");
    setMessages((ms) => [
      ...ms,
      { id: userId, role: "user", content: text },
      { id: assistantId, role: "assistant", content: "", steps: [], status: "pending" },
    ]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const out = await streamChat(
        { message: text, history, events: before, now: nowIn(timeZone), timeZone },
        (step) => updateAssistant(assistantId, (m) => ({ ...m, steps: [...m.steps, step] })),
        controller.signal,
      );
      setEvents(out.events);
      updateAssistant(assistantId, (m) => ({
        ...m,
        status: "done",
        content: out.reply,
        ...(out.changed ? { before } : {}),
      }));
      if (out.changed) {
        setUndoableId(assistantId);
        reveal(changedIds(before, out.events), out.events);
      }
    } catch (err) {
      updateAssistant(assistantId, (m) => ({
        ...m,
        status: "error",
        content: err instanceof Error ? err.message : "Error desconocido.",
      }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const undo = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (!message || message.role !== "assistant" || !message.before) return;
    setEvents(message.before);
    updateAssistant(messageId, (m) => ({ ...m, undone: true }));
    setUndoableId(null);
    reveal(changedIds(events, message.before), message.before);
  };

  const submitEvent = (draft: NewEvent, id?: string): string | null => {
    const calendar = new Calendar(events, () => newId("ev"));
    try {
      const { event } = id ? calendar.update(id, draft) : calendar.create(draft);
      setEvents(calendar.all());
      // Un cambio a mano después de la respuesta invalida su «deshacer».
      setUndoableId(null);
      setEditor(null);
      reveal([event.id], calendar.all());
      return null;
    } catch (err) {
      if (err instanceof CalendarError) return err.message;
      throw err;
    }
  };

  const deleteEvent = (id: string) => {
    setEvents((es) => es.filter((e) => e.id !== id));
    setUndoableId(null);
    setEditor(null);
  };

  const exportIcs = () => download(icsFileName(dateOf(now)), toICS(events), "text/calendar;charset=utf-8");

  const resetAgenda = () => {
    if (!window.confirm("¿Borrar todos los eventos y la conversación? Se volverá a la agenda de ejemplo.")) return;
    abortRef.current?.abort();
    setEvents(sampleEvents(nowIn(timeZone)));
    setMessages([]);
    setUndoableId(null);
  };

  const today = dateOf(now);

  const escribir = (fecha: LocalDate, texto: string) =>
    setAlmacen((a) => {
      const diario = { ...a.diario };
      if (texto.trim() === "") delete diario[fecha];
      else diario[fecha] = texto;
      return { ...a, diario };
    });

  const generarInforme = async (periodo: Periodo) => {
    if (generando) return;
    setPanel("diario");
    setErrorInforme(null);
    setGenerando({ clave: claveInforme(periodo), progreso: "Preparando…" });
    // La huella se toma de lo que se envía: si se sigue escribiendo mientras
    // el modelo trabaja, el informe tiene que quedar como desactualizado.
    const { diario, informes } = almacen;
    const enviada = huella(diario, periodo);
    const controller = new AbortController();
    informeAbort.current = controller;
    try {
      const informe = await streamInforme(
        peticionInforme(periodo, diario, events, today, informes),
        (progreso) => setGenerando({ clave: claveInforme(periodo), progreso }),
        controller.signal,
      );
      const guardado = nuevoGuardado(periodo, informe, enviada, nowIn(timeZone));
      setAlmacen((a) => ({ ...a, informes: guardarInforme(a.informes, guardado) }));
      setViendo(guardado);
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorInforme(err instanceof Error ? err.message : "Error desconocido.");
      }
    } finally {
      setGenerando(null);
      informeAbort.current = null;
    }
  };

  const borrarInforme = (informe: InformeGuardado) => {
    if (!window.confirm("¿Borrar este informe? El diario no se toca.")) return;
    setAlmacen((a) => ({ ...a, informes: a.informes.filter((i) => claveInforme(i) !== claveInforme(informe)) }));
  };

  const aviso = ready ? avisoPendiente(today, almacen.diario, almacen.informes, almacen.avisoDescartado) : null;
  const openCreate = (start?: LocalDateTime) =>
    setEditor({
      mode: "create",
      start: start ?? `${today}T${String(Math.min(Number(now.slice(11, 13)) + 1, 23)).padStart(2, "0")}:00`,
    });

  const navButton =
    "rounded-full border border-white/10 px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-neon-cyan/50 hover:text-neon-cyan disabled:opacity-40";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-white/10 px-4 py-3 md:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-lg font-bold tracking-tight text-white">
            agenda<span className="text-neon-cyan">·</span>ia
          </h1>
          <a
            href={REPO_URL}
            className="hidden font-mono text-[11px] text-zinc-500 transition-colors hover:text-neon-cyan sm:inline"
          >
            código en GitHub ↗
          </a>
        </div>

        {ready && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={navButton}
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              aria-label="Semana anterior"
            >
              ‹
            </button>
            <button type="button" className={navButton} onClick={() => setWeekStart(startOfWeek(today))}>
              Hoy
            </button>
            <button
              type="button"
              className={navButton}
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              aria-label="Semana siguiente"
            >
              ›
            </button>
            <span className="min-w-40 px-2 font-display text-sm font-medium text-zinc-200" aria-live="polite">
              {weekLabel(weekStart)}
            </span>
          </div>
        )}

        {ready && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={navButton} onClick={() => openCreate()} disabled={busy}>
              + Evento
            </button>
            <button
              type="button"
              className={navButton}
              onClick={exportIcs}
              title="Para importarla en Google Calendar, Outlook o el móvil"
            >
              Exportar .ics
            </button>
            <button type="button" className={navButton} onClick={resetAgenda}>
              Reiniciar
            </button>
          </div>
        )}
      </header>

      {/* En pantallas estrechas, agenda, asistente y diario van en pestañas. */}
      <div className="flex border-b border-white/10 lg:hidden" role="tablist">
        {(["agenda", "asistente", "diario"] as const).map((t) => {
          const selected = t === "agenda" ? tab === "agenda" : tab === "panel" && panel === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                if (t === "agenda") setTab("agenda");
                else {
                  setTab("panel");
                  setPanel(t);
                }
              }}
              className={`relative flex-1 py-2.5 font-mono text-xs uppercase tracking-[0.2em] ${
                selected ? "border-b-2 border-neon-cyan text-neon-cyan" : "text-zinc-500"
              }`}
            >
              {t}
              {t === "diario" && aviso && <AvisoPunto />}
            </button>
          );
        })}
      </div>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className={`min-h-0 overflow-hidden ${tab === "agenda" ? "block" : "hidden"} lg:block`}>
          {ready ? (
            <>
              <div className="hidden h-full md:block">
                <WeekView
                  weekStart={weekStart}
                  events={events}
                  now={now}
                  highlight={highlight}
                  disabled={busy}
                  onOpenEvent={(event) => setEditor({ mode: "edit", event })}
                  onCreateAt={openCreate}
                />
              </div>
              <div className="h-full overflow-y-auto md:hidden">
                <DayList
                  weekStart={weekStart}
                  events={events}
                  now={now}
                  highlight={highlight}
                  disabled={busy}
                  onOpenEvent={(event) => setEditor({ mode: "edit", event })}
                />
              </div>
            </>
          ) : (
            <p className="p-6 font-mono text-xs text-zinc-600">Cargando la agenda…</p>
          )}
        </div>

        <div
          className={`min-h-0 flex-col border-white/10 bg-carbon-900/60 lg:flex lg:border-l ${tab === "panel" ? "flex" : "hidden"}`}
        >
          <div className="hidden border-b border-white/10 lg:flex" role="tablist" aria-label="Panel">
            {(["asistente", "diario"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={panel === p}
                onClick={() => setPanel(p)}
                className={`relative flex-1 py-2.5 font-mono text-xs uppercase tracking-[0.2em] ${
                  panel === p ? "border-b-2 border-neon-cyan text-neon-cyan" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p}
                {p === "diario" && aviso && <AvisoPunto />}
              </button>
            ))}
          </div>

          {/* Los dos se quedan montados y solo se ocultan: cambiar de pestaña
              no puede llevarse lo que se estaba escribiendo. */}
          <div className={`min-h-0 flex-1 ${panel === "asistente" ? "block" : "hidden"}`}>
            <Chat
              messages={messages}
              busy={busy || !ready}
              status={status}
              undoableId={undoableId}
              onSend={(t) => void send(t)}
              onUndo={undo}
              onClear={() => {
                setMessages([]);
                setUndoableId(null);
              }}
            />
          </div>
          <div className={`min-h-0 flex-1 ${panel === "diario" ? "block" : "hidden"}`}>
            {ready && (
              <Diario
                weekStart={weekStart}
                today={today}
                diario={almacen.diario}
                guardado={diarioGuardado}
                informes={almacen.informes}
                aviso={aviso}
                generando={generando}
                error={errorInforme}
                status={status}
                onEscribir={escribir}
                onGenerar={(periodo) => void generarInforme(periodo)}
                onVer={setViendo}
                onBorrarInforme={borrarInforme}
                onCancelar={() => informeAbort.current?.abort()}
                onDescartarAviso={() => aviso && setAlmacen((a) => ({ ...a, avisoDescartado: aviso.desde }))}
                onExportarDiario={() =>
                  download(`diario-${today}.md`, diarioEnMarkdown(almacen.diario), "text/markdown;charset=utf-8")
                }
              />
            )}
          </div>
        </div>
      </main>

      <EventDialog state={editor} onClose={() => setEditor(null)} onSubmit={submitEvent} onDelete={deleteEvent} />
      <InformeDialog
        informe={viendo}
        desactualizado={viendo ? desactualizado(viendo, almacen.diario) : false}
        puedeRehacer={generando === null}
        onClose={() => setViendo(null)}
        onExportar={(i) => download(nombreArchivo(i), i.markdown, "text/markdown;charset=utf-8")}
        onRehacer={(i) => {
          setViendo(null);
          void generarInforme({ tipo: i.tipo, desde: i.desde, hasta: i.hasta });
        }}
      />
    </div>
  );
}

/** Un punto en la pestaña del diario cuando hay un informe que ofrecer. */
function AvisoPunto() {
  return (
    <>
      <span className="absolute ml-1 h-1.5 w-1.5 rounded-full bg-neon-emerald" aria-hidden="true" />
      <span className="sr-only"> (hay un informe pendiente)</span>
    </>
  );
}
