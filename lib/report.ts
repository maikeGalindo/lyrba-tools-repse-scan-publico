import type { ExpedienteBundle } from "./expediente-loader"
import type { ContribuyenteIdentity, EmpleadoRecord, EmpleadoResumen, MatchStatus } from "./types"
import { parseCfdiNomina, cfdiEnMes, periodoCfdiLabel } from "./xml-parser"
import { extractCurps, extractImssDaysByCurp, matchEmpleado, normalize } from "./matcher"
import { aggregate } from "./aggregate"
import {
  analyzeSatDoc,
  conceptoLabel,
  conciliarSat,
  evaluatePagoSat,
  formatMoney as formatMoneySat,
} from "./pago-sat"
import {
  analyzeImssDoc,
  evaluatePagoImss,
  formatMoney as formatMoneyImss,
  IMSS_CONCEPTO_LABEL,
  pairImssDocs,
} from "./pago-imss"
import { analyzeIcsoe, analyzeRepse, analyzeSisub, matchRfc, worstStatus, formatReportDate, formatText } from "./seguridad-social"
import {
  analyzeConstancia,
  evaluateConstancia,
  formatMonth,
  CONSTANCIA_TIPOS,
  type ConstanciaAnalysis,
  type ConstanciaTipo,
} from "./constancias"

export type ModuleId = "obligatorios" | "nomina" | "sat" | "imss" | "constancias" | "repse" | "icsoe" | "sisub"

export interface ReportRow {
  label: string
  status: MatchStatus | null
  detalle: string
}

export interface ReportModule {
  id: ModuleId
  title: string
  subtitle: string
  status: MatchStatus | null
  headline: string
  rows: ReportRow[]
  /** Documentos que se enrutaron a este módulo desde el ZIP. */
  docCount: number
}

export interface NominaDetail {
  total: number
  ok: number
  revisar: number
  noOk: number
  diasRevisar: number
  multiPatron: string[]
  /** CFDI cuyo periodo no corresponde al mes en revisión. */
  fueraMes: number
  /** CFDI sin fecha utilizable para validar el mes. */
  sinFecha: number
  empleados: EmpleadoResumen[]
}

export interface ExpedienteReport {
  mes: string
  identity: ContribuyenteIdentity | null
  overall: MatchStatus
  modules: ReportModule[]
  nomina: NominaDetail
  docCounts: {
    cfdis: number
    cedula: number
    sat: number
    imss: number
      constancias: number
      repse: number
      icsoe: number
      sisub: number
      unknown: number
  }
  unknown: string[]
  /** PDF de recibos de nómina cotejados contra su XML (informativo). */
  cfdiPdfs: ExpedienteBundle["cfdiPdfs"]
  generatedAt: number
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  OK: "Correcto",
  REVISAR: "Revisar",
  NO_OK: "No cumple",
}

function statusLabel(status: MatchStatus | null): string {
  return status ? STATUS_LABEL[status] : "Sin datos"
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "")
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvEscape).join(",")
}

/**
 * Arma el CSV del informe consolidado (abre limpio en Excel gracias al BOM
 * UTF-8). Incluye los documentos sin clasificar como una sección propia: esa
 * es la vía por la que se reportan, en lugar de mostrarlos como error en
 * pantalla.
 */
export function buildInformeCsv(report: ExpedienteReport, repseLabel: string): string {
  const rows: string[] = []
  const mesTxt = report.mes || "—"

  rows.push(csvRow(["INFORME CONSOLIDADO DEL EXPEDIENTE"]))
  rows.push(csvRow(["Mes en revisión", mesTxt]))
  rows.push(csvRow(["RFC del patrón", report.identity?.rfc || "—"]))
  rows.push(csvRow(["Razón social", report.identity?.razonSocial || "—"]))
  rows.push(csvRow(["Dictamen general", statusLabel(report.overall)]))
  rows.push(csvRow(["Verificación REPSE", repseLabel]))
  rows.push(csvRow(["Generado", new Date(report.generatedAt).toLocaleString("es-MX")]))
  rows.push("")

  rows.push(csvRow(["VALIDACIONES"]))
  rows.push(csvRow(["Módulo", "Estatus", "Resultado", "Detalle"]))
  for (const m of report.modules) {
    rows.push(csvRow([m.title, statusLabel(m.status), m.headline, ""]))
    for (const r of m.rows) {
      rows.push(csvRow(["", statusLabel(r.status), r.label, r.detalle]))
    }
  }
  rows.push("")

  rows.push(csvRow(["DETALLE DE NÓMINA"]))
  rows.push(csvRow(["Empleados", report.nomina.total]))
  rows.push(csvRow(["Correctos", report.nomina.ok]))
  rows.push(csvRow(["A revisar", report.nomina.revisar]))
  rows.push(csvRow(["No OK", report.nomina.noOk]))
  rows.push(csvRow(["Con diferencia de días CFDI vs IMSS", report.nomina.diasRevisar]))
  rows.push(csvRow(["CFDI con periodo fuera del mes", report.nomina.fueraMes]))
  rows.push("")

  rows.push(csvRow(["PDF DE RECIBOS DE NÓMINA VS XML"]))
  if (report.cfdiPdfs.length === 0) {
    rows.push(csvRow(["Ninguno"]))
  } else {
    rows.push(csvRow(["PDF", "Folio fiscal", "XML que corresponde"]))
    for (const p of report.cfdiPdfs) {
      rows.push(csvRow([p.name, p.uuid ?? "No legible", p.xml ?? "SIN XML"]))
    }
  }
  rows.push("")

  rows.push(csvRow(["DOCUMENTOS SIN CLASIFICAR"]))
  if (report.unknown.length === 0) {
    rows.push(csvRow(["Ninguno"]))
  } else {
    rows.push(csvRow(["#", "Archivo"]))
    report.unknown.forEach((n, i) => rows.push(csvRow([i + 1, n])))
  }

  return "\ufeff" + rows.join("\n")
}

/** Convierte el resultado booleano de un cruce en un estatus para el informe. */
function boolToStatus(v: boolean | null): MatchStatus | null {
  if (v === true) return "OK"
  if (v === false) return "NO_OK"
  return null
}

/** El peor estatus de un conjunto manda: NO_OK > REVISAR > OK; null se ignora. */
function worst(statuses: (MatchStatus | null)[]): MatchStatus | null {
  let seen = false
  let hasRevisar = false
  for (const s of statuses) {
    if (s == null) continue
    seen = true
    if (s === "NO_OK") return "NO_OK"
    if (s === "REVISAR") hasRevisar = true
  }
  if (!seen) return null
  return hasRevisar ? "REVISAR" : "OK"
}

function buildNomina(bundle: ExpedienteBundle, mes: string): { module: ReportModule; detail: NominaDetail } {
  // El informe debe usar exactamente el mismo universo de cédulas que el módulo
  // de nómina; tomar solo la primera produce falsos errores con varios RP.
  const pdfText = bundle.cedulaNomina.map((d) => d.text).join("\n\n")
  const parsed: EmpleadoRecord[] = []
  bundle.cfdis.forEach((xml, i) => {
    const res = parseCfdiNomina(xml.text, xml.name)
    if (res.ok && res.record) {
      parsed.push({ ...res.record, id: `${i}-${xml.name}`, status: "NO_OK" })
    }
  })

  // Identidad del patrón: emisor mayoritario (misma regla que el módulo de nómina).
  const emisores = new Map<string, number>()
  for (const r of parsed) {
    if (!r.emisorRfc) continue
    emisores.set(r.emisorRfc, (emisores.get(r.emisorRfc) ?? 0) + 1)
  }
  const multiPatron = emisores.size > 1 ? [...emisores.keys()] : []

  const pdfNorm = normalize(pdfText)
  const pdfCurps = extractCurps(pdfText)
  const imss = extractImssDaysByCurp(pdfText)

  const matched = parsed.map((r) => {
    const outcome = matchEmpleado({ curp: r.curp, nss: r.nss, nombre: r.nombre }, pdfNorm, pdfCurps)
    return { ...r, status: outcome.status, detalle: outcome.detalle ?? r.detalle, matchedCurp: outcome.matchedCurp }
  })

  // Validación de periodo: cada CFDI debe corresponder al mes en revisión.
  let fueraMes = 0
  let sinFecha = 0
  const fueraDetalle: string[] = []
  for (const r of matched) {
    const en = cfdiEnMes(r, mes)
    if (en === false) {
      fueraMes++
      if (fueraDetalle.length < 8) {
        fueraDetalle.push(`${r.nombre || r.curp || r.archivo}: ${periodoCfdiLabel(r)}`)
      }
    } else if (en === null) {
      sinFecha++
    }
  }

  const empleados = aggregate(matched, imss.days)
  let ok = 0
  let revisar = 0
  let noOk = 0
  let diasRevisar = 0
  for (const e of empleados) {
    if (e.status === "OK") ok++
    else if (e.status === "REVISAR") revisar++
    else noOk++
    if (e.diasStatus === "REVISAR") diasRevisar++
  }

  const total = empleados.length
  let status: MatchStatus | null
  if (total === 0) status = null
  else if (noOk > 0) status = "NO_OK"
  // La diferencia de días CFDI vs IMSS es informativa: el estatus lo marca si el empleado está o no en la cédula.
  else if (revisar > 0 || fueraMes > 0 || multiPatron.length > 1) status = "REVISAR"
  else status = "OK"

  const headline =
    total === 0
      ? "Sin CFDI de nómina en el expediente."
      : `${total} empleado(s): ${ok} OK · ${revisar} a revisar · ${noOk} no OK` +
        (diasRevisar > 0 ? ` · ${diasRevisar} con diferencia de días (informativo)` : "") +
        (fueraMes > 0 ? ` · ${fueraMes} fuera del mes` : "")

  // Filas del informe: solo los empleados que no cuadran del todo.
  const rows: ReportRow[] = empleados
    .filter((e) => e.status !== "OK" || e.diasStatus === "REVISAR")
    .map((e) => ({
      label: e.nombre || e.curp || "(sin nombre)",
      status: e.status,
      detalle:
        e.status === "OK" && e.diasStatus === "REVISAR"
          ? `Informativo: ${e.detalle ?? "diferencia entre días CFDI y días IMSS"}`
          : (e.detalle ?? ""),
    }))

  if (fueraMes > 0) {
    rows.unshift({
      label: "Periodo de los CFDI",
      status: "REVISAR",
      detalle:
        `${fueraMes} CFDI no corresponden a ${formatMonth(mes)}` +
        (fueraDetalle.length ? ` (${fueraDetalle.join("; ")}${fueraMes > fueraDetalle.length ? "…" : ""}).` : "."),
    })
  }

  if (multiPatron.length > 1) {
    rows.unshift({
      label: "Consistencia del contribuyente",
      status: "REVISAR",
      detalle: `Los CFDI provienen de ${multiPatron.length} patrones distintos (${multiPatron.join(", ")}); se revisaron contra todas las cédulas disponibles.`,
    })
  }

  const module: ReportModule = {
    id: "nomina",
    title: "Nómina",
    subtitle: "CFDI de nómina ↔ Cédula IMSS",
    status,
    headline,
    rows,
    docCount: bundle.cfdis.length + bundle.cedulaNomina.length,
  }
  const detail: NominaDetail = { total, ok, revisar, noOk, diasRevisar, multiPatron, fueraMes, sinFecha, empleados }
  return { module, detail }
}

function buildSat(bundle: ExpedienteBundle, mes: string): ReportModule {
  // Varias declaraciones (ISR e IVA por separado, con su pago dentro del mismo
  // PDF): se concilia cada una contra su propio recibo bancario.
  const conc = conciliarSat(bundle.sat, mes)
  if (conc.evals.length > 1 || conc.evals.some((e) => e.pago && e.pago.archivo === e.declaracion.archivo)) {
    const rows: ReportRow[] = conc.evals.map((e) => {
      const d = e.declaracion
      const linea = d.lineaCaptura ? ` · Línea ${d.lineaCaptura}` : ""
      return {
        label: conceptoLabel(d),
        status: e.status,
        detalle: `${formatMonth(d.mes)} · A pagar ${formatMoneySat(d.importe)}${linea} · ${e.detalle}`,
      }
    })
    for (const p of conc.pagosSinDeclaracion) {
      rows.push({
        label: "Comprobante sin declaración",
        status: null,
        detalle: `${p.archivo} · Línea ${p.lineaCaptura ?? "—"} · ${formatMoneySat(p.importe)} (informativo)`,
      })
    }
    return {
      id: "sat",
      title: "Pago de impuestos",
      subtitle: `${conc.evals.length} declaración(es) ↔ recibos bancarios`,
      status: conc.status,
      headline: conc.headline,
      rows,
      docCount: bundle.sat.length,
    }
  }

  const docs = bundle.sat.map((d) => analyzeSatDoc(d.text, d.name, d.usedOcr))
  const acuse = docs.find((d) => d.tipo === "acuse")
  const bancos = docs.filter((d) => d.tipo === "banco")
  const banco =
    (acuse?.lineaCaptura && bancos.find((b) => b.lineaCaptura === acuse.lineaCaptura)) || bancos[0]
  const ev = evaluatePagoSat(acuse, banco, mes)

  const rows: ReportRow[] = []
  if (acuse || banco) {
    rows.push({
      label: "Línea de captura",
      status: boolToStatus(ev.lineaMatch),
      detalle: `Acuse: ${acuse?.lineaCaptura ?? "—"} · Banco: ${banco?.lineaCaptura ?? "—"}`,
    })
    rows.push({
      label: "Importe",
      status: boolToStatus(ev.importeMatch),
      detalle: `Acuse: ${formatMoneySat(acuse?.importe ?? null)} · Banco: ${formatMoneySat(banco?.importe ?? null)}`,
    })
    rows.push({
      label: "Mes de la declaración",
      status: boolToStatus(ev.mesMatch),
      detalle: `Declaración: ${formatMonth(acuse?.mes ?? null)} · Mes revisado: ${formatMonth(mes)}`,
    })
  }

  return {
    id: "sat",
    title: "Pago de impuestos",
    subtitle: "Acuse SAT ↔ Comprobante bancario",
    status: ev.status,
    headline: ev.detalle,
    rows,
    docCount: bundle.sat.length,
  }
}

function buildImss(bundle: ExpedienteBundle, mes: string): ReportModule {
  const docs = bundle.imss.map((d) => analyzeImssDoc(d.text, d.name, d.usedOcr))
  const pairs = pairImssDocs(docs)
  const multi = pairs.length > 1

  const rows: ReportRow[] = []
  const statuses: (MatchStatus | null)[] = []

  pairs.forEach((pair, i) => {
    const ev = evaluatePagoImss(pair.sipare, pair.banco, mes)
    statuses.push(ev.status)

    const linkLabel =
      ev.linkVia === "linea"
        ? "Línea de captura"
        : ev.linkVia === "folio"
          ? "Folio SUA"
          : ev.linkVia === "registro"
            ? "Registro patronal"
            : "Vínculo"
    const vinculoMatch =
      ev.linkVia === "linea"
        ? ev.lineaMatch
        : ev.linkVia === "folio"
          ? ev.folioMatch
          : ev.linkVia === "registro"
            ? ev.registroMatch
            : null

    const concepto = pair.sipare?.concepto ?? pair.banco?.concepto ?? null
    const prefix = multi || concepto === "rcv-infonavit"
      ? `${concepto ? `${IMSS_CONCEPTO_LABEL[concepto]} · ` : ""}RP ${pair.registro ?? i + 1} · `
      : ""
    const sinBanco = !pair.banco && pair.sipare
      ? ` · falta el comprobante bancario del pago ${concepto === "rcv-infonavit" ? "INFONAVIT" : "IMSS"}`
      : ""

    rows.push({
      label: `${prefix}Vínculo · ${linkLabel.toLowerCase()}`,
      status: boolToStatus(vinculoMatch),
      detalle: `SIPARE: ${pair.sipare?.lineaCaptura ?? pair.sipare?.folioSua ?? pair.sipare?.registroPatronal ?? "—"} · Banco: ${
        pair.banco?.lineaCaptura ?? pair.banco?.folioSua ?? pair.banco?.registroPatronal ?? "—"
      }${sinBanco}`,
    })
    rows.push({
      label: `${prefix}Importe`,
      status: boolToStatus(ev.importeMatch),
      detalle: `SIPARE: ${formatMoneyImss(pair.sipare?.importe ?? null)} · Banco: ${formatMoneyImss(pair.banco?.importe ?? null)}`,
    })
    rows.push({
      label: `${prefix}Período del pago`,
      status: boolToStatus(ev.mesMatch),
      detalle: `Pago: ${formatMonth(pair.sipare?.periodo ?? pair.banco?.periodo ?? null)} · Mes revisado: ${formatMonth(mes)}`,
    })
  })

  let status: MatchStatus | null
  if (pairs.length === 0) status = null
  else if (statuses.some((s) => s === "NO_OK")) status = "NO_OK"
  else if (statuses.some((s) => s === "REVISAR")) status = "REVISAR"
  else status = "OK"

  const headline =
    pairs.length === 0
      ? "No se encontró la cédula SIPARE ni el comprobante bancario."
      : multi
        ? `${pairs.length} registros patronales · ${statuses.filter((s) => s === "OK").length} conciliados.`
        : evaluatePagoImss(pairs[0].sipare, pairs[0].banco, mes).detalle

  return {
    id: "imss",
    title: "Pago IMSS",
    subtitle: multi ? `${pairs.length} registros patronales` : "SIPARE ↔ Comprobante bancario",
    status,
    headline,
    rows,
    docCount: bundle.imss.length,
  }
}

function buildConstancias(bundle: ExpedienteBundle, mes: string): ReportModule {
  const analyses = bundle.constancias.map((d) => analyzeConstancia(d.text, d.name, d.usedOcr))
  const byTipo = new Map<ConstanciaTipo, ConstanciaAnalysis>()
  for (const a of analyses) {
    if (a.tipo && !byTipo.has(a.tipo)) byTipo.set(a.tipo, a)
  }

  const evaluations = CONSTANCIA_TIPOS.map((meta) => ({
    meta,
    analysis: byTipo.get(meta.tipo),
    result: evaluateConstancia(byTipo.get(meta.tipo), meta, mes),
  }))

  const mesesPresentes = new Set<string>()
  for (const { analysis } of evaluations) {
    if (analysis?.mesEmision) mesesPresentes.add(analysis.mesEmision)
  }
  const mismatchMeses = mesesPresentes.size > 1

  const statuses = evaluations.map((e) => e.result.status)
  let status: MatchStatus | null
  if (statuses.some((s) => s === null)) status = "REVISAR"
  else if (statuses.some((s) => s === "NO_OK")) status = "NO_OK"
  else if (statuses.some((s) => s === "REVISAR") || mismatchMeses) status = "REVISAR"
  else status = "OK"

  const rows: ReportRow[] = evaluations.map(({ meta, result }) => ({
    label: meta.label,
    status: result.status,
    detalle: result.detalle,
  }))
  if (mismatchMeses) {
    rows.push({
      label: "Coherencia de fechas",
      status: "REVISAR",
      detalle: `Las constancias no se expidieron en el mismo mes (${[...mesesPresentes].map(formatMonth).join(", ")}).`,
    })
  }

  const headline =
    status === "OK"
      ? `Las tres opiniones son positivas y se expidieron en ${formatMonth(mes)}.`
      : status === "NO_OK"
        ? "Al menos una opinión es negativa o presenta adeudo."
        : "Falta alguna constancia, hay fechas fuera del mes o un sentido no determinado."

  return {
    id: "constancias",
    title: "Constancias de cumplimiento",
    subtitle: "32-D · IMSS · INFONAVIT",
    status,
    headline,
    rows,
    docCount: bundle.constancias.length,
  }
}

/**
 * Construye el informe consolidado del expediente a partir del bundle del ZIP,
 * reutilizando exactamente las mismas funciones de análisis y evaluación que
 * cada módulo, de modo que el informe no puede divergir de lo que se ve en cada
 * validación individual.
 */
function buildSeguridadSocial(bundle: ExpedienteBundle): ReportModule[] {
  const expectedRfc = bundle.identity?.rfc ?? null
  const modules: ReportModule[] = []

  if (bundle.repse.length) {
    const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9&Ñ]/g, "")
    const seen = new Set<string>()
    const unique: { a: ReturnType<typeof analyzeRepse>; text: string }[] = []
    for (const d of bundle.repse) {
      const a = analyzeRepse(d.text)
      const key = a.folios.length ? [...a.folios].sort().join("|") : compact(d.text).slice(0, 2000)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push({ a, text: d.text })
    }
    const tipoLabel: Record<string, string> = { registro: "Registro REPSE", actualizacion: "Actualización REPSE", renovacion: "Renovación REPSE", desconocido: "Documento REPSE" }
    const statuses: (ReportRow["status"])[] = []
    const rows: ReportRow[] = unique.map(({ a, text }) => {
      // El RFC del expediente puede venir partido o pegado a otra palabra; si aparece en el texto, cuenta.
      const rfcEnTexto = !!expectedRfc && compact(text).includes(compact(expectedRfc))
      const rfc = rfcEnTexto ? expectedRfc : a.rfc
      const status = rfcEnTexto ? "OK" : matchRfc(expectedRfc, a.rfc)
      statuses.push(status)
      return {
        label: tipoLabel[a.tipo] ?? "Documento REPSE",
        status,
        detalle: `RFC ${rfc ?? "no identificado"} · Acuerdo ${formatText(a.acuerdo)} · ${formatReportDate(a.fecha)} (informativo)`,
      }
    })
    const duplicados = bundle.repse.length - unique.length
    modules.push({ id: "repse", title: "Padrón REPSE", subtitle: "Cuatrimestral / anual · solo se valida el RFC", status: worstStatus(statuses), headline: `${unique.length} documento(s) REPSE${duplicados > 0 ? ` (${duplicados} repetido(s) omitido(s))` : ""} · se valida que correspondan al RFC del expediente.`, rows, docCount: bundle.repse.length })
  }

  if (bundle.icsoe.length) {
    const analyses = bundle.icsoe.map((d) => analyzeIcsoe(d.text))
    const statuses = analyses.map((a) => matchRfc(expectedRfc, a.rfc))
    const rows: ReportRow[] = []
    analyses.forEach((a, i) => {
      rows.push({ label: "RFC del expediente", status: statuses[i], detalle: `${a.rfc ?? "No identificado"} · ${formatReportDate(a.fechaPresentacion)}` })
      rows.push({ label: "Periodo (informativo)", status: "OK", detalle: `${a.cuatrimestre ?? "Cuatrimestre no identificado"} ${a.anio ?? ""} · ${a.tipo ?? "Tipo no identificado"} · Folio ${a.folio ?? "No identificado"}` })
    })
    modules.push({ id: "icsoe", title: "ICSOE", subtitle: "Cuatrimestral · solo se valida el RFC", status: worstStatus(statuses), headline: `${analyses.length} acuse(s) ICSOE · documento cuatrimestral, se valida que corresponda al RFC del expediente.`, rows, docCount: bundle.icsoe.length })
  }

  if (bundle.sisub.length) {
    const analyses = bundle.sisub.map((d) => analyzeSisub(d.text))
    const statuses = analyses.map((a) => matchRfc(expectedRfc, a.rfc))
    const rows: ReportRow[] = []
    analyses.forEach((a, i) => {
      rows.push({ label: "RFC y cadena original", status: statuses[i], detalle: `${a.rfc ?? "No identificado"} · ${a.statusInformacion ?? "Estatus no identificado"} · Folio ${a.folio ?? "No identificado"}` })
      rows.push({ label: "Presentación (informativo)", status: "OK", detalle: `${a.cuatrimestre ?? "Cuatrimestre no identificado"} · ${formatReportDate(a.fechaPresentacion)} · RP ${a.registroPatronal ?? "No identificado"}` })
      rows.push({ label: "Razón social (informativo)", status: "OK", detalle: a.razonSocial ?? "No identificado" })
    })
    modules.push({ id: "sisub", title: "SISUB", subtitle: "Cuatrimestral · solo se valida el RFC", status: worstStatus(statuses), headline: `${analyses.length} acuse(s) SISUB · documento cuatrimestral, se valida que corresponda al RFC del expediente.`, rows, docCount: bundle.sisub.length })
  }

  return modules
}

function buildObligatorios(bundle: ExpedienteBundle, mes: string): ReportModule {
  const tiposConstancia = new Set(
    bundle.constancias.map((d) => analyzeConstancia(d.text, d.name, d.usedOcr).tipo).filter(Boolean),
  )
  const constanciasFaltantes = CONSTANCIA_TIPOS.filter((meta) => !tiposConstancia.has(meta.tipo)).map((m) => m.label)

  const presence = (count: number): ReportRow["status"] => (count > 0 ? "OK" : "NO_OK")
  const rows: ReportRow[] = [
    {
      label: "Constancias de cumplimiento",
      status: constanciasFaltantes.length ? "NO_OK" : "OK",
      detalle: constanciasFaltantes.length
        ? `Falta: ${constanciasFaltantes.join(", ")}.`
        : `Se recibieron las ${CONSTANCIA_TIPOS.length} constancias.`,
    },
    {
      label: "XML de nómina (CFDI)",
      status: presence(bundle.cfdis.length),
      detalle: bundle.cfdis.length ? `${bundle.cfdis.length} XML recibido(s).` : "No se recibió ningún XML de nómina.",
    },
    {
      label: "PDF de recibos de nómina",
      status: presence(bundle.cfdiPdfs.length),
      detalle: bundle.cfdiPdfs.length
        ? `${bundle.cfdiPdfs.length} PDF recibido(s).`
        : "No se recibió ningún PDF de recibo de nómina.",
    },
    {
      label: "Cédula IMSS (nómina)",
      status: presence(bundle.cedulaNomina.length),
      detalle: bundle.cedulaNomina.length
        ? `${bundle.cedulaNomina.length} cédula(s) recibida(s).`
        : "No se recibió la cédula de determinación de cuotas.",
    },
    {
      label: "Pago IMSS",
      status: presence(bundle.imss.length),
      detalle: bundle.imss.length
        ? `${bundle.imss.length} documento(s) de pago recibido(s).`
        : "No se recibió la cédula SIPARE ni el comprobante bancario.",
    },
    {
      label: "Pago de impuestos",
      status: presence(bundle.sat.length),
      detalle: bundle.sat.length
        ? `${bundle.sat.length} documento(s) de pago recibido(s).`
        : "No se recibió el acuse SAT ni el comprobante bancario.",
    },
  ]

  const faltantes = rows.filter((r) => r.status === "NO_OK").map((r) => r.label)
  return {
    id: "obligatorios",
    title: "Documentos obligatorios del mes",
    subtitle: `Entregables mensuales · ${formatMonth(mes)}`,
    status: faltantes.length ? "NO_OK" : "OK",
    headline: faltantes.length
      ? `Falta(n) ${faltantes.length} documento(s) obligatorio(s): ${faltantes.join(", ")}.`
      : "Se recibieron todos los documentos mensuales obligatorios.",
    rows,
    docCount:
      bundle.constancias.length + bundle.cfdis.length + bundle.cfdiPdfs.length + bundle.cedulaNomina.length + bundle.imss.length + bundle.sat.length,
  }
}

export function buildExpedienteReport(bundle: ExpedienteBundle, mes: string): ExpedienteReport {
  const { module: nominaModule, detail: nomina } = buildNomina(bundle, mes)
  const modules: ReportModule[] = [buildObligatorios(bundle, mes), nominaModule, buildSat(bundle, mes), buildImss(bundle, mes), buildConstancias(bundle, mes), ...buildSeguridadSocial(bundle)]

  const overall = worst(modules.map((m) => m.status)) ?? "REVISAR"

  return {
    mes,
    identity: bundle.identity,
    overall,
    modules,
    nomina,
    docCounts: {
      cfdis: bundle.cfdis.length,
      cedula: bundle.cedulaNomina.length,
      sat: bundle.sat.length,
      imss: bundle.imss.length,
      constancias: bundle.constancias.length,
      repse: bundle.repse.length,
      icsoe: bundle.icsoe.length,
      sisub: bundle.sisub.length,
      unknown: bundle.unknown.length,
    },
    unknown: bundle.unknown,
    cfdiPdfs: bundle.cfdiPdfs,
    generatedAt: Date.now(),
  }
}
