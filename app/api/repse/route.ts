import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** URL pública de la consulta del Padrón REPSE de la STPS. */
const REPSE_CONSULTA_URL = "https://repse.stps.gob.mx/Publico/Consulta"
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

type RepseOutcome = "encontrado" | "no_encontrado" | "manual_requerido" | "error"

interface RepseResponse {
  outcome: RepseOutcome
  reachable: boolean
  consultaUrl: string
  rfc: string | null
  razonSocial: string | null
  message: string
  /** Datos del registro cuando la consulta automática los devuelve. */
  registro?: {
    estatus?: string
    actividades?: string[]
    folio?: string
    vigencia?: string
    actualizacion?: string
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(req: Request) {
  let body: { rfc?: string; razonSocial?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 })
  }

  const rfc = (body.rfc ?? "").trim().toUpperCase()
  const razonSocial = (body.razonSocial ?? "").trim()

  if (!rfc && !razonSocial) {
    return NextResponse.json({ error: "Proporciona al menos el RFC o la razón social." }, { status: 400 })
  }
  if (rfc && !RFC_RE.test(rfc)) {
    return NextResponse.json(
      { error: "El RFC no tiene un formato válido (12–13 caracteres)." },
      { status: 400 },
    )
  }

  // El padrón público de la STPS se consulta con captcha y no expone una API
  // de consulta programática. Intentamos alcanzar el sitio en vivo para
  // confirmar disponibilidad; si responde HTML protegido (lo habitual), se
  // deriva a verificación manual con el enlace directo, en lugar de inventar
  // un resultado. Si en el futuro la STPS habilita un endpoint JSON, se puede
  // parsear aquí sin cambiar el contrato de la respuesta.
  let reachable = false
  try {
    const res = await fetchWithTimeout(REPSE_CONSULTA_URL, 8000)
    reachable = res.ok
  } catch {
    reachable = false
  }

  const payload: RepseResponse = {
    outcome: "manual_requerido",
    reachable,
    consultaUrl: REPSE_CONSULTA_URL,
    rfc: rfc || null,
    razonSocial: razonSocial || null,
    message: reachable
      ? "El portal del Padrón REPSE está disponible pero exige captcha para consultar, por lo que no puede verificarse de forma automática. Abre la consulta oficial con los datos precargados y registra el resultado."
      : "No fue posible alcanzar el portal del Padrón REPSE en este momento. Verifica manualmente en la consulta oficial y registra el resultado.",
  }

  return NextResponse.json(payload)
}
