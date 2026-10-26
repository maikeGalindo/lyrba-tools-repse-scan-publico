// Parser y consolidación para el módulo independiente "Histórico de cuotas IMSS".
//
// Cada PDF es una "Cédula de Determinación de Cuotas" del SUA y corresponde a UN
// registro patronal + UN período mensual. La lectura del PDF (capa de texto u
// OCR) ocurre en el navegador con pdf-extractor usando reconstrucción de filas
// por coordenada Y (preserveRows), de modo que el layout visual se conserva:
//
//   LÍNEA ANCLA (una por trabajador):
//     "12-34-56-7890-1   PEREZ LOPEZ JUAN PELJ800101HDFRPN09   COMPRAVENTA"
//     → NSS al inicio, luego el NOMBRE, luego el CURP, luego la actividad.
//
//   LÍNEA(S) DE NÚMEROS (una por movimiento del trabajador):
//     "[Clave Fecha]  Días  SDI  Lic Inc Aus  ...cuotas...  Patronal  Obrera  SubTotal"
//     → Días = primer entero; la cuota obrero-patronal del trabajador es el
//       ÚLTIMO importe de la línea (SubTotal). Verificado: la suma de SubTotales
//       cuadra con el "Total a pagar" de la cédula.
//
//   Cuando hay movimientos (Alta, Baja, Reing, M/S) la línea de números arranca
//   con la clave y una fecha dd/mm/aaaa que se descartan; se cuentan como
//   movimientos y se suman días y SubTotal de cada sub-renglón.
//
//   Los renglones de TOTALES de la cédula (p.ej. "207 4,953.78 ...") se excluyen
//   porque traen pocos tokens y/o días > 60 (imposible para un trabajador en un
//   mes). Los encabezados/pies repetidos por página no matchean ancla ni números.

const CURP_CORE = "[A-ZÑ]{4}\\d{6}[HM][A-Z]{5}[A-Z0-9]\\d"
const CURP_SEARCH = new RegExp(CURP_CORE)
const NSS_RE = /^(\d{2}-\d{2}-\d{2}-\d{4}-\d)\b/
const RP_RE = /[A-Z]\d{2}-\d{5}-\d{2}-\d/
const MONEY_RE = /^\d{1,3}(?:,\d{3})*\.\d{2}$|^\d+\.\d{2}$/
const BARE_INT_RE = /^\d{1,3}$/

const MESES = [
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

const MES_A_NUM: Record<string, string> = {
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
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  set: "09",
  oct: "10",
  nov: "11",
  dic: "12",
}

export interface CedulaHeader {
  registroPatronal: string | null
  rfc: string | null
  razonSocial: string | null
  periodo: string | null // "YYYY-MM"
}

export interface TrabajadorPeriodo {
  nss: string
  nombre: string
  curp: string | null
  registroPatronal: string | null
  razonSocial: string | null
  periodo: string | null // "YYYY-MM"
  dias: number
  sdi: number | null
  cuota: number
  movimientos: number
  archivo: string
}

export interface CedulaParseResult {
  archivo: string
  header: CedulaHeader
  trabajadores: TrabajadorPeriodo[]
  totalDeclarado: number | null
  cotizantesDeclarado: number | null
  sumaCuotas: number
  usedOcr: boolean
  warnings: string[]
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function toNum(s: string): number {
  return Number(s.replace(/,/g, ""))
}

function isMoney(t: string): boolean {
  return MONEY_RE.test(t)
}

function isBareInt(t: string): boolean {
  return BARE_INT_RE.test(t)
}

/** "YYYY-MM" legible: "Agosto 2026". */
export function periodoLabel(periodo: string | null): string {
  if (!periodo) return "—"
  const [y, m] = periodo.split("-")
  const idx = Number(m) - 1
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return periodo
  const nombre = MESES[idx]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`
}

export function formatMoneyMx(n: number | null): string {
  if (n == null) return "—"
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function normPeriodo(mesRaw: string, anio: string): string | null {
  const key = stripAccents(mesRaw).toLowerCase().replace(/\./g, "")
  const num = MES_A_NUM[key]
  if (num && /^\d{4}$/.test(anio)) return `${anio}-${num}`
  return null
}

function parseHeader(lines: string[], fullText: string): CedulaHeader {
  const rpMatch = fullText.match(RP_RE)
  const rfcMatch = fullText.match(/\b([A-ZÑ&]{3,4}-?\d{6}-?[A-Z0-9]{2,3})\b/)
  const perMatch = fullText.match(
    /Per[ií]odo\s+de\s+Proceso:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ.]+)[-/\s]+(\d{4})/i,
  )

  // Razón social: primera línea con texto tras la etiqueta "Nombre o Razón Social:".
  let razonSocial: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/Nombre\s+o\s+Raz[óo]n\s+Social:?\s*(.*)$/i)
    if (m) {
      const inline = m[1]
        .replace(/Delegaci[óo]n\s+IMSS.*$/i, "")
        .replace(/\s+/g, " ")
        .trim()
      if (inline && /[A-Za-z]/.test(inline)) {
        razonSocial = inline
      } else {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const cand = lines[j].trim()
          if (cand && !/^(RFC:|Actividad:)/i.test(cand) && /[A-Za-z]/.test(cand)) {
            razonSocial = cand.replace(/\s+/g, " ")
            break
          }
        }
      }
      break
    }
  }

  return {
    registroPatronal: rpMatch ? rpMatch[0].toUpperCase() : null,
    rfc: rfcMatch ? rfcMatch[1].toUpperCase().replace(/-/g, "") : null,
    razonSocial,
    periodo: perMatch ? normPeriodo(perMatch[1], perMatch[2]) : null,
  }
}

function parseDeclarados(
  lines: string[],
  text: string,
): { total: number | null; cotizantes: number | null } {
  const cotMatch = text.match(/Total\s+de\s+Cotizantes:?\s*(\d+)/i)
  const cotizantes = cotMatch ? Number(cotMatch[1]) : null

  // Caso inline: "Total a pagar: 565,894.81" en el mismo renglón.
  let total: number | null = null
  const inline = text.match(/Total\s+a\s+pagar:?\s*\$?\s*([\d,]+\.\d{2})/i)
  if (inline) {
    total = toNum(inline[1])
  } else {
    // Al reconstruir filas, el importe suele quedar en el renglón contiguo a la
    // etiqueta (p.ej. "Total a pagar:" y debajo "207 16,914.59"). Se toma el
    // mayor importe en la ventana [-1, +2] alrededor de la etiqueta.
    const idx = lines.findIndex((l) => /Total\s+a\s+pagar/i.test(l))
    if (idx >= 0) {
      let best = 0
      for (let i = Math.max(0, idx - 1); i <= Math.min(lines.length - 1, idx + 2); i++) {
        for (const tok of lines[i].split(/\s+/)) {
          if (isMoney(tok)) best = Math.max(best, toNum(tok))
        }
      }
      if (best > 0) total = best
    }
  }

  return { total, cotizantes }
}

interface NumeroLinea {
  dias: number
  sdi: number | null
  cuota: number
}

/**
 * Interpreta un renglón de movimiento de un trabajador. Devuelve null si el
 * renglón no es un movimiento válido (encabezado, pie, o renglón de totales).
 *
 * Estructura: [clave] [fecha dd/mm/aaaa] Días SDI Lic Inc Aus ...cuotas... SubTotal
 *   - Se descartan los tokens iniciales no numéricos (clave y fecha).
 *   - Días = primer entero; SDI = importe siguiente; cuota = último importe.
 *   - Se exige un mínimo de tokens numéricos (una fila real trae ~18) y días
 *     acotado a un mes, para excluir renglones de totales de la cédula.
 */
function parseNumeroLinea(line: string): NumeroLinea | null {
  const toks = line.split(/\s+/).filter(Boolean)
  // Descarta clave/fecha del inicio hasta el primer token numérico.
  let i = 0
  while (i < toks.length && !isBareInt(toks[i]) && !isMoney(toks[i])) i++
  const numeric = toks.slice(i)

  if (numeric.length < 10) return null // totales de cédula traen ~7-8 tokens
  if (!numeric.every((t) => isMoney(t) || isBareInt(t))) return null
  if (!isBareInt(numeric[0])) return null // el primer numérico debe ser Días (entero)

  const dias = toNum(numeric[0])
  if (dias > 60) return null // ningún trabajador cotiza >60 días en un mes → totales

  const sdi = isMoney(numeric[1]) ? toNum(numeric[1]) : null

  let cuota = 0
  for (let k = numeric.length - 1; k >= 0; k--) {
    if (isMoney(numeric[k])) {
      cuota = toNum(numeric[k])
      break
    }
  }

  return { dias, sdi, cuota }
}

interface WorkerAcc {
  nss: string
  curp: string | null
  nombre: string
  dias: number
  cuota: number
  sdi: number | null
  sdiDias: number
  movimientos: number
}

/**
 * Extrae los renglones de trabajador de una cédula ya leída como texto plano
 * (con filas reconstruidas por coordenada Y). `usedOcr` solo se propaga.
 */
export function parseCedula(text: string, archivo: string, usedOcr = false): CedulaParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const header = parseHeader(lines, text)
  const declarados = parseDeclarados(lines, text)
  const warnings: string[] = []

  const trabajadores: TrabajadorPeriodo[] = []
  let current: WorkerAcc | null = null

  const flush = () => {
    if (!current) return
    // Solo advierte si NO se encontró ningún renglón de números para el
    // trabajador. Una cuota de 0 con movimiento es legítima (p.ej. incapacidad
    // todo el mes: "0 31 0" con SubTotal 0.00) y no debe marcarse como error.
    if (current.movimientos === 0) {
      warnings.push(`No se pudieron leer días/cuotas de ${current.nombre || current.nss}.`)
    }
    trabajadores.push({
      nss: current.nss,
      nombre: current.nombre || "(sin nombre)",
      curp: current.curp,
      registroPatronal: header.registroPatronal,
      razonSocial: header.razonSocial,
      periodo: header.periodo,
      dias: current.dias,
      sdi: current.sdi,
      cuota: current.cuota,
      movimientos: Math.max(1, current.movimientos),
      archivo,
    })
    current = null
  }

  for (const line of lines) {
    const nssM = line.match(NSS_RE)
    if (nssM) {
      // Nueva ancla de trabajador.
      flush()
      const curpM = line.match(CURP_SEARCH)
      const curp = curpM ? curpM[0] : null
      const nombre = (curpM ? line.slice(nssM[0].length, curpM.index) : line.slice(nssM[0].length))
        .replace(/\s+/g, " ")
        .trim()
      current = {
        nss: nssM[1],
        curp,
        nombre,
        dias: 0,
        cuota: 0,
        sdi: null,
        sdiDias: -1,
        movimientos: 0,
      }
      continue
    }

    if (current) {
      const num = parseNumeroLinea(line)
      if (num) {
        current.dias += num.dias
        current.cuota += num.cuota
        current.movimientos += 1
        // SDI representativo: el del sub-renglón con más días.
        if (num.dias > current.sdiDias) {
          current.sdi = num.sdi
          current.sdiDias = num.dias
        }
      }
    }
  }
  flush()

  if (trabajadores.length === 0)
    warnings.push("No se detectaron trabajadores (¿PDF ilegible o formato distinto?).")
  if (!header.registroPatronal) warnings.push("No se detectó el registro patronal en el encabezado.")
  if (!header.periodo) warnings.push("No se detectó el período de proceso en el encabezado.")

  const sumaCuotas = trabajadores.reduce((s, t) => s + t.cuota, 0)

  return {
    archivo,
    header,
    trabajadores,
    totalDeclarado: declarados.total,
    cotizantesDeclarado: declarados.cotizantes,
    sumaCuotas,
    usedOcr,
    warnings,
  }
}

export interface HistoricoConsolidado {
  cedulas: CedulaParseResult[]
  filas: TrabajadorPeriodo[]
  registros: string[]
  anios: string[]
  periodos: string[]
  trabajadoresUnicos: number
  diasTotales: number
  cuotaTotal: number
}

export function consolidar(cedulas: CedulaParseResult[]): HistoricoConsolidado {
  const filas = cedulas.flatMap((c) => c.trabajadores)
  const registros = Array.from(
    new Set(filas.map((f) => f.registroPatronal).filter((r): r is string => Boolean(r))),
  ).sort()
  const periodos = Array.from(
    new Set(filas.map((f) => f.periodo).filter((p): p is string => Boolean(p))),
  ).sort()
  const anios = Array.from(new Set(periodos.map((p) => p.split("-")[0]))).sort()
  const nssSet = new Set(filas.map((f) => f.nss))
  const diasTotales = filas.reduce((s, f) => s + f.dias, 0)
  const cuotaTotal = filas.reduce((s, f) => s + f.cuota, 0)

  return {
    cedulas,
    filas,
    registros,
    anios,
    periodos,
    trabajadoresUnicos: nssSet.size,
    diasTotales,
    cuotaTotal,
  }
}

function csvCell(v: string | number | null): string {
  if (v == null) return ""
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV (con BOM) del detalle por trabajador-período; Excel lo abre directo. */
export function buildHistoricoCsv(filas: TrabajadorPeriodo[]): string {
  const headers = [
    "Período",
    "Registro Patronal",
    "Razón Social",
    "NSS",
    "Nombre",
    "CURP",
    "Días",
    "SDI",
    "Cuota Obrero-Patronal",
    "Movimientos",
    "Archivo",
  ]
  const rows = filas.map((f) =>
    [
      periodoLabel(f.periodo),
      f.registroPatronal ?? "",
      f.razonSocial ?? "",
      f.nss,
      f.nombre,
      f.curp ?? "",
      f.dias,
      f.sdi != null ? f.sdi.toFixed(2) : "",
      f.cuota.toFixed(2),
      f.movimientos,
      f.archivo,
    ]
      .map(csvCell)
      .join(","),
  )
  return "\uFEFF" + [headers.join(","), ...rows].join("\n")
}
