/**
 * crypto.randomUUID solo existe en contextos seguros: si alguien abre la app
 * por http y con la IP de la red local, no está. Para ids de la interfaz no
 * hace falta que sean criptográficos, solo únicos.
 */
export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${random}`;
}
