import type { CalendarEvent } from "./calendar";
import { dateOf, type LocalDateTime } from "./time";

/**
 * Exporta la agenda a iCalendar (RFC 5545) para importarla en Google Calendar,
 * Outlook o el calendario del móvil.
 *
 * Las horas van "flotantes" (sin Z ni TZID): el calendario que importa las
 * interpreta en su propia zona horaria, que es lo que significan aquí —las
 * 17:00 de quien las apuntó—. Meter la zona exigiría incluir su definición
 * VTIMEZONE completa, y algunos importadores la ignoran igualmente.
 */
export function toICS(events: CalendarEvent[], stamp: Date = new Date()): string {
  const dtstamp = stamp
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//agenda-ia//ES",
    "CALSCALE:GREGORIAN",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.id}@agenda-ia`,
      `DTSTAMP:${dtstamp}`,
      ...(e.allDay
        ? [`DTSTART;VALUE=DATE:${compactDate(dateOf(e.start))}`, `DTEND;VALUE=DATE:${compactDate(dateOf(e.end))}`]
        : [`DTSTART:${compactDateTime(e.start)}`, `DTEND:${compactDateTime(e.end)}`]),
      `SUMMARY:${escapeText(e.title)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.notes ? [`DESCRIPTION:${escapeText(e.notes)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function compactDateTime(s: LocalDateTime): string {
  return `${compactDate(dateOf(s))}T${s.slice(11, 13)}${s.slice(14, 16)}00`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Las líneas de más de 75 octetos se parten y la continuación empieza por un
 * espacio. Se cuenta en bytes UTF-8, no en caracteres, y sin partir nunca una
 * letra con tilde por la mitad.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const max = parts.length === 0 ? 75 : 74; // la continuación lleva el espacio delante
    if (bytes + size > max) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Para nombrar el fichero descargado. */
export function icsFileName(today: string): string {
  return `agenda-${today}.ics`;
}
