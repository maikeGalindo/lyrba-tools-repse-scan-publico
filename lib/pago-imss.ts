import type { MatchStatus } from "./types"
import { formatMonth } from "./constancias"

export type ImssDocTipo = "sipare" | "banco"

export interface ImssDocAnalysis {
  tipo: ImssDocTipo | null
  archivo: string
  /** Línea de captura SIPARE normalizada (solo alfanuméricos, mayúsculas). */
  lineaCaptura: string | null
  /** Folio SUA (dígitos). En la cédula viene concatenado con la clave de recepción. */
  folioSua: string | null
  /** Registro patronal normalizado (letra + 10 dígitos). */
  registroPatronal: string | null
  importe: number | null
  /** Período del pago IMSS normalizado "YYYY-MM". */
  periodo: string | null
  rfc: string | null
  razonSocial: string | null
  /** Qué cubre el pago: cuotas IMSS mensuales, RCV/INFONAVIT bimestral o ambos. */
  concepto: ImssConcepto | null
  usedOcr: boolean
}

export type ImssConcepto = "imss" | "rcv-infonavit" | "mixto"

export const IMSS_CONCEPTO_LABEL: Record<ImssConcepto, string> = {
  imss: "IMSS mensual",
  "rcv-infonavit": "INFONAVIT (RCV/vivienda bimestral)",
  mixto: "IMSS + INFONAVIT",
}

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function norm(s: string) {
  return stripAccents(s).toLowerCase().replace(/\s+/g, " ")
}

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

/**
 * Clasifica el documento. La cédula/propuesta SUA se evalúa PRIMERO por sus
 * marcadores únicos ("cuotas obrero patronales", "formato para pago de cuotas"),
 * que el comprobante bancario nunca contiene aunque mencione la palabra "SIPARE".
 */
export function detectImssTipo(text: string): ImssDocTipo | null {
  const t = norm(text)
  // Comprobante bancario (BBVA y similares) que menciona "Cuotas Obrero Patronales"
  // en su título: se reconoce primero por marcadores exclusivos del banco.
  if (
    t.includes("comprobante de aplicacion del pago") ||
    (t.includes("entidad receptora") && (t.includes("folio de pago") || t.includes("cuenta de cargo")))
  ) {
    return "banco"
  }
  if (
    t.includes("cuotas obrero patronales") ||
    t.includes("formato para pago de cuotas") ||
    t.includes("propuesta de cedula") ||
    t.includes("determinacion de cuotas") ||
    t.includes("linea de captura sipare")
  ) {
    return "sipare"
  }
  if (
    t.includes("comprobante de pago") ||
    t.includes("estatus de pago") ||
    t.includes("clave de rastreo") ||
    t.includes("medio de pago") ||
    t.includes("importe imss")
  ) {
    return "banco"
  }
  // Respaldo para comprobantes bancarios que no usan las frases anteriores: se
  // aceptan solo con contexto IMSS explícito + un marcador típico de pago
  // referenciado, para no capturar documentos que deban quedar sin clasificar.
  const contextoImss =
    t.includes("imss") ||
    t.includes("instituto mexicano del seguro social") ||
    t.includes("seguro social")
  if (
    contextoImss &&
    (t.includes("linea de captura") ||
      t.includes("pago referenciado") ||
      t.includes("pago de contribuciones") ||
      t.includes("pago de servicios") ||
      t.includes("referencia") ||
      t.includes("folio de operacion") ||
      t.includes("numero de autorizacion") ||
      t.includes("autorizacion") ||
      t.includes("cargo a cuenta") ||
      t.includes("clave de rastreo"))
  ) {
    return "banco"
  }
  return null
}

/**
 * La línea de captura del SIPARE tiene un formato fijo por grupos separados por
 * guiones (p. ej. "A1OMA6IB-4CBY-2-IJLN-6529-000P6D4-0000000-0000000-0000000-1BDT").
 * Se busca por su estructura sobre el texto sin espacios para tolerar los saltos
 * de línea del PDF, y se normaliza quitando todo lo que no sea alfanumérico.
 */
export function extractLineaCapturaImss(text: string): string | null {
  const deSpaced = text.replace(/\s+/g, "")
  const structural = deSpaced.match(
    /[0-9A-Z]{6,8}-[0-9A-Z]{3,4}-\d-[0-9A-Z]{3,4}-\d{4}-[0-9A-Z]{5,7}(?:-\d{5,7}){1,4}-[0-9A-Z]{3,4}/i,
  )
  if (structural) {
    const compact = structural[0].replace(/[^0-9A-Za-z]/g, "").toUpperCase()
    if (compact.length >= 24) return compact
  }
  // Comprobante bancario (p. ej. BBVA "Comprobante de Aplicación del Pago"): la
  // línea viene sin guiones debajo de la etiqueta "Línea de Captura:".
  const labeled = text.match(/l[ií]nea\s*de\s*captura\s*:?\s*([0-9A-Z]{40,60})\b/i)
  if (labeled && /\d/.test(labeled[1]) && /[A-Z]/i.test(labeled[1])) return labeled[1].toUpperCase()
  return null
}

export function extractFolioSua(text: string): string | null {
  const labeled = text.match(/folio\s*sua\s*:?\s*(\d{6,16})/i)
  if (labeled) return labeled[1]
  // En la cédula SUA el folio va pegado a la clave de recepción (cadena larga de dígitos).
  const long = text.match(/\b(\d{12,16})\b/)
  return long ? long[1] : null
}

function normRegistro(s: string): string | null {
  const c = s.replace(/[^0-9A-Za-z]/g, "").toUpperCase()
  return /^[A-Z]\d{10}$/.test(c) ? c : null
}

export function extractRegistroPatronal(text: string): string | null {
  const anchor = text.match(/registro\s*patronal\s*:?\s*([A-Z][\d\s-]{9,16})/i)
  if (anchor) {
    const n = normRegistro(anchor[1])
    if (n) return n
  }
  // Formato con guiones en la cédula: "A36-65397-10-7".
  const dashed = text.match(/\b([A-Z]\d{2}-\d{5}-\d{2}-\d)\b/)
  if (dashed) {
    const n = normRegistro(dashed[1])
    if (n) return n
  }
  return null
}

function normPeriodo(raw: string): string | null {
  const a = raw.match(/^(\d{4})-(\d{2})$/)
  if (a) return `${a[1]}-${a[2]}`
  const b = raw.match(/^(\d{2})-(\d{4})$/)
  if (b) return `${b[2]}-${b[1]}`
  return null
}

export function extractPeriodoImss(text: string, tipo: ImssDocTipo | null): string | null {
  if (tipo === "banco") {
    const m = text.match(/per[ií]odo\s*de\s*pago\s*:?\s*(\d{4}-\d{2}|\d{2}-\d{4})/i)
    if (m) return normPeriodo(m[1])
    // Formato en tabla: "Periodo de Pago IMSS: ..." y en la fila siguiente "202607".
    const compact = text.match(/per[ií]odo\s*de\s*pago\s*imss[\s\S]{0,160}?\b(20\d{2})(0[1-9]|1[0-2])\b/i)
    if (compact) return `${compact[1]}-${compact[2]}`
  } else {
    // Cédula SUA: el período mensual del IMSS aparece después de "SEGUROS IMSS"
    // (el bimestre RCV/INFONAVIT aparece antes, por eso se ancla hacia adelante).
    const m = text.match(/seguros\s*imss[\s\S]{0,160}?(\d{2}-\d{4}|\d{4}-\d{2})/i)
    if (m) return normPeriodo(m[1])
  }
  const g = text.match(/per[ií]odo[\s\S]{0,40}?(\d{4}-\d{2}|\d{2}-\d{4})/i)
  return g ? normPeriodo(g[1]) : null
}

function extractMaxMoney(text: string): number | null {
  const matches = text.match(/\$\s*[\d,]+\.\d{2}/g)
  if (!matches) return null
  let max = 0
  let found = false
  for (const m of matches) {
    const n = Number(m.replace(/[^\d.]/g, ""))
    if (Number.isFinite(n)) {
      found = true
      if (n > max) max = n
    }
  }
  return found ? max : null
}

export function extractImporteImss(text: string, tipo: ImssDocTipo | null): number | null {
  if (tipo === "banco") {
    const m =
      text.match(/importe\s*total\s*:?\s*\$?\s*([\d,]+\.\d{2})/i) ||
      text.match(/importe\s*imss\s*:?\s*\$?\s*([\d,]+\.\d{2})/i)
    if (m) return parseMoney(m[1])
  }
  // Cédula SUA: el total a pagar es el mayor importe con signo $ del documento.
  return extractMaxMoney(text)
}

const RFC_DASHED_RE = /\b([A-ZÑ&]{3,4})-?(\d{6})-?([A-Z0-9]{3})\b/g

/** RFC de bancos que aparecen al pie de sus comprobantes; nunca son del contribuyente. */
const RFC_BANCOS = new Set([
  "BBA830831LJ2", // BBVA México
  "BNM840515VB1", // Banamex
  "BSM970519DU8", // Santander
  "BMN930209927", // Banorte
  "HMI950125KG8", // HSBC
  "BIN931011519", // Inbursa
  "BBA940707IE1", // BanBajío
  "BAF950102JP5", // Afirme
  "SIN9412025I4", // Scotiabank
])

export function extractRfcImss(text: string): string | null {
  const up = text.toUpperCase()
  // Preferir el RFC del contribuyente ligado al registro patronal ("...RMN-150307-UW8").
  const patronal = up.match(/[A-Z]\d{2}-\d{5}-\d{2}-\d([A-ZÑ&]{3,4})-?(\d{6})-?([A-Z0-9]{3})/)
  if (patronal) return `${patronal[1]}${patronal[2]}${patronal[3]}`
  for (const m of up.matchAll(RFC_DASHED_RE)) {
    const rfc = `${m[1]}${m[2]}${m[3]}`
    if (RFC_BANCOS.has(rfc)) continue
    // Descarta el RFC del pie del banco ("... INSTITUCIÓN DE BANCA MÚLTIPLE ... RFC XXX").
    const before = stripAccents(up.slice(Math.max(0, (m.index ?? 0) - 250), m.index ?? 0))
    if (before.includes("BANCA MULTIPLE") || before.includes("GRUPO FINANCIERO")) continue
    return rfc
  }
  return null
}

function extractRazonSocial(text: string, tipo: ImssDocTipo | null): string | null {
  const clean = (s: string) => s.trim().replace(/\s+/g, " ")
  if (tipo === "banco") {
    const m = text.match(/titular\s*de\s*la\s*cuenta\s*:?\s*([A-ZÑ&][A-ZÑ&0-9 .,-]{6,70})/i)
    if (m) return clean(m[1])
  }
  const g = text.match(/([A-ZÑ&][A-ZÑ&0-9 .,-]{5,70}?\s+SA\s+DE\s+CV)/)
  return g ? clean(g[1]) : null
}

function importeEtiqueta(text: string, etiqueta: string): number | null {
  const m = text.match(new RegExp(`importe\\s*${etiqueta}:?\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)`, "i"))
  return m ? parseMoney(m[1]) : null
}

/**
 * El comprobante bancario del SUA desglosa "Importe IMSS / RCV / Vivienda / ACV",
 * así que de ahí sale con certeza. La propuesta SIPARE no trae un desglose
 * confiable en texto plano, por eso se usa el nombre del archivo como respaldo.
 */
export function detectConceptoImss(text: string, archivo: string, tipo: ImssDocTipo | null): ImssConcepto | null {
  if (tipo === "banco") {
    const imss = importeEtiqueta(text, "imss")
    const rcv = importeEtiqueta(text, "rcv") ?? 0
    const viv = importeEtiqueta(text, "vivienda") ?? 0
    const acv = importeEtiqueta(text, "acv") ?? 0
    if (imss != null) {
      const bim = rcv + viv + acv
      if (imss > 0 && bim > 0) return "mixto"
      if (imss > 0) return "imss"
      if (bim > 0) return "rcv-infonavit"
    }
  }
  const f = norm(archivo)
  if (/infonavit|rcv|vivienda|bimestr/.test(f)) return "rcv-infonavit"
  if (/imss|sipare|sua/.test(f)) return "imss"
  return null
}

function conceptoCompatible(a: ImssConcepto | null, b: ImssConcepto | null): boolean {
  if (!a || !b || a === b) return true
  return a === "mixto" || b === "mixto"
}

export function analyzeImssDoc(text: string, archivo: string, usedOcr = false): ImssDocAnalysis {
  const tipo = detectImssTipo(text)
  return {
    concepto: detectConceptoImss(text, archivo, tipo),
    tipo,
    archivo,
    lineaCaptura: extractLineaCapturaImss(text),
    folioSua: extractFolioSua(text),
    registroPatronal: extractRegistroPatronal(text),
    importe: extractImporteImss(text, tipo),
    periodo: extractPeriodoImss(text, tipo),
    rfc: extractRfcImss(text),
    razonSocial: extractRazonSocial(text, tipo),
    usedOcr,
  }
}

export type LinkVia = "linea" | "folio" | "registro"

export interface ImssCrossEval {
  status: MatchStatus | null
  linkVia: LinkVia | null
  lineaMatch: boolean | null
  folioMatch: boolean | null
  registroMatch: boolean | null
  importeMatch: boolean | null
  mesMatch: boolean | null
  diffImporte: number | null
  detalle: string
}

/** Tolerancia de importe: el mayor entre ±$1 y ±1% del importe de la cédula. */
export function importeTolerance(base: number): number {
  return Math.max(1, base * 0.01)
}

function folioContains(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null
  const x = a.replace(/\D/g, "")
  const y = b.replace(/\D/g, "")
  if (x.length < 6 || y.length < 6) return null
  return x === y || x.startsWith(y) || y.startsWith(x)
}

/**
 * Cruza cédula SIPARE ↔ comprobante bancario con la cascada de anclas:
 *  1) Línea de captura (ancla primaria).
 *  2) Si el banco no la trae → folio SUA o registro patronal (respaldo).
 * Corrobora con importe (tolerancia) y período contra el mes en revisión.
 */
export function evaluatePagoImss(
  sipare: ImssDocAnalysis | undefined,
  banco: ImssDocAnalysis | undefined,
  mesObjetivo: string,
): ImssCrossEval {
  const base: ImssCrossEval = {
    status: null,
    linkVia: null,
    lineaMatch: null,
    folioMatch: null,
    registroMatch: null,
    importeMatch: null,
    mesMatch: null,
    diffImporte: null,
    detalle: "",
  }
  if (!sipare && !banco) return { ...base, detalle: "Carga la cédula SIPARE y el comprobante bancario." }
  if (!sipare) return { ...base, status: "REVISAR", detalle: "Falta la cédula/propuesta SIPARE del IMSS." }
  if (!banco) return { ...base, status: "REVISAR", detalle: "Falta el comprobante de pago del banco." }

  const bothLinea = sipare.lineaCaptura != null && banco.lineaCaptura != null
  const lineaMatch = bothLinea ? sipare.lineaCaptura === banco.lineaCaptura : null
  const folioMatch = folioContains(sipare.folioSua, banco.folioSua)
  const registroMatch =
    sipare.registroPatronal != null && banco.registroPatronal != null
      ? sipare.registroPatronal === banco.registroPatronal
      : null

  let importeMatch: boolean | null = null
  let diffImporte: number | null = null
  if (sipare.importe != null && banco.importe != null) {
    diffImporte = Math.abs(sipare.importe - banco.importe)
    importeMatch = diffImporte <= importeTolerance(sipare.importe)
  }

  const periodoRef = sipare.periodo ?? banco.periodo
  const mesMatch = periodoRef != null ? periodoRef === mesObjetivo : null

  const partial = { ...base, lineaMatch, folioMatch, registroMatch, importeMatch, mesMatch, diffImporte }

  // 1) Ancla primaria: línea de captura presente en ambos.
  if (bothLinea) {
    if (!lineaMatch) {
      return {
        ...partial,
        linkVia: "linea",
        status: "NO_OK",
        detalle: "La línea de captura del banco no coincide con la del SIPARE: el pago no corresponde a esta cédula.",
      }
    }
    return finishEval({ ...partial, linkVia: "linea" }, mesObjetivo, sipare, "línea de captura")
  }

  // 2) Respaldo: folio SUA o registro patronal.
  if (folioMatch === true) return finishEval({ ...partial, linkVia: "folio" }, mesObjetivo, sipare, "folio SUA")
  if (registroMatch === true)
    return finishEval({ ...partial, linkVia: "registro" }, mesObjetivo, sipare, "registro patronal")

  return {
    ...partial,
    status: "REVISAR",
    detalle:
      "No se pudo vincular los documentos: el banco no trae línea de captura y no coinciden el folio SUA ni el registro patronal.",
  }
}

function finishEval(
  ev: ImssCrossEval,
  mesObjetivo: string,
  sipare: ImssDocAnalysis,
  anclaLabel: string,
): ImssCrossEval {
  if (ev.importeMatch === false) {
    return {
      ...ev,
      status: "NO_OK",
      detalle: `Coincide el ${anclaLabel}, pero el importe pagado difiere del de la cédula por $${ev.diffImporte?.toLocaleString(
        "es-MX",
        { minimumFractionDigits: 2 },
      )}.`,
    }
  }
  if (ev.importeMatch == null) {
    return { ...ev, status: "REVISAR", detalle: `Coincide el ${anclaLabel}, pero no se pudo leer el importe en ambos documentos.` }
  }
  if (ev.mesMatch === false) {
    const per = sipare.periodo ?? mesObjetivo
    return {
      ...ev,
      status: "REVISAR",
      detalle: `Pago correcto, pero el período es ${formatMonth(per)} — fuera del mes revisado (${formatMonth(mesObjetivo)}).`,
    }
  }
  if (ev.mesMatch == null) {
    return { ...ev, status: "REVISAR", detalle: `Coincide el ${anclaLabel} y el importe, pero no se detectó el período del pago.` }
  }
  return {
    ...ev,
    status: "OK",
    detalle: `Coincide el ${anclaLabel} y el importe, y el pago corresponde a ${formatMonth(mesObjetivo)}.`,
  }
}

export function formatMoney(n: number | null): string {
  if (n == null) return "—"
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface ImssPair {
  /** Identificador del registro patronal (o el mejor dato disponible). */
  registro: string | null
  sipare?: ImssDocAnalysis
  banco?: ImssDocAnalysis
}

/**
 * Agrupa los documentos IMSS en pares SIPARE ↔ comprobante bancario, uno por
 * registro patronal. Un proveedor con varios registros sube varias cédulas y
 * varios comprobantes; cada cédula se empareja con su banco por la cascada de
 * anclas (línea de captura → folio SUA → registro patronal). Los comprobantes
 * que no logran vincularse a ninguna cédula quedan como pares sueltos.
 */
export function pairImssDocs(docs: ImssDocAnalysis[]): ImssPair[] {
  const sipares = docs.filter((d) => d.tipo === "sipare")
  const bancos = docs.filter((d) => d.tipo === "banco")
  const usados = new Set<number>()
  const pairs: ImssPair[] = []

  for (const s of sipares) {
    let idx = bancos.findIndex(
      (b, i) => !usados.has(i) && s.lineaCaptura != null && b.lineaCaptura === s.lineaCaptura,
    )
    // En los respaldos (folio / registro) se exige que el concepto sea compatible:
    // la propuesta RCV/INFONAVIT comparte registro patronal con la de IMSS y no
    // debe "robarse" el comprobante del pago mensual.
    if (idx === -1) {
      idx = bancos.findIndex(
        (b, i) =>
          !usados.has(i) && conceptoCompatible(s.concepto, b.concepto) && folioContains(s.folioSua, b.folioSua) === true,
      )
    }
    if (idx === -1) {
      idx = bancos.findIndex(
        (b, i) =>
          !usados.has(i) &&
          conceptoCompatible(s.concepto, b.concepto) &&
          s.registroPatronal != null &&
          b.registroPatronal === s.registroPatronal,
      )
    }
    let banco: ImssDocAnalysis | undefined
    if (idx !== -1) {
      banco = bancos[idx]
      usados.add(idx)
    }
    pairs.push({ registro: s.registroPatronal ?? s.folioSua ?? s.lineaCaptura ?? null, sipare: s, banco })
  }

  bancos.forEach((b, i) => {
    if (!usados.has(i)) {
      pairs.push({ registro: b.registroPatronal ?? b.folioSua ?? null, sipare: undefined, banco: b })
    }
  })

  return pairs
}

/** Estatus consolidado: el peor de todos los pares (NO_OK > REVISAR > OK). */
export function rollupImssStatus(statuses: (MatchStatus | null)[]): MatchStatus | null {
  if (statuses.length === 0) return null
  if (statuses.some((s) => s === "NO_OK")) return "NO_OK"
  if (statuses.some((s) => s === "REVISAR" || s == null)) return "REVISAR"
  return "OK"
}
