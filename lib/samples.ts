import type { CalendarEvent } from "./calendar";
import { addDays, dateOf, startOfWeek, weekdayIndex, type LocalDateTime } from "./time";

/**
 * La agenda de ejemplo de la primera visita. Llena la semana que se ve nada
 * más entrar y deja en el futuro lo que proponen las sugerencias del chat
 * —mover el dentista, cancelar la llamada—, para que se puedan probar tal cual.
 */
export function sampleEvents(now: LocalDateTime): CalendarEvent[] {
  const today = dateOf(now);
  const monday = startOfWeek(today);
  let next = addDays(today, 1);
  while (weekdayIndex(next) >= 5) next = addDays(next, 1);

  return [
    {
      id: "ej_1",
      title: "Reunión de equipo",
      start: `${monday}T10:00`,
      end: `${monday}T11:00`,
      notes: "Revisar el roadmap del trimestre",
    },
    { id: "ej_2", title: "Gimnasio", start: `${addDays(monday, 1)}T08:00`, end: `${addDays(monday, 1)}T09:00` },
    {
      id: "ej_3",
      title: "Comida con Marta",
      start: `${today}T14:00`,
      end: `${today}T15:30`,
      location: "Santa Catalina",
    },
    { id: "ej_4", title: "Llamada con el cliente", start: `${next}T12:30`, end: `${next}T13:00` },
    { id: "ej_5", title: "Dentista", start: `${next}T17:00`, end: `${next}T18:00` },
    {
      id: "ej_6",
      title: "Cumpleaños de Joan",
      start: `${addDays(monday, 5)}T00:00`,
      end: `${addDays(monday, 6)}T00:00`,
      allDay: true,
    },
  ];
}
