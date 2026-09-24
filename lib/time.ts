/**
 * Fechas en "hora de pared": "2026-09-24T17:00", sin zona horaria.
 *
 * Una agenda piensa así: el dentista es a las 17:00 del día que sea, y eso no
 * cambia porque ese día haya cambio de hora. Guardar instantes UTC obligaría a
 * convertir en cada lectura y abre la puerta a que un evento aparezca una hora
 * desplazado. Aquí las cuentas se hacen en minutos tratando la hora local como
 * si fuera UTC, que es exactamente aritmética de calendario sin sorpresas.
 */

/** "AAAA-MM-DDTHH:mm" en hora local. */
export type LocalDateTime = string;
/** "AAAA-MM-DD". */
export type LocalDate = string;

export const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const MINUTOS_DIA = 24 * 60;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

/**
 * Acepta las variantes que suelen devolver los modelos —con segundos, con
 * espacio en vez de "T", o solo la fecha— y las deja en el formato canónico.
 * Devuelve null si no es una fecha real (un 31 de septiembre, por ejemplo).
 */
export function normalizeLocal(input: string): LocalDateTime | null {
  const s = input.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = m[4] === undefined ? 0 : Number(m[4]);
  const mi = m[5] === undefined ? 0 : Number(m[5]);
  if (!validDate(y, mo, d) || h > 23 || mi > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${pad(h)}:${pad(mi)}`;
}

export function isLocalDateTime(s: string): boolean {
  return normalizeLocal(s) === s;
}

/** "AAAA-MM-DD" y que exista: un 31 de septiembre no pasa. */
export function isLocalDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  return m !== null && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Minutos desde la época, tratando la hora local como UTC. */
export function toMinutes(s: LocalDateTime): number {
  const m = LOCAL_RE.exec(s);
  if (!m) throw new Error(`Fecha con formato inválido: ${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000;
}

export function fromMinutes(total: number): LocalDateTime {
  const d = new Date(total * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

export function addMinutes(s: LocalDateTime, minutes: number): LocalDateTime {
  return fromMinutes(toMinutes(s) + minutes);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return dateOf(addMinutes(`${date}T00:00`, days * MINUTOS_DIA));
}

export function dateOf(s: LocalDateTime): LocalDate {
  return s.slice(0, 10);
}

export function timeOf(s: LocalDateTime): string {
  return s.slice(11, 16);
}

export function startOfDay(date: LocalDate): LocalDateTime {
  if (!DATE_RE.test(date)) throw new Error(`Fecha con formato inválido: ${date}`);
  return `${date}T00:00`;
}

/** 0 = lunes … 6 = domingo, como se cuenta la semana aquí. */
export function weekdayIndex(date: LocalDate): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Fecha con formato inválido: ${date}`);
  const js = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return (js + 6) % 7;
}

export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, -weekdayIndex(date));
}

export function diffMinutes(a: LocalDateTime, b: LocalDateTime): number {
  return toMinutes(b) - toMinutes(a);
}

/** "vie 25/09" */
export function shortDay(date: LocalDate): string {
  return `${DIAS_CORTOS[weekdayIndex(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** "viernes 25 de septiembre" */
export function longDay(date: LocalDate): string {
  const day = Number(date.slice(8, 10));
  const month = MESES[Number(date.slice(5, 7)) - 1];
  return `${DIAS[weekdayIndex(date)]} ${day} de ${month}`;
}

/** Hora de pared actual en una zona IANA, en el formato de la agenda. */
export function nowIn(timeZone: string, at: Date = new Date()): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
