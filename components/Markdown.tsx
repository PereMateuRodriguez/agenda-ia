import { Fragment, type ReactNode } from "react";

/**
 * El poco Markdown que llevan los informes: títulos, viñetas, separadores,
 * negrita y un párrafo entero en cursiva, que es el pie. La cursiva no se
 * busca dentro de las frases: un nombre como num_ctx acabaría partido.
 *
 * Se construye como elementos de React y no como HTML: el informe lo redacta
 * un modelo a partir de lo que la persona ha escrito, y nada de ahí debe
 * poder colarse en la página como etiquetas.
 */

function enLinea(texto: string): ReactNode[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/)
    .map((trozo, i) =>
      /^\*\*[^*]+\*\*$/.test(trozo) ? (
        <strong key={i}>{trozo.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{trozo}</Fragment>
      ),
    );
}

type Bloque =
  | { tipo: "titulo"; nivel: number; texto: string }
  | { tipo: "lista"; items: string[] }
  | { tipo: "parrafo"; texto: string }
  | { tipo: "separador" };

function bloques(markdown: string): Bloque[] {
  const salida: Bloque[] = [];
  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length) salida.push({ tipo: "parrafo", texto: parrafo.join(" ") });
    parrafo = [];
  };

  for (const linea of markdown.split("\n")) {
    const l = linea.trim();
    const titulo = /^(#{1,4})\s+(.+)$/.exec(l);
    const item = /^[-*]\s+(.+)$/.exec(l);
    if (!l) {
      cerrarParrafo();
    } else if (titulo) {
      cerrarParrafo();
      salida.push({ tipo: "titulo", nivel: titulo[1].length, texto: titulo[2] });
    } else if (/^(-{3,}|\*{3,})$/.test(l)) {
      cerrarParrafo();
      salida.push({ tipo: "separador" });
    } else if (item) {
      cerrarParrafo();
      const ultimo = salida[salida.length - 1];
      if (ultimo?.tipo === "lista") ultimo.items.push(item[1]);
      else salida.push({ tipo: "lista", items: [item[1]] });
    } else {
      parrafo.push(l);
    }
  }
  cerrarParrafo();
  return salida;
}

export default function Markdown({ texto }: { texto: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-zinc-300">
      {bloques(texto).map((b, i) => {
        switch (b.tipo) {
          case "titulo":
            return b.nivel === 1 ? (
              <h3 key={i} className="font-display text-xl font-bold leading-snug text-white">
                {enLinea(b.texto)}
              </h3>
            ) : (
              <h4
                key={i}
                className="pt-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-neon-cyan"
              >
                {enLinea(b.texto)}
              </h4>
            );
          case "lista":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-zinc-600">
                {b.items.map((item, j) => (
                  <li key={j}>{enLinea(item)}</li>
                ))}
              </ul>
            );
          case "separador":
            return <hr key={i} className="border-white/10" />;
          default: {
            const cursiva = /^_(.+)_$/.exec(b.texto);
            return cursiva ? (
              <p key={i} className="italic text-zinc-400">
                {enLinea(cursiva[1])}
              </p>
            ) : (
              <p key={i}>{enLinea(b.texto)}</p>
            );
          }
        }
      })}
    </div>
  );
}
