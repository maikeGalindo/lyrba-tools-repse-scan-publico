import type { MatchStatus } from "./types"
import { detectRfc, formatMonth } from "./constancias"

export type SatDocTipo = "acuse" | "banco"

export interface SatDocAnalysis {
  tipo: SatDocTipo | null
  archivo: string
  /** Línea de captura normalizada (sin espacios, mayúsculas). */
  lineaCaptura: string | null
  importe: number | null
  /** Mes de la declaración "YYYY-MM"; solo el acuse lo trae. */
  mes: string | null
  rfc: string | null
  razonSocial: string | null
  numeroOperacion: string | null
  usedOcr: boolean
}

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
  // Colapsa todos los espacios/saltos de línea a uno solo para que las búsquedas
  // por subcadena no fallen cuando el PDF parte una frase con un salto de línea.
  return stripAccents(s).toLowerCase().replace(/\s+/g, " ")
}

function countDigits(s: string) {
  return (s.match(/\d/g) || []).length
}

/**
 * Clasifica el documento por su encabezado. El ACUSE se evalúa PRIMERO porque
 * su página 3 menciona la frase "obteniendo como comprobante el Recibo Bancario
 * de Pago de Contribuciones Federales", que antes lo hacía caer como banco.
 * Los marcadores del acuse ("declaración provisional o definitiva de impuestos
 * federales", "acuse de recibo") no aparecen ni en el recibo bancario puro ni
 * en la "información registrada de pagos" del SAT, así que priorizarlos es seguro.
 */
export function detectSatTipo(text: string): SatDocTipo | null {
  const t = norm(text)
  // 1) Acuse de la declaración (tiene prioridad sobre cualquier señal bancaria).
  if (t.includes("declaracion provisional o definitiva de impuestos federales")) return "acuse"
  if (t.includes("acuse de recibo") && t.includes("periodo de la declaracion")) return "acuse"
  // 2) Comprobantes de pago (banco o prueba de pago en la BD del SAT).
  if (t.includes("recibo bancario de pago de contribuciones")) return "banco"
  if (t.includes("informacion registrada de pagos")) return "banco"
  if (t.includes("importe pagado")) return "banco"
  // 3) Respaldos por contenido. Los acuses de SISUB/ICSOE también dicen
  // "acuse de recibo", pero no son declaraciones de impuestos.
  if (/sisub|icsoe|29 bis|subcontratacion/.test(t)) return null
  if (t.includes("acuse de recibo") || t.includes("seccion linea de captura") || t.includes("importe total a pagar"))
    return "acuse"
  return null
}

/**
 * La línea de captura del SAT son 20 caracteres alfanuméricos. En el acuse
 * viene en 5 grupos de 4 con espacios ("0426 5TZD 6600 5072 1491") y en el
 * banco pegada. Descartamos candidatos sin dígitos para no confundir el
 * encabezado "SECCIÓN LÍNEA DE CAPTURA" con el valor real.
 */
export function extractLineaCaptura(text: string): string | null {
  // Forma agrupada (acuse): 5 grupos de 4, el primero de dígitos.
  const grouped = text.match(
    /(\d{4})[ \t]+([0-9A-Za-z]{4})[ \t]+([0-9A-Za-z]{4})[ \t]+([0-9A-Za-z]{4})[ \t]+([0-9A-Za-z]{4})/,
  )
  if (grouped) {
    const c = grouped.slice(1, 6).join("").toUpperCase()
    if (countDigits(c) >= 6) return c
  }
  // Anclado a la etiqueta: recorre todas las coincidencias y descarta las que
  // no parezcan línea de captura (el encabezado captura texto sin dígitos).
  const re = /l[ií]nea\s*de\s*captura:?\s*([0-9A-Za-z][0-9A-Za-z\s]{18,70})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const compact = m[1].replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 20)
    if (compact.length >= 20 && countDigits(compact) >= 6) return compact
  }
  return null
}

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

export function extractImporte(text: string, tipo: SatDocTipo | null): number | null {
  let m: RegExpMatchArray | null = null
  if (tipo === "banco") {
    m = text.match(/importe\s*pagado:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i)
  } else {
    m = text.match(/importe\s*total\s*a\s*pagar:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i)
  }
  if (!m) m = text.match(/importe[^$\d]{0,20}\$?\s*([\d,]+(?:\.\d+)?)/i)
  return m ? parseMoney(m[1]) : null
}

function extractMes(text: string): string | null {
  const mMes = text.match(/per[ií]odo\s*de\s*la\s*declaraci[oó]n:?\s*([A-Za-zÁÉÍÓÚáéíóúñ]+)/i)
  const mAnio = text.match(/ejercicio:?\s*(\d{4})/i)
  if (!mMes || !mAnio) return null
  const mn = MES_NUM[norm(mMes[1])]
  if (!mn) return null
  return `${mAnio[1]}-${mn}`
}

function extractRazonSocial(text: string): string | null {
  const m = text.match(
    /denominaci[oó]n\s*o\s*raz[oó]n\s*social:?\s*([A-Za-zÑñÁÉÍÓÚáéíóú0-9 ,.&-]+?)(?:\s*tipo\s*de\s*declaraci|\s*hoja|\s*rfc|\n|$)/i,
  )
  if (m) return m[1].trim().replace(/\s+/g, " ")
  const t = text.match(
    /nombre\s*del\s*titular\s*cuenta\s*cargo:?\s*([A-Za-zÑñÁÉÍÓÚáéíóú0-9 ,.&-]+?)(?:\s*importe|\n|$)/i,
  )
  return t ? t[1].trim().replace(/\s+/g, " ") : null
}

function extractNumeroOperacion(text: string): string | null {
  const m = text.match(/n[uú]mero\s*de\s*operaci[oó]n:?\s*(\d{4,})/i) || text.match(/no\.\s*de\s*operaci[oó]n:?\s*(\d{4,})/i)
  return m ? m[1] : null
}

export function analyzeSatDoc(text: string, archivo: string, usedOcr = false): SatDocAnalysis {
  const tipo = detectSatTipo(text)
  return {
    tipo,
    archivo,
    lineaCaptura: extractLineaCaptura(text),
    importe: extractImporte(text, tipo),
    // La "Información registrada de pagos" del SAT también trae el periodo declarado.
    mes: extractMes(text),
    rfc: detectRfc(text),
    razonSocial: extractRazonSocial(text),
    numeroOperacion: extractNumeroOperacion(text),
    usedOcr,
  }
}

export interface SatCrossEval {
  status: MatchStatus | null
  lineaMatch: boolean | null
  importeMatch: boolean | null
  mesMatch: boolean | null
  diffImporte: number | null
  detalle: string
}

/** Tolerancia de importe: el mayor entre ±$1 y ±1% del importe del acuse. */
export function importeTolerance(base: number): number {
  return Math.max(1, base * 0.01)
}

/**
 * Cruza acuse ↔ banco según la jerarquía definida: línea de captura, importe
 * (con tolerancia) y mes de la declaración contra el mes en revisión.
 */
export function evaluatePagoSat(
  acuse: SatDocAnalysis | undefined,
  banco: SatDocAnalysis | undefined,
  mesObjetivo: string,
): SatCrossEval {
  const base: SatCrossEval = {
    status: null,
    lineaMatch: null,
    importeMatch: null,
    mesMatch: null,
    diffImporte: null,
    detalle: "",
  }
  if (!acuse && !banco) return { ...base, detalle: "Carga el acuse del SAT y el comprobante bancario." }
  if (!acuse) return { ...base, status: "REVISAR", detalle: "Falta el acuse de recibo del SAT." }
  if (!banco) return { ...base, status: "REVISAR", detalle: "Falta el comprobante de pago del banco." }

  const lineaMatch =
    acuse.lineaCaptura != null && banco.lineaCaptura != null && acuse.lineaCaptura === banco.lineaCaptura

  let importeMatch: boolean | null = null
  let diffImporte: number | null = null
  if (acuse.importe != null && banco.importe != null) {
    diffImporte = Math.abs(acuse.importe - banco.importe)
    importeMatch = diffImporte <= importeTolerance(acuse.importe)
  }

  const mesMatch = acuse.mes != null ? acuse.mes === mesObjetivo : null

  // Línea de captura: ancla primaria. Si no coincide, los documentos no corresponden.
  if (acuse.lineaCaptura == null || banco.lineaCaptura == null) {
    return {
      ...base,
      lineaMatch,
      importeMatch,
      mesMatch,
      diffImporte,
      status: "REVISAR",
      detalle: "No se pudo leer la línea de captura en uno de los documentos.",
    }
  }
  if (!lineaMatch) {
    return {
      ...base,
      lineaMatch: false,
      importeMatch,
      mesMatch,
      diffImporte,
      status: "NO_OK",
      detalle: "La línea de captura del banco no coincide con la del acuse: el pago no corresponde a esta declaración.",
    }
  }
  if (importeMatch === false) {
    return {
      ...base,
      lineaMatch: true,
      importeMatch: false,
      mesMatch,
      diffImporte,
      status: "NO_OK",
      detalle: `La línea de captura coincide, pero el importe pagado difiere del declarado por $${diffImporte?.toLocaleString("es-MX", { minimumFractionDigits: 2 })}.`,
    }
  }
  if (mesMatch === false) {
    return {
      ...base,
      lineaMatch: true,
      importeMatch: importeMatch ?? null,
      mesMatch: false,
      diffImporte,
      status: "REVISAR",
      detalle: `Pago correcto, pero la declaración es de ${formatMonth(acuse.mes)} — fuera del mes revisado (${formatMonth(mesObjetivo)}).`,
    }
  }
  if (mesMatch == null) {
    return {
      ...base,
      lineaMatch: true,
      importeMatch: importeMatch ?? null,
      mesMatch: null,
      diffImporte,
      status: "REVISAR",
      detalle: "Línea de captura e importe coinciden, pero no se detectó el período de la declaración.",
    }
  }
  return {
    ...base,
    lineaMatch: true,
    importeMatch: true,
    mesMatch: true,
    diffImporte,
    status: "OK",
    detalle: `Línea de captura e importe coinciden y la declaración corresponde a ${formatMonth(mesObjetivo)}.`,
  }
}

/* ------------------------------------------------------------------------ */
/* Varias declaraciones por archivo (ISR e IVA por separado, cada una con su */
/* recibo bancario dentro del mismo PDF).                                    */
/* ------------------------------------------------------------------------ */

export interface SatDeclaracion {
  archivo: string
  numeroOperacion: string | null
  /** Conceptos declarados ("ISR retenciones por salarios", "IVA retenciones"…). */
  conceptos: string[]
  lineaCaptura: string | null
  /** Cantidad a pagar de la declaración (0 cuando un estímulo la cubre). */
  importe: number | null
  mes: string | null
  rfc: string | null
}

export interface SatPagoBanco {
  archivo: string
  lineaCaptura: string | null
  importe: number | null
  numeroOperacion: string | null
}

function isPagoPage(t: string): boolean {
  if (t.includes("acuse de recibo") || t.includes("declaracion provisional o definitiva")) return false
  return (
    t.includes("recibo bancario de pago de contribuciones") ||
    t.includes("informacion registrada de pagos") ||
    t.includes("importe pagado")
  )
}

function extractConceptos(text: string): string[] {
  const out: string[] = []
  const re =
    /concepto\s*de\s*pago\s*\d+:?\s*(?:\d+\s+)?(.{3,120}?)\s+(?:impuesto\s+a\s+cargo|a\s+cargo|cantidad\s+a\s+cargo)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const c = m[1].replace(/\s+/g, " ").trim()
    if (c && !out.some((o) => norm(o) === norm(c))) out.push(c)
  }
  return out
}

function extractCantidadAPagar(text: string): number | null {
  const total = text.match(/importe\s*total\s*a\s*pagar:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i)
  if (total) return parseMoney(total[1])
  const re = /cantidad\s*a\s*pagar:?\s*\$?\s*([\d,]+(?:\.\d+)?)/gi
  let max: number | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = parseMoney(m[1])
    if (n != null && (max == null || n > max)) max = n
  }
  return max
}

/**
 * Separa un PDF del SAT en declaraciones (agrupadas por número de operación
 * del acuse) y recibos bancarios. El texto extraído trae una página por línea.
 */
export function extractSatPartes(
  text: string,
  archivo: string,
): { declaraciones: SatDeclaracion[]; pagos: SatPagoBanco[] } {
  const pages = text.split("\n").filter((p) => p.trim())
  const groups = new Map<string, string[]>()
  const pagos: SatPagoBanco[] = []
  let lastKey: string | null = null

  for (const page of pages) {
    const t = norm(page)
    if (isPagoPage(t)) {
      pagos.push({
        archivo,
        lineaCaptura: extractLineaCaptura(page),
        importe: extractImporte(page, "banco"),
        numeroOperacion: extractNumeroOperacion(page),
      })
      continue
    }
    const op = extractNumeroOperacion(page)
    const key: string | null = op ?? lastKey
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(page)
    lastKey = key
  }

  const declaraciones: SatDeclaracion[] = []
  for (const [op, parts] of groups) {
    const body = parts.join("\n")
    if (detectSatTipo(body) !== "acuse") continue
    declaraciones.push({
      archivo,
      numeroOperacion: op,
      conceptos: extractConceptos(body),
      lineaCaptura: extractLineaCaptura(body),
      importe: extractCantidadAPagar(body),
      mes: extractMes(body),
      rfc: detectRfc(body),
    })
  }

  // Documentos sin número de operación legible (p. ej. OCR): se tratan completos.
  if (declaraciones.length === 0 && pagos.length === 0) {
    const tipo = detectSatTipo(text)
    if (tipo === "acuse") {
      declaraciones.push({
        archivo,
        numeroOperacion: extractNumeroOperacion(text),
        conceptos: extractConceptos(text),
        lineaCaptura: extractLineaCaptura(text),
        importe: extractCantidadAPagar(text),
        mes: extractMes(text),
        rfc: detectRfc(text),
      })
    } else if (tipo === "banco") {
      pagos.push({
        archivo,
        lineaCaptura: extractLineaCaptura(text),
        importe: extractImporte(text, "banco"),
        numeroOperacion: extractNumeroOperacion(text),
      })
    }
  }
  return { declaraciones, pagos }
}

export interface SatDeclaracionEval {
  declaracion: SatDeclaracion
  pago: SatPagoBanco | null
  status: MatchStatus
  lineaMatch: boolean | null
  importeMatch: boolean | null
  mesMatch: boolean | null
  detalle: string
}

export interface SatConciliacion {
  status: MatchStatus | null
  headline: string
  evals: SatDeclaracionEval[]
  /** Comprobantes que no corresponden a ninguna declaración cargada. */
  pagosSinDeclaracion: SatPagoBanco[]
}

export function conceptoLabel(d: SatDeclaracion): string {
  if (d.conceptos.length) return d.conceptos.join(" · ")
  return d.numeroOperacion ? `Declaración ${d.numeroOperacion}` : d.archivo
}

/** Junta todas las declaraciones y pagos del expediente y los concilia uno a uno. */
export function conciliarSat(files: { text: string; name: string }[], mesObjetivo: string): SatConciliacion {
  const declMap = new Map<string, SatDeclaracion>()
  const pagos: SatPagoBanco[] = []
  for (const f of files) {
    const p = extractSatPartes(f.text, f.name)
    for (const d of p.declaraciones) {
      const key = d.numeroOperacion ?? `${d.archivo}#${declMap.size}`
      if (!declMap.has(key)) declMap.set(key, d)
    }
    for (const b of p.pagos) {
      if (!pagos.some((x) => x.lineaCaptura && x.lineaCaptura === b.lineaCaptura && x.importe === b.importe)) pagos.push(b)
    }
  }
  const decls = [...declMap.values()]
  const usados = new Set<SatPagoBanco>()

  const evals: SatDeclaracionEval[] = decls.map((d) => {
    const mesMatch = d.mes != null ? d.mes === mesObjetivo : null
    const pago = (d.lineaCaptura && pagos.find((b) => b.lineaCaptura === d.lineaCaptura)) || null
    if (pago) usados.add(pago)
    const base = { declaracion: d, pago, mesMatch }

    if (mesMatch === false)
      return {
        ...base,
        status: "REVISAR" as const,
        lineaMatch: pago ? true : null,
        importeMatch: null,
        detalle: `La declaración es de ${formatMonth(d.mes)}, fuera del mes revisado (${formatMonth(mesObjetivo)}).`,
      }

    if (d.importe === 0)
      return {
        ...base,
        status: mesMatch ? ("OK" as const) : ("REVISAR" as const),
        lineaMatch: null,
        importeMatch: null,
        detalle: mesMatch
          ? "Sin cantidad a pagar (cubierta por estímulos o compensación): no requiere comprobante."
          : "Sin cantidad a pagar, pero no se detectó el periodo de la declaración.",
      }

    if (!pago) {
      return {
        ...base,
        status: "REVISAR" as const,
        lineaMatch: null,
        importeMatch: null,
        detalle: d.lineaCaptura
          ? `Falta el comprobante de pago de la línea ${d.lineaCaptura} (${formatMoney(d.importe)}).`
          : "No se pudo leer la línea de captura de la declaración.",
      }
    }

    let importeMatch: boolean | null = null
    let diff = 0
    if (d.importe != null && pago.importe != null) {
      diff = Math.abs(d.importe - pago.importe)
      importeMatch = diff <= importeTolerance(d.importe)
    }
    if (importeMatch === false)
      return {
        ...base,
        status: "NO_OK" as const,
        lineaMatch: true,
        importeMatch,
        detalle: `La línea coincide, pero el importe pagado (${formatMoney(pago.importe)}) difiere del declarado (${formatMoney(d.importe)}).`,
      }
    if (importeMatch == null || mesMatch == null)
      return {
        ...base,
        status: "REVISAR" as const,
        lineaMatch: true,
        importeMatch,
        detalle:
          mesMatch == null
            ? "Pago localizado, pero no se detectó el periodo de la declaración."
            : "Pago localizado, pero no se pudo leer uno de los importes.",
      }
    return {
      ...base,
      status: "OK" as const,
      lineaMatch: true,
      importeMatch: true,
      detalle: `Pagado ${formatMoney(pago.importe)} con la línea de captura de la declaración.`,
    }
  })

  const pagosSinDeclaracion = pagos.filter((p) => !usados.has(p))

  let status: MatchStatus | null = null
  if (evals.length) {
    status = evals.some((e) => e.status === "NO_OK")
      ? "NO_OK"
      : evals.some((e) => e.status === "REVISAR")
        ? "REVISAR"
        : "OK"
  } else if (pagos.length) status = "REVISAR"

  let headline: string
  if (!evals.length)
    headline = pagos.length ? "Hay comprobante de pago, pero falta el acuse de la declaración." : "Carga el acuse del SAT y el comprobante bancario."
  else if (evals.length === 1) headline = evals[0].detalle
  else {
    const pagadas = evals.filter((e) => e.status === "OK" && e.pago).length
    const sinPago = evals.filter((e) => e.status === "OK" && !e.pago).length
    headline = `${evals.length} declaraciones · ${pagadas} con pago conciliado · ${sinPago} sin cantidad a pagar`
    const pend = evals.length - pagadas - sinPago
    if (pend) headline += ` · ${pend} por revisar`
    headline += "."
  }

  return { status, headline, evals, pagosSinDeclaracion }
}

export function formatMoney(n: number | null): string {
  if (n == null) return "—"
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
