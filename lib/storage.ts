"use client";

/**
 * localStorage puede no estar (navegación privada en algunos navegadores,
 * cookies bloqueadas) o lanzar al escribir si está lleno. La agenda funciona
 * igual sin él; solo que no recuerda nada al recargar.
 */
export function load<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Devuelve si se ha podido guardar. Para la agenda da un poco igual, pero un
 * diario que no se guarda es texto que se pierde al cerrar la pestaña, y eso
 * hay que decirlo.
 */
export function save(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Sin almacenamiento: se sigue en memoria.
    return false;
  }
}
