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

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: se sigue en memoria.
  }
}
