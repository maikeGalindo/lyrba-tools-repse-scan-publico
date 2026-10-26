import type { MatchStatus } from "./types"

export type ConstanciaTipo = "sat" | "imss" | "infonavit"
export type Sentido = "positivo" | "negativo" | "desconocido"

export interface ConstanciaAnalysis {
  tipo: ConstanciaTipo | null
  archivo: string
  sentido: Sentido
  /** Fecha de expedición tal como aparece en el documento. */
  fechaRaw: string | null
  /** Mes de expedición normalizado "YYYY-MM". */
  mesEmision: string | null
  rfc: string | null
  usedOcr: boolean
}

export interface ConstanciaTipoMeta {
  tipo: ConstanciaTipo
  label: string
  subtitle: string
  positivoLabel: string
  negativoLabel: string
}

export const CONSTANCIA_TIPOS: ConstanciaTipoMeta[] = [
  {
    tipo: "sat",
    label: "SAT · Opinión 32-D",
    subtitle: "Opinión del cumplimiento de obligaciones fiscales",
    positivoLabel: "Positivo",
    negativoLabel: "Negativo",
  },
  {
    tipo: "imss",
    label: "IMSS · Opinión de cumplimiento",
    subtitle: "Obligaciones en materia de seguridad social",
    positivoLabel: "Opinión positiva",
    negativoLabel: "Opinión negativa",
  },
  {
    tipo: "infonavit",
    label: "INFONAVIT · Constancia",
    subtitle: "Aportaciones patronales y entero de descuentos",
    positivoLabel: "Sin adeudo",
    negativoLabel: "Con adeudo",
  },
]

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
]

const MES_NUM: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
}

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function norm(s: string) {
  return stripAccents(s).toLowerCase()
}

/** Lleva cualquier variante ("2026-7", "2026-07-01", " 2026-07 ") a "AAAA-MM". */
export function normalizeYm(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.trim().match(/^(\d{4})\D+(\d{1,2})/)
  if (!m) return null
  const mm = Number(m[2])
  if (mm < 1 || mm > 12) return null
  return `${m[1]}-${String(mm).padStart(2, "0")}`
}

export function sameMonth(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeYm(a)
  return na !== null && na === normalizeYm(b)
}

export function formatMonth(ym: string | null): string {
  if (!ym) return "—"
  const [y, m] = ym.split("-")
  const idx = Number(m) - 1
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return "—"
  const nombre = MESES[idx]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`
}

/** Detecta a qué autoridad pertenece la constancia por palabras clave. */
export function detectTipo(text: string): ConstanciaTipo | null {
  const t = norm(text)
  if (t.includes("infonavit") || t.includes("fondo nacional de la vivienda")) return "infonavit"
  if (t.includes("seguro social") || t.includes("seguridad social") || t.includes("imss")) return "imss"
  if (
    t.includes("administracion tributaria") ||
    t.includes("opinion del cumplimiento de obligaciones fiscales")
  ) {
    return "sat"
  }
  return null
}

/**
 * Determina el sentido de la opinión. Cada autoridad usa frases distintas y,
 * en el caso del IMSS, el documento enumera "POSITIVA/NEGATIVA" en las notas,
 * por lo que hay que anclar a la frase resolutiva, no a la palabra suelta.
 */
export function detectSentido(tipo: ConstanciaTipo, text: string): Sentido {
  const t = norm(text)
  if (tipo === "infonavit") {
    if (t.includes("sin adeudo")) return "positivo"
    if (t.includes("con adeudo")) return "negativo"
    return "desconocido"
  }
  if (tipo === "imss") {
    if (t.includes("opinion:positiva") || t.includes("se emite opinion positiva")) return "positivo"
    if (t.includes("opinion:negativa") || t.includes("se emite opinion negativa")) return "negativo"
    return "desconocido"
  }
  // SAT: el valor aparece junto a "Sentido" y en la cadena original como |P| / |N|.
  if (/\bpositivo\b/.test(t) || /\|\s*p\s*\|/.test(t)) return "positivo"
  if (/\bnegativo\b/.test(t) || /\|\s*n\s*\|/.test(t)) return "negativo"
  return "desconocido"
}

function parseParts(dia: string, mesName: string, anio: string): { raw: string; ym: string } | null {
  const mn = MES_NUM[norm(mesName)]
  if (!mn) return null
  const d = dia.padStart(2, "0")
  return { raw: `${d} de ${mesName} de ${anio}`, ym: `${anio}-${mn}` }
}

const DATE_RE = /(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñ]+)\s+de\s+(\d{4})/

function firstDate(fragment: string): { raw: string; ym: string } | null {
  const m = fragment.match(DATE_RE)
  if (!m) return null
  return parseParts(m[1], m[2], m[3])
}

/** Extrae la fecha de expedición usando un ancla específica por autoridad, con respaldo genérico. */
export function detectFecha(tipo: ConstanciaTipo, text: string): { raw: string; ym: string } | null {
  const anchors: RegExp[] = []
  if (tipo === "sat") {
    anchors.push(/emisi[oó]n[\s\S]{0,40}?(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñ]+\s+de\s+\d{4})/i)
  } else if (tipo === "imss") {
    anchors.push(/fecha:\s*(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñ]+\s+de\s+\d{4})/i)
    anchors.push(/practicada[\s\S]{0,30}?(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñ]+\s+de\s+\d{4})/i)
  } else {
    anchors.push(/,\s*a\s*(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñ]+\s+de\s+\d{4})/i)
  }
  for (const re of anchors) {
    const m = text.match(re)
    if (m) {
      const p = firstDate(m[1])
      if (p) return p
    }
  }
  return firstDate(text)
}

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/

export function detectRfc(text: string): string | null {
  const m = text.toUpperCase().match(RFC_RE)
  return m ? m[1] : null
}

export function analyzeConstancia(text: string, archivo: string, usedOcr = false): ConstanciaAnalysis {
  const tipo = detectTipo(text)
  if (!tipo) {
    return { tipo: null, archivo, sentido: "desconocido", fechaRaw: null, mesEmision: null, rfc: detectRfc(text), usedOcr }
  }
  const sentido = detectSentido(tipo, text)
  const fecha = detectFecha(tipo, text)
  return {
    tipo,
    archivo,
    sentido,
    fechaRaw: fecha?.raw ?? null,
    mesEmision: fecha?.ym ?? null,
    rfc: detectRfc(text),
    usedOcr,
  }
}

export interface ConstanciaEval {
  status: MatchStatus | null
  detalle: string
}

/** Aplica las reglas: sentido positivo Y fecha de expedición dentro del mes objetivo. */
export function evaluateConstancia(
  a: ConstanciaAnalysis | undefined,
  meta: ConstanciaTipoMeta,
  mesObjetivo: string,
): ConstanciaEval {
  if (!a) return { status: null, detalle: "Documento no cargado." }
  if (a.sentido === "negativo") {
    return { status: "NO_OK", detalle: `Sentido ${meta.negativoLabel.toLowerCase()}: la opinión no es favorable.` }
  }
  if (a.sentido === "desconocido") {
    return { status: "REVISAR", detalle: "No se pudo determinar el sentido de la opinión en el documento." }
  }
  if (!a.mesEmision) {
    return { status: "REVISAR", detalle: "Opinión positiva, pero no se detectó la fecha de expedición." }
  }
  if (sameMonth(a.mesEmision, mesObjetivo)) {
    return { status: "OK", detalle: `Sentido positivo y expedida en ${formatMonth(mesObjetivo)}.` }
  }
  return {
    status: "REVISAR",
    detalle: `Positiva, pero expedida en ${formatMonth(a.mesEmision)} — fuera del mes revisado (${formatMonth(mesObjetivo)}).`,
  }
}
