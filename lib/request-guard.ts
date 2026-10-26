import { del, list } from "@vercel/blob"
import { BLOB_PREFIX } from "@/lib/blob-temporal"

const STALE_MS = 60 * 60 * 1000

/** Rechaza llamadas que no provienen de la propia app (formularios o scripts de otros sitios). */
export function isSameOrigin(request: Request): boolean {
  // El navegador fija Sec-Fetch-Site y una página ajena no puede falsificarlo; detrás de proxies
  // (vista previa de v0) el Host puede no coincidir con el Origin, así que esta señal va primero.
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite === "same-origin") return true
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false

  const origin = request.headers.get("origin")
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim())
  return hosts.includes(originHost)
}

/** Borra .zip temporales que quedaron huérfanos (subidos pero nunca enviados). */
export async function purgeStaleTempZips() {
  try {
    const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 100 })
    const limite = Date.now() - STALE_MS
    const viejos = blobs.filter((b) => new Date(b.uploadedAt).getTime() < limite).map((b) => b.pathname)
    if (viejos.length > 0) await del(viejos)
  } catch {
    // La limpieza es de mantenimiento; nunca debe bloquear la subida ni el envío.
  }
}
