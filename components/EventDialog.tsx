"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, NewEvent } from "@/lib/calendar";
import { addDays, addMinutes, dateOf, timeOf, type LocalDateTime } from "@/lib/time";

export type EditorState = { mode: "create"; start: LocalDateTime } | { mode: "edit"; event: CalendarEvent };

interface Props {
  state: EditorState | null;
  onClose: () => void;
  /** Devuelve el motivo si no se ha podido guardar. */
  onSubmit: (draft: NewEvent, id?: string) => string | null;
  onDelete: (id: string) => void;
}

interface Form {
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
}

function initialForm(state: EditorState): Form {
  if (state.mode === "create") {
    const end = addMinutes(state.start, 60);
    return {
      title: "",
      date: dateOf(state.start),
      endDate: dateOf(state.start),
      startTime: timeOf(state.start),
      endTime: dateOf(end) === dateOf(state.start) ? timeOf(end) : "23:59",
      allDay: false,
      location: "",
      notes: "",
    };
  }
  const e = state.event;
  return {
    title: e.title,
    date: dateOf(e.start),
    endDate: e.allDay ? addDays(dateOf(e.end), -1) : dateOf(e.end),
    startTime: e.allDay ? "09:00" : timeOf(e.start),
    endTime: e.allDay ? "10:00" : timeOf(e.end),
    allDay: Boolean(e.allDay),
    location: e.location ?? "",
    notes: e.notes ?? "",
  };
}

// En iOS, un campo con letra de menos de 16 px hace zoom al enfocarlo.
const input =
  "w-full rounded-lg border border-white/10 bg-carbon-900 px-3 py-2 text-base text-zinc-100 sm:text-sm placeholder:text-zinc-600 focus:border-neon-cyan/60 focus:outline-none";
const label = "block font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500";

/** Crear y editar a mano, sin pasar por el modelo. */
export default function EventDialog({ state, onClose, onSubmit, onDelete }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (state) {
      setForm(initialForm(state));
      setError(null);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [state]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form || !state) return;
    // Un evento que acaba a las 00:00 acaba al empezar el día siguiente.
    const endDateForTime = form.endTime === "00:00" ? addDays(form.date, 1) : form.date;
    const draft: NewEvent = form.allDay
      ? { title: form.title, start: `${form.date}T00:00`, end: `${form.endDate || form.date}T00:00`, allDay: true }
      : {
          title: form.title,
          start: `${form.date}T${form.startTime}`,
          end: `${endDateForTime}T${form.endTime}`,
          allDay: false,
        };
    draft.location = form.location;
    draft.notes = form.notes;
    const problem = onSubmit(draft, state.mode === "edit" ? state.event.id : undefined);
    if (problem) setError(problem);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-carbon-800 p-0 text-zinc-200 shadow-2xl"
    >
      {form && state && (
        <form onSubmit={submit} className="space-y-5 p-6">
          <h2 className="font-display text-xl font-bold text-white">
            {state.mode === "create" ? "Nuevo evento" : "Editar evento"}
          </h2>

          <div className="space-y-1.5">
            <label htmlFor="ev-title" className={label}>
              Título
            </label>
            <input
              id="ev-title"
              required
              maxLength={200}
              autoFocus
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className={input}
              placeholder="Dentista, comida con Marta…"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => set("allDay", e.target.checked)}
              className="h-4 w-4 accent-[#a78bfa]"
            />
            Todo el día
          </label>

          {form.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="ev-date" className={label}>
                  Desde
                </label>
                <input
                  id="ev-date"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  className={input}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ev-end-date" className={label}>
                  Hasta (incluido)
                </label>
                <input
                  id="ev-end-date"
                  type="date"
                  required
                  min={form.date}
                  value={form.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                  className={input}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
              <div className="space-y-1.5">
                <label htmlFor="ev-date" className={label}>
                  Día
                </label>
                <input
                  id="ev-date"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  className={input}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ev-start" className={label}>
                  Empieza
                </label>
                <input
                  id="ev-start"
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  className={input}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ev-end" className={label}>
                  Acaba
                </label>
                <input
                  id="ev-end"
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  className={input}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="ev-location" className={label}>
              Lugar
            </label>
            <input
              id="ev-location"
              maxLength={200}
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              className={input}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ev-notes" className={label}>
              Notas
            </label>
            <textarea
              id="ev-notes"
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className={`${input} resize-none`}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {state.mode === "edit" ? (
              <button
                type="button"
                onClick={() => onDelete(state.event.id)}
                className="rounded-full px-4 py-2 font-mono text-xs uppercase tracking-widest text-red-300 transition-colors hover:bg-red-400/10"
              >
                Borrar
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/15 px-5 py-2 font-mono text-xs uppercase tracking-widest text-zinc-300 transition-colors hover:border-white/40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-full bg-neon-cyan px-5 py-2 font-mono text-xs font-bold uppercase tracking-widest text-carbon-950 transition-shadow hover:shadow-[0_0_20px_rgba(0,229,255,0.4)]"
              >
                Guardar
              </button>
            </div>
          </div>
        </form>
      )}
    </dialog>
  );
}
