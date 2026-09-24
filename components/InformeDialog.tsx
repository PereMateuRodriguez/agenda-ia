"use client";

import { useEffect, useRef } from "react";
import type { InformeGuardado } from "@/lib/informes-guardados";
import Markdown from "./Markdown";

interface Props {
  informe: InformeGuardado | null;
  /** El diario ha cambiado desde que se escribió. */
  desactualizado: boolean;
  /** Si ahora mismo se puede pedir otro (no hay uno en marcha). */
  puedeRehacer: boolean;
  onClose: () => void;
  onExportar: (informe: InformeGuardado) => void;
  onRehacer: (informe: InformeGuardado) => void;
}

const boton =
  "rounded-full border border-white/15 px-5 py-2 font-mono text-xs uppercase tracking-widest text-zinc-300 transition-colors hover:border-white/40 disabled:opacity-40";

/** Un informe, para leerlo entero, exportarlo o volver a pedirlo. */
export default function InformeDialog({
  informe,
  desactualizado,
  puedeRehacer,
  onClose,
  onExportar,
  onRehacer,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (informe && !dialog.open) dialog.showModal();
    else if (!informe && dialog.open) dialog.close();
  }, [informe]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Informe"
      className="m-auto max-h-[min(48rem,calc(100dvh-2rem))] w-[min(44rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-carbon-800 p-0 text-zinc-200 shadow-2xl"
    >
      {informe && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="min-h-0 overflow-y-auto p-6 md:p-8">
            {desactualizado && (
              <p className="mb-5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                Has cambiado el diario de este periodo desde que se escribió. Rehazlo para que lo tenga en cuenta.
              </p>
            )}
            <Markdown texto={informe.markdown} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
            <button type="button" className={boton} onClick={() => onRehacer(informe)} disabled={!puedeRehacer}>
              Rehacer
            </button>
            <button type="button" className={boton} onClick={() => onExportar(informe)}>
              Exportar .md
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-neon-cyan px-5 py-2 font-mono text-xs font-bold uppercase tracking-widest text-carbon-950 transition-shadow hover:shadow-[0_0_20px_rgba(0,229,255,0.4)]"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
