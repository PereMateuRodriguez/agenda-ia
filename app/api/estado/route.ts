import type { ProviderStatus } from "@/lib/protocol";
import { getProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/** Qué modelo responde, para enseñarlo en la interfaz. No expone URLs ni claves. */
export async function GET() {
  try {
    const p = getProvider();
    const status: ProviderStatus = { provider: p.id, model: p.model, label: p.label };
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof ProviderError ? err.message : "Proveedor mal configurado." },
      { status: 500 },
    );
  }
}
