import type { MatchStatus } from "./types"

const CURP_PATTERN = /[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/g

/** Colapsa el texto a mayúsculas y solo A-Z0-9, uniendo saltos de línea/espacios. */
export function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Extrae todas las CURP válidas presentes en el texto del PDF. */
export function extractCurps(text: string): Set<string> {
  const norm = normalize(text)
  const set = new Set<string>()
  const re = new RegExp(CURP_PATTERN)
  let m: RegExpExecArray | null
  while ((m = re.exec(norm)) !== null) set.add(m[0])
  return set
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return dp[m]
}

export interface MatchOutcome {
  status: MatchStatus
  detalle?: string
  /** CURP tal como aparece en la cédula (exacta o la más parecida). */
  matchedCurp?: string
}

export interface ImssExtraction {
  days: Map<string, number>
  /** Diagnóstico visible para el usuario cuando algo no cuadra. */
  diagnostics: {
    textLength: number
    curpsFound: number
    movementsFound: number
    totalDays: number
    sample: string
  }
}

/**
 * Extrae los días PAGADOS por cotizante de la cédula IMSS.
 *
 * Robustez: pdf.js puede aplanar el texto en una sola línea, con espaciado
 * variable y celdas en orden visual. Por eso NO dependemos de saltos de línea
 * ni de un patrón rígido decimal→enteros→decimal. En su lugar:
 *
 *  1. Localizamos cada CURP y tomamos el segmento de texto entre una CURP y la
 *     siguiente (el "renglón" de ese cotizante, aunque tenga varios movimientos).
 *  2. Dentro de ese segmento buscamos tripletas de enteros pequeños (0–366) que
 *     representan [Días, Incapacidad, Ausentismo] por movimiento, ignorando los
 *     números con decimales (importes) y los tokens largos (NSS, folios).
 *  3. Días pagados = Días − Incapacidad − Ausentismo (esos no se pagan), y se
 *     suman todos los movimientos del cotizante.
 */
export function extractImssDaysByCurp(text: string): ImssExtraction {
  const flat = text.replace(/\s+/g, " ").trim()
  const upper = flat.toUpperCase()
  const map = new Map<string, number>()

  const curpHits: { curp: string; index: number }[] = []
  const curpRe = new RegExp(CURP_PATTERN.source, "g")
  let cm: RegExpExecArray | null
  while ((cm = curpRe.exec(upper)) !== null) {
    curpHits.push({ curp: cm[0], index: cm.index })
  }

  let movementsFound = 0
  for (let i = 0; i < curpHits.length; i++) {
    const start = curpHits[i].index + curpHits[i].curp.length
    const end = i + 1 < curpHits.length ? curpHits[i + 1].index : flat.length
    const segment = flat.slice(start, end)
    const dias = extractDaysFromSegment(segment)
    if (dias.length > 0) {
      movementsFound += dias.length
      const sum = dias.reduce((a, b) => a + b, 0)
      map.set(curpHits[i].curp, (map.get(curpHits[i].curp) ?? 0) + sum)
    }
  }

  const totalDays = [...map.values()].reduce((a, b) => a + b, 0)
  const sampleStart = curpHits.length > 0 ? curpHits[0].index : 0
  return {
    days: map,
    diagnostics: {
      textLength: flat.length,
      curpsFound: curpHits.length,
      movementsFound,
      totalDays,
      sample: flat.slice(sampleStart, sampleStart + 300),
    },
  }
}

/**
 * Dado el segmento de un cotizante, devuelve los días pagados de cada
 * movimiento. Tokeniza y detecta tripletas de enteros pequeños [Días Inc Aus]
 * que van precedidas por al menos un importe con decimales (fin de la parte
 * monetaria del renglón).
 */
function extractDaysFromSegment(segment: string): number[] {
  const tokens = segment.split(/\s+/).filter(Boolean)
  const result: number[] = []
  // Un entero "de días" es 0–366 sin decimales ni comas ni letras.
  const isSmallInt = (t: string) => /^\d{1,3}$/.test(t) && Number(t) <= 366
  const isMoney = (t: string) => /\d[\d,]*\.\d{2}$/.test(t)

  for (let i = 0; i < tokens.length - 2; i++) {
    // Debe existir un importe monetario justo antes del bloque de días.
    if (i === 0 || !isMoney(tokens[i - 1])) continue
    if (isSmallInt(tokens[i]) && isSmallInt(tokens[i + 1]) && isSmallInt(tokens[i + 2])) {
      const dias = Number(tokens[i]) - Number(tokens[i + 1]) - Number(tokens[i + 2])
      // El siguiente token suele ser otro importe (I.V. obrero) -> valida el renglón.
      if (isMoney(tokens[i + 3] ?? "")) {
        result.push(Math.max(0, dias))
        i += 3
      }
    }
  }
  if (result.length > 0) return result

  // Formato alterno: el bloque [Días Inc Aus] solo tiene un importe a un lado,
  // o los días van antes de los importes. Exigimos Días 1–31 e Inc/Aus <= Días.
  for (let i = 0; i < tokens.length - 2; i++) {
    const [d, inc, aus] = [tokens[i], tokens[i + 1], tokens[i + 2]]
    if (!isSmallInt(d) || !isSmallInt(inc) || !isSmallInt(aus)) continue
    const nd = Number(d)
    if (nd < 1 || nd > 31 || Number(inc) > nd || Number(aus) > nd) continue
    const moneyBefore = i > 0 && isMoney(tokens[i - 1])
    const moneyAfter = isMoney(tokens[i + 3] ?? "")
    if (!moneyBefore && !moneyAfter) continue
    result.push(Math.max(0, nd - Number(inc) - Number(aus)))
    i += 2
  }
  return result
}

/**
 * Regla de conciliación:
 *  - OK       -> la CURP aparece exacta en el texto del PDF (subcadena)
 *  - REVISAR  -> hay una CURP a distancia de edición <= 1 (típico error de OCR)
 *  - NO_OK    -> no existe ni siquiera una coincidencia aproximada
 */
export function matchCurp(
  curp: string,
  pdfNormalized: string,
  pdfCurps: Set<string>,
): MatchOutcome {
  if (!curp) return { status: "NO_OK", detalle: "CFDI sin CURP" }
  if (pdfNormalized.includes(curp)) return { status: "OK", matchedCurp: curp }

  let best = Number.POSITIVE_INFINITY
  let bestMatch = ""
  for (const c of pdfCurps) {
    const d = levenshtein(curp, c)
    if (d < best) {
      best = d
      bestMatch = c
    }
    if (best === 0) break
  }

  if (best <= 1 && bestMatch) {
    return {
      status: "REVISAR",
      detalle: `Similar a ${bestMatch} (dif. ${best} car.)`,
      matchedCurp: bestMatch,
    }
  }
  return { status: "NO_OK", detalle: "CURP no encontrada en la cédula" }
}

/** Tokens significativos de un nombre (ignora conectores como DE, LA, Y). */
function nameTokens(nombre: string): string[] {
  return nombre
    .toUpperCase()
    .replace(/[^A-ZÑ\s]/g, " ")
    .replace(/Ñ/g, "N")
    .split(/\s+/)
    .filter((t) => t.length >= 4)
}

/**
 * ¿Aparece el nombre del trabajador en el texto de la cédula? Compara por
 * tokens (apellidos y nombres) como subcadenas del texto normalizado, así que
 * es inmune al orden (la cédula suele listar "APELLIDOS NOMBRE" y el CFDI
 * "NOMBRE APELLIDOS"). Tolera 1 token perdido por errores de OCR cuando hay 3+.
 */
function matchByName(nombre: string, pdfNormalized: string): { ok: boolean; hits: number; total: number } {
  const tokens = nameTokens(nombre)
  if (tokens.length < 2) return { ok: false, hits: 0, total: tokens.length }
  const hits = tokens.filter((t) => pdfNormalized.includes(t)).length
  const needed = tokens.length >= 3 ? tokens.length - 1 : tokens.length
  return { ok: hits >= needed, hits, total: tokens.length }
}

export interface EmpleadoMatchInput {
  curp: string
  nss?: string
  nombre?: string
}

/**
 * Conciliación robusta de un trabajador contra la cédula IMSS, en cascada:
 *  1. CURP exacta -> OK.
 *  2. NSS (11 dígitos) presente en la cédula -> OK (la CURP pudo leerse mal por OCR).
 *  3. Nombre completo presente por tokens -> REVISAR (verificar CURP/NSS).
 *  4. CURP a distancia <= 1 -> REVISAR.
 *  5. Nada -> NO_OK.
 * Evita falsos NO_OK cuando el OCR degrada la CURP pero el NSS o el nombre sí se leen.
 */
export function matchEmpleado(
  rec: EmpleadoMatchInput,
  pdfNormalized: string,
  pdfCurps: Set<string>,
): MatchOutcome {
  const byCurp = matchCurp(rec.curp, pdfNormalized, pdfCurps)
  if (byCurp.status === "OK") return byCurp

  const nss = (rec.nss ?? "").replace(/\D/g, "")
  if (nss.length === 11 && pdfNormalized.includes(nss)) {
    return {
      status: "OK",
      detalle: "Cruzado por NSS (CURP no coincide exacta en la cédula)",
      matchedCurp: byCurp.matchedCurp,
    }
  }

  const name = matchByName(rec.nombre ?? "", pdfNormalized)
  if (name.ok) {
    return {
      status: "REVISAR",
      detalle: `Cruzado por nombre (${name.hits}/${name.total}); verificar CURP/NSS`,
      matchedCurp: byCurp.matchedCurp,
    }
  }

  return byCurp
}
