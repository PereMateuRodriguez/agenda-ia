"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentStep } from "@/lib/agent";
import type { CalendarEvent } from "@/lib/calendar";
import type { ProviderStatus } from "@/lib/protocol";

export type UiMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      steps: AgentStep[];
      status: "pending" | "done" | "error";
      /** La agenda antes de esta respuesta, para poder deshacerla. */
      before?: CalendarEvent[];
      undone?: boolean;
    };

export const SUGGESTIONS = [
  "¿Qué tengo mañana?",
  "Cena con Laura el viernes a las 21:30",
  "Pasa el dentista al lunes a la misma hora",
  "Búscame 2 horas libres esta semana para preparar la propuesta",
  "Cancela la llamada con el cliente",
];

interface Props {
  messages: UiMessage[];
  busy: boolean;
  status: ProviderStatus | { error: string } | null;
  undoableId: string | null;
  onSend: (text: string) => void;
  onUndo: (messageId: string) => void;
  onClear: () => void;
}

const TOOL_NAMES: Record<string, string> = {
  list_events: "consultar",
  search_events: "buscar",
  create_event: "crear",
  update_event: "modificar",
  delete_event: "borrar",
  find_free_slots: "huecos",
};

function Steps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mb-2 space-y-1.5 border-l border-white/10 pl-3">
      {steps.map((s, i) =>
        s.type === "note" ? (
          <li key={i} className="text-xs italic text-zinc-500">
            {s.text}
          </li>
        ) : (
          <li key={s.id + i} className="flex items-baseline gap-2 text-xs">
            <span
              className={`shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${
                s.ok ? "bg-neon-emerald/10 text-neon-emerald" : "bg-red-400/10 text-red-300"
              }`}
            >
              {TOOL_NAMES[s.name] ?? s.name}
            </span>
            <span className={s.ok ? "text-zinc-400" : "text-red-200/80"}>
              {s.summary}
              {!s.ok && <span className="sr-only"> (ha fallado; el modelo lo reintenta)</span>}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

export default function Chat({ messages, busy, status, undoableId, onSend, onUndo, onClear }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
    inputRef.current?.focus();
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Asistente">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-white">Asistente</h2>
          <p className="mt-0.5 flex items-center gap-2 truncate font-mono text-[11px] text-zinc-500">
            {status === null ? (
              "Comprobando el modelo…"
            ) : "error" in status ? (
              <>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden="true" />
                <span className="truncate text-red-300">{status.error}</span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon-emerald" aria-hidden="true" />
                <span className="truncate">{status.label}</span>
              </>
            )}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="shrink-0 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-40"
          >
            Limpiar chat
          </button>
        )}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
        <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-carbon-700 px-4 py-3 text-sm leading-relaxed text-zinc-200">
          Hola. Dime qué quieres apuntar, mover o consultar, como se lo dirías a una persona. Debajo de cada respuesta
          verás qué he hecho en la agenda para llegar a ella.
        </div>

        {messages.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-neon-cyan/15 px-4 py-3 text-sm text-cyan-50"
            >
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%]">
              <div className="rounded-2xl rounded-tl-sm bg-carbon-700 px-4 py-3 text-sm leading-relaxed">
                <Steps steps={m.steps} />
                {m.status === "pending" && (
                  <p className="flex items-center gap-2 text-zinc-400">
                    <span className="h-2 w-2 rounded-full bg-neon-cyan motion-safe:animate-pulse" aria-hidden="true" />
                    {m.steps.length === 0 ? "Pensando…" : "Trabajando…"}
                  </p>
                )}
                {m.status === "done" && <p className="whitespace-pre-wrap text-zinc-100">{m.content}</p>}
                {m.status === "error" && (
                  <p className="text-red-200">
                    <span className="font-semibold">No ha salido bien.</span> {m.content}
                  </p>
                )}
              </div>
              {m.before && (
                <div className="mt-1.5 pl-1">
                  {m.undone ? (
                    <span className="font-mono text-[11px] text-zinc-500">Cambios deshechos</span>
                  ) : undoableId === m.id ? (
                    <button
                      type="button"
                      onClick={() => onUndo(m.id)}
                      className="font-mono text-[11px] text-neon-cyan underline-offset-4 hover:underline"
                    >
                      ↶ Deshacer estos cambios
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={busy}
              className="rounded-full border border-white/10 px-3 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:border-neon-cyan/50 hover:text-neon-cyan"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="border-t border-white/10 p-4"
      >
        <label htmlFor="chat-input" className="sr-only">
          Escribe a tu agenda
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-carbon-900 p-2 focus-within:border-neon-cyan/50">
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="Reunión con Joan el martes a las 10…"
            className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base text-zinc-100 sm:text-sm placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-xl bg-neon-cyan px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-carbon-950 transition-opacity disabled:opacity-30"
          >
            {busy ? "…" : "Enviar"}
          </button>
        </div>
        <p className="mt-2 px-1 font-mono text-[10px] text-zinc-600">Enter para enviar · Mayús+Enter, salto de línea</p>
      </form>
    </section>
  );
}
