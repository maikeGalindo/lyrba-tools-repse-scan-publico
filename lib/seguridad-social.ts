import type { MatchStatus } from "./types"

export interface RepseAnalysis {
  tipo: "registro" | "actualizacion" | "renovacion" | "desconocido"
  rfc: string | null
  fecha: string | null
  acuerdo: string | null
  folios: string[]
  cumple: boolean | null
}

export interface IcsoeAnalysis {
  rfc: string | null
  anio: string | null
  cuatrimestre: string | null
  tipo: string | null
  fechaPresentacion: string | null
  folio: string | null
}

export interface SisubAnalysis {
  rfc: string | null
  razonSocial: string | null
  registroPatronal: string | null
  cuatrimestre: string | null
  fechaPresentacion: string | null
  folio: string | null
  statusInformacion: string | null
}

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})\b/i
const CUATRIMESTRE_RE = "(Primero|Segundo|Tercero|Cuarto)"
const DATE_RE = /(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}:\d{2})?)/

function clean(s: string) { return s.replace(/\s+/g, " ").trim() }
function firstMatch(text: string, re: RegExp) { return text.match(re)?.[1]?.trim() ?? null }

export function analyzeRepse(text: string): RepseAnalysis {
  const normalized = clean(text)
  const lower = normalized.toLowerCase()
  const tipo = lower.includes("renovación") || lower.includes("renovacion") ? "renovacion" : lower.includes("actualización") || lower.includes("actualizacion") ? "actualizacion" : lower.includes("aviso de registro") ? "registro" : "desconocido"
  return {
    tipo,
    rfc: firstMatch(normalized, RFC_RE),
    fecha: firstMatch(normalized, DATE_RE),
    acuerdo: firstMatch(normalized, /(?:número|numero) de acuerdo:\s*([^\n]+)/i),
    folios: [...normalized.matchAll(/Folio:\s*([0-9a-f-]{20,})/gi)].map((m) => m[1]),
    cumple: /\bCUMPLE\b/i.test(normalized) ? true : null,
  }
}

export function analyzeIcsoe(text: string): IcsoeAnalysis {
  const normalized = clean(text)
  // En el acuse del IMSS los valores del contratista se imprimen antes que sus
  // etiquetas: "RFC  RAZÓN SOCIAL  AÑO  CUATRIMESTRE  TIPO", así que se leen juntos.
  const bloque = normalized.match(
    new RegExp(`\\b([A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3})\\s+(.{1,200}?)\\s+(20\\d{2})\\s*${CUATRIMESTRE_RE}\\s*(Normal|Complementaria|Sin movimiento)`, "i"),
  )
  const etiquetaRfc = firstMatch(normalized, /Datos del Contratista[\s\S]{0,300}?RFC:\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/i)
  return {
    rfc: (etiquetaRfc ?? bloque?.[1] ?? firstMatch(normalized, RFC_RE))?.toUpperCase() ?? null,
    anio: firstMatch(normalized, /(?:Año|Ano):\s*(20\d{2})/i) ?? bloque?.[3] ?? null,
    cuatrimestre: firstMatch(normalized, new RegExp(`Cuatrimestre:\\s*${CUATRIMESTRE_RE}`, "i")) ?? bloque?.[4] ?? null,
    tipo: firstMatch(normalized, /Tipo de Informativa:\s*(Normal|Complementaria|Sin movimiento)/i) ?? bloque?.[5] ?? null,
    fechaPresentacion: firstMatch(normalized, /Fecha y hora de presentación:\s*([^\n]+?\d{2}:\d{2}:\d{2})/i) ?? firstMatch(normalized, DATE_RE),
    folio:
      firstMatch(normalized, /FOLIO DEFINITIVO DE LA INFORMATIVA:\s*([A-Z]?\d{6,})/i) ??
      firstMatch(normalized, /^([A-Z]\d{6,})\b/i) ??
      firstMatch(normalized, /\b(N\d{8,})\b/),
  }
}

export function analyzeSisub(text: string): SisubAnalysis {
  const normalized = clean(text)
  const chain = normalized.match(/Cadena Original:\s*\|\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|SISUB\|([^|]+)\|([^|]+)\|\|/i)
  return {
    rfc: firstMatch(normalized, /RFC:\s*([A-Z0-9&Ñ]{12,13})/i) ?? chain?.[1]?.trim() ?? null,
    razonSocial: firstMatch(normalized, /Nombre, denominación o razón social:\s*([^\n]+)/i) ?? chain?.[2]?.trim() ?? null,
    registroPatronal: chain?.[3]?.trim() ?? null,
    cuatrimestre: firstMatch(normalized, /Cuatrimestre en que se declara:\s*([^\n]+)/i),
    fechaPresentacion: chain?.[4]?.trim() ?? firstMatch(normalized, /Fecha de Carga:\s*([^\n]+)/i),
    statusInformacion: chain?.[5]?.trim() ?? null,
    folio: chain?.[6]?.trim() ?? firstMatch(normalized, /Folio de Acuse[^\n]*\s*([\d_]+)/i),
  }
}

export function matchRfc(expected: string | null, actual: string | null): MatchStatus {
  if (!expected || !actual) return "REVISAR"
  return expected.replace(/\s/g, "").toUpperCase() === actual.replace(/\s/g, "").toUpperCase() ? "OK" : "NO_OK"
}

export function worstStatus(statuses: (MatchStatus | null)[]): MatchStatus | null {
  if (statuses.some((s) => s === "NO_OK")) return "NO_OK"
  if (statuses.some((s) => s === "REVISAR" || s == null)) return "REVISAR"
  return statuses.length ? "OK" : null
}

export function formatReportDate(value: string | null) { return value ?? "No identificado" }
export function formatText(value: string | null) { return value ?? "No identificado" }

export { RFC_RE }

export function isIcsoe(text: string) { return /acuse de informativa de contratos|informativa de contratos de servicios/i.test(text) }
export function isSisub(text: string) { return /SISUB|Cadena Original:/i.test(text) && /Cuatrimestre en que se declara/i.test(text) }
export function isRepse(text: string) { return /repse\.stps\.gob\.mx|aviso de (?:registro|renovación|actualización)/i.test(text) }
