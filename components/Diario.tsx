"use client";

import { useEffect, useState } from "react";
import { MAX_ENTRADA, mesDe, semanaDe, tituloPeriodo, type Diario as DiarioData, type Periodo } from "@/lib/diario";
import { buscarInforme, claveInforme, desactualizado, hayDiario, type InformeGuardado } from "@/lib/informes-guardados";
import type { ProviderStatus } from "@/lib/protocol";
import { addDays, DIAS_CORTOS, longDay, weekdayIndex, type LocalDate } from "@/lib/time";

interface Props {
  /** La semana que se está viendo en la agenda: el diario sigue a la agenda. */
  weekStart: LocalDate;
  today: LocalDate;
  diario: DiarioData;
  /** Si la última escritura en el navegador ha ido bien. */
  guardado: boolean;
  informes: InformeGuardado[];
  aviso: Periodo | null;
  generando: { clave: string; progreso: string } | null;
  error: string | null;
  status: ProviderStatus | { error: string } | null;
  onEscribir: (fecha: LocalDate, texto: string) => void;
  onGenerar: (periodo: Periodo) => void;
  onVer: (informe: InformeGuardado) => void;
  onBorrarInforme: (informe: InformeGuardado) => void;
  /** Para un informe en marcha: con un modelo local en CPU, un mensual puede tardar minutos. */
  onCancelar: () => void;
  onDescartarAviso: () => void;
  onExportarDiario: () => void;
}

const pequeno =
  "rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-neon-cyan/50 hover:text-neon-cyan disabled:pointer-events-none disabled:opacity-40";
const kicker = "font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500";

/** "21 – 27 sep" */
function rangoCorto(p: Periodo): string {
  const mes = (d: LocalDate) =>
    ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(d.slice(5, 7)) - 1];
  const [d1, d2] = [Number(p.desde.slice(8)), Number(p.hasta.slice(8))];
  return p.desde.slice(5, 7) === p.hasta.slice(5, 7)
    ? `${d1} – ${d2} ${mes(p.hasta)}`
    : `${d1} ${mes(p.desde)} – ${d2} ${mes(p.hasta)}`;
}

export default function Diario(props: Props) {
  const { weekStart, today, diario, informes, generando, status } = props;
  const [dia, setDia] = useState<LocalDate>(today);
  const [mes, setMes] = useState<LocalDate>(mesDe(today).desde);

  // Al cambiar de semana en la agenda, el diario va con ella: hoy si está en
  // esa semana y, si no, el mismo día de la semana que había elegido.
  useEffect(() => {
    const fin = addDays(weekStart, 6);
    setDia((actual) => (today >= weekStart && today <= fin ? today : addDays(weekStart, weekdayIndex(actual))));
  }, [weekStart, today]);

  const texto = diario[dia] ?? "";
  const esFuturo = dia > today;
  const semana = semanaDe(weekStart);
  const periodoMes = mesDe(mes);
  const mesSiguiente = addDays(periodoMes.hasta, 1);
  const modelo = status && !("error" in status) ? status.label : null;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Diario">
      <header className="border-b border-white/10 px-5 py-4">
        <h2 className="font-display text-lg font-bold text-white">Diario</h2>
        <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
          Cuenta cada día qué has hecho; los informes salen de aquí.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <div className="space-y-3">
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Día del diario">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
              const elegido = d === dia;
              const escrito = (diario[d] ?? "").trim() !== "";
              const futuro = d > today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDia(d)}
                  disabled={futuro}
                  aria-pressed={elegido}
                  aria-label={`${longDay(d)}${d === today ? ", hoy" : ""}${escrito ? ", con diario" : ""}`}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border py-1.5 transition-colors disabled:opacity-30 ${
                    elegido
                      ? "border-neon-cyan/60 bg-neon-cyan/15 text-cyan-50"
                      : "border-white/5 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase">{DIAS_CORTOS[weekdayIndex(d)]}</span>
                  <span className={`text-sm font-semibold ${d === today ? "text-neon-cyan" : ""}`}>
                    {Number(d.slice(8))}
                  </span>
                  <span
                    className={`h-1 w-1 rounded-full ${escrito ? "bg-neon-emerald" : "bg-transparent"}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="diario-texto" className="block font-display text-sm font-medium text-zinc-200">
              {dia === today ? "¿Qué has hecho hoy?" : `¿Qué hiciste el ${longDay(dia)}?`}
            </label>
            <textarea
              id="diario-texto"
              value={texto}
              maxLength={MAX_ENTRADA}
              disabled={esFuturo}
              rows={7}
              onChange={(e) => props.onEscribir(dia, e.target.value)}
              placeholder="Lo que has hecho, lo que se ha atascado, lo que queda pendiente…"
              className="w-full resize-y rounded-xl border border-white/10 bg-carbon-900 px-3 py-2.5 text-base leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-neon-cyan/60 focus:outline-none sm:text-sm"
            />
            <p className="flex justify-between gap-3 font-mono text-[11px] text-zinc-500">
              {props.guardado ? (
                <span>Se guarda solo en este navegador.</span>
              ) : (
                <span className="text-red-300" role="alert">
                  No se ha podido guardar: este navegador no deja escribir.
                </span>
              )}
              <span className={texto.length >= MAX_ENTRADA ? "text-amber-200" : ""}>
                {texto.length} / {MAX_ENTRADA}
              </span>
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className={kicker}>Informes</h3>

          {props.aviso && !generando && (
            <div className="rounded-xl border border-neon-emerald/25 bg-neon-emerald/5 p-3 text-sm text-zinc-200">
              <p>La semana del {rangoCorto(props.aviso)} tiene diario y no tiene informe.</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className={pequeno}
                  onClick={() => props.aviso && props.onGenerar(props.aviso)}
                  aria-label={`Escribir el informe de la semana ${rangoCorto(props.aviso)}`}
                >
                  Escribir el informe
                </button>
                <button type="button" className={pequeno} onClick={props.onDescartarAviso}>
                  Ahora no
                </button>
              </div>
            </div>
          )}

          <FilaPeriodo
            etiqueta="Semana"
            titulo={rangoCorto(semana)}
            nombre={`de la semana ${rangoCorto(semana)}`}
            periodo={semana}
            {...props}
          />
          <FilaPeriodo
            etiqueta="Mes"
            titulo={tituloPeriodo(periodoMes)}
            nombre={`de ${tituloPeriodo(periodoMes).toLowerCase()}`}
            periodo={periodoMes}
            navegar={{
              anterior: () => setMes(mesDe(addDays(mes, -1)).desde),
              siguiente: mesSiguiente <= today ? () => setMes(mesSiguiente) : undefined,
            }}
            {...props}
          />

          {props.error && (
            <p
              role="alert"
              className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
            >
              {props.error}
            </p>
          )}

          {informes.length > 0 && <h4 className={`${kicker} pt-2`}>Guardados</h4>}
          {informes.length > 0 && (
            <ul className="space-y-1" aria-label="Informes guardados">
              {informes.map((i) => (
                <li key={claveInforme(i)} className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => props.onVer(i)}
                    className="min-w-0 truncate text-left text-zinc-300 underline-offset-4 hover:text-neon-cyan hover:underline"
                  >
                    {i.tipo === "semana" ? `Semana ${rangoCorto(i)}` : tituloPeriodo(i)}
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    {desactualizado(i, diario) && (
                      <span className="font-mono text-[10px] text-amber-200/80">desactualizado</span>
                    )}
                    <button
                      type="button"
                      onClick={() => props.onBorrarInforme(i)}
                      aria-label={`Borrar el informe de ${tituloPeriodo(i).toLowerCase()}`}
                      className="rounded px-1.5 text-zinc-600 transition-colors hover:text-red-300"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-white/10 pt-5">
          <button type="button" className={pequeno} onClick={props.onExportarDiario}>
            Exportar el diario (.md)
          </button>
          <p className="text-xs leading-relaxed text-zinc-500">
            El diario solo está en este navegador. Al pedir un informe, el diario de ese periodo se envía a{" "}
            {modelo ?? "el modelo"} para que lo redacte, y el servidor no guarda nada. Las cifras las calcula la agenda,
            no el modelo.
          </p>
        </div>
      </div>
    </section>
  );
}

function FilaPeriodo({
  etiqueta,
  titulo,
  nombre,
  periodo,
  navegar,
  today,
  diario,
  informes,
  generando,
  onGenerar,
  onVer,
  onCancelar,
}: Props & {
  etiqueta: string;
  titulo: string;
  /** Para los botones: dos «Escribir» iguales no se distinguen con un lector de pantalla. */
  nombre: string;
  periodo: Periodo;
  navegar?: { anterior: () => void; siguiente?: () => void };
}) {
  const guardado = buscarInforme(informes, periodo);
  const enMarcha = generando?.clave === claveInforme(periodo);
  const futuro = periodo.desde > today;
  const sinDiario = !hayDiario(diario, periodo);
  const motivo = futuro
    ? "Ese periodo todavía no ha empezado."
    : sinDiario
      ? "No hay nada escrito en el diario de ese periodo."
      : undefined;

  return (
    <div className="rounded-xl border border-white/10 bg-carbon-800/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {navegar && (
            <button
              type="button"
              className="px-1 text-zinc-500 hover:text-neon-cyan"
              onClick={navegar.anterior}
              aria-label="Mes anterior"
            >
              ‹
            </button>
          )}
          <p className="min-w-0 truncate text-sm">
            <span className="mr-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">{etiqueta}</span>
            <span className="text-zinc-200">{titulo}</span>
          </p>
          {navegar && (
            <button
              type="button"
              className="px-1 text-zinc-500 hover:text-neon-cyan disabled:opacity-30"
              onClick={navegar.siguiente}
              disabled={!navegar.siguiente}
              aria-label="Mes siguiente"
            >
              ›
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {guardado && (
            <button
              type="button"
              className={pequeno}
              onClick={() => onVer(guardado)}
              aria-label={`Ver el informe ${nombre}`}
            >
              Ver
            </button>
          )}
          <button
            type="button"
            className={pequeno}
            onClick={() => onGenerar(periodo)}
            disabled={generando !== null || motivo !== undefined}
            title={motivo}
            aria-label={`${guardado ? "Rehacer" : "Escribir"} el informe ${nombre}`}
          >
            {guardado ? "Rehacer" : "Escribir"}
          </button>
        </div>
      </div>
      {enMarcha && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p role="status" className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-neon-cyan motion-safe:animate-pulse" aria-hidden="true" />
            {generando?.progreso}
          </p>
          <button
            type="button"
            onClick={onCancelar}
            className="shrink-0 font-mono text-[11px] text-zinc-500 underline-offset-4 hover:text-red-300 hover:underline"
          >
            Cancelar
          </button>
        </div>
      )}
      {!enMarcha && motivo && <p className="mt-1.5 text-xs text-zinc-600">{motivo}</p>}
    </div>
  );
}
