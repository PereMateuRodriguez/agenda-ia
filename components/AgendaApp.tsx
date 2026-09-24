"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Calendar, CalendarError, eventSchema, MAX_EVENTS, type CalendarEvent, type NewEvent } from "@/lib/calendar";
import { streamChat } from "@/lib/client";
import { icsFileName, toICS } from "@/lib/ics";
import { newId } from "@/lib/ids";
import { MAX_HISTORY, type ProviderStatus } from "@/lib/protocol";
import { sampleEvents } from "@/lib/samples";
import { load, save } from "@/lib/storage";
import { addDays, dateOf, MESES, nowIn, startOfWeek, type LocalDate, type LocalDateTime } from "@/lib/time";
import Chat, { type UiMessage } from "./Chat";
import DayList from "./DayList";
import EventDialog, { type EditorState } from "./EventDialog";
import WeekView from "./WeekView";

const STORAGE_KEY = "agenda-ia:v1";
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
  const [tab, setTab] = useState<"agenda" | "asistente">("agenda");
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

  const exportIcs = () => {
    const blob = new Blob([toICS(events)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(dateOf(now));
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const resetAgenda = () => {
    if (!window.confirm("¿Borrar todos los eventos y la conversación? Se volverá a la agenda de ejemplo.")) return;
    abortRef.current?.abort();
    setEvents(sampleEvents(nowIn(timeZone)));
    setMessages([]);
    setUndoableId(null);
  };

  const today = dateOf(now);
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

      {/* En pantallas estrechas, agenda y asistente van en pestañas. */}
      <div className="flex border-b border-white/10 lg:hidden" role="tablist">
        {(["agenda", "asistente"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 font-mono text-xs uppercase tracking-[0.2em] ${
              tab === t ? "border-b-2 border-neon-cyan text-neon-cyan" : "text-zinc-500"
            }`}
          >
            {t}
          </button>
        ))}
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
          className={`min-h-0 border-white/10 bg-carbon-900/60 lg:border-l ${tab === "asistente" ? "block" : "hidden"} lg:block`}
        >
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
      </main>

      <EventDialog state={editor} onClose={() => setEditor(null)} onSubmit={submitEvent} onDelete={deleteEvent} />
    </div>
  );
}
