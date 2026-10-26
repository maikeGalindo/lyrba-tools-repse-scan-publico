import JSZip from "jszip"
import { extractPdfText } from "./pdf-extractor"
import type { LoadedXml } from "./zip-loader"
import { detectSatTipo } from "./pago-sat"
import { detectImssTipo, extractLineaCapturaImss } from "./pago-imss"
import { isIcsoe, isRepse, isSisub } from "./seguridad-social"
import { parseCfdiNomina } from "./xml-parser"
import type { ContribuyenteIdentity } from "./types"

export interface LoadedDoc {
  name: string
  text: string
  usedOcr: boolean
}

/** Compartimentos del expediente a los que se enruta cada documento. */
export type DocBucket =
  | "cfdi"
  | "cfdi-pdf"
  | "soporte"
  | "cedula-nomina"
  | "sat"
  | "imss"
  | "constancia"
  | "repse"
  | "icsoe"
  | "sisub"
  | "unknown"

export interface DocRouting {
  name: string
  buckets: DocBucket[]
}

/** Representación impresa (PDF) de un CFDI de nómina y su cotejo contra los XML. */
export interface CfdiPdfMatch {
  name: string
  uuid: string | null
  /** Nombre del XML con el mismo folio fiscal, o null si no hay XML que le corresponda. */
  xml: string | null
}

const UUID_RE = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i

function uuidFromPdf(text: string): string | null {
  const labeled = text.match(/folio\s*fiscal\s*:?\s*([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i)
  const m = labeled ? labeled[1] : text.match(UUID_RE)?.[0]
  return m ? m.toUpperCase() : null
}

function uuidFromXml(text: string): string | null {
  const m = text.match(/\bUUID\s*=\s*"([0-9A-Fa-f-]{36})"/)
  return m ? m[1].toUpperCase() : null
}

export interface ExpedienteBundle {
  cfdis: LoadedXml[]
  cedulaNomina: LoadedDoc[]
  sat: LoadedDoc[]
  imss: LoadedDoc[]
  constancias: LoadedDoc[]
  repse: LoadedDoc[]
  icsoe: LoadedDoc[]
  sisub: LoadedDoc[]
  unknown: string[]
  /** PDF de recibos de nómina timbrados, cotejados contra su XML por folio fiscal. */
  cfdiPdfs: CfdiPdfMatch[]
  /** Documentos reconocidos que no se validan (p. ej. resumen de liquidación SUA). */
  soporte: string[]
  pdfCount: number
  routing: DocRouting[]
  identity: ContribuyenteIdentity | null
}

/**
 * Identidad del contribuyente a partir del emisor mayoritario de los CFDI de
 * nómina. Es la misma regla que aplica el módulo de nómina, calculada aquí para
 * que la barra de consistencia se llene apenas se carga el expediente ZIP.
 */
function emisorIdentity(xmls: LoadedXml[]): ContribuyenteIdentity | null {
  const emisores = new Map<string, { nombre: string; count: number }>()
  for (const xml of xmls) {
    const res = parseCfdiNomina(xml.text, xml.name)
    if (!res.ok || !res.record?.emisorRfc) continue
    const r = res.record
    const prev = emisores.get(r.emisorRfc) ?? { nombre: r.emisorNombre, count: 0 }
    prev.count++
    if (!prev.nombre && r.emisorNombre) prev.nombre = r.emisorNombre
    emisores.set(r.emisorRfc, prev)
  }
  const ranking = [...emisores.entries()].sort((a, b) => b[1].count - a[1].count)
  return ranking.length ? { rfc: ranking[0][0], razonSocial: ranking[0][1].nombre || null } : null
}

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function norm(s: string) {
  return stripAccents(s).toLowerCase().replace(/\s+/g, " ")
}

const CURP_GLOBAL = /[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/g

function countCurps(text: string): number {
  const m = text.toUpperCase().match(CURP_GLOBAL)
  return m ? m.length : 0
}

/**
 * Clasifica un PDF por su contenido en uno o varios compartimentos. Un mismo
 * documento puede pertenecer a más de un módulo (p. ej. la cédula SUA de
 * determinación con línea de captura sirve como cédula de nómina y como SIPARE).
 * El orden importa: las opiniones de cumplimiento se detectan primero con sus
 * frases resolutivas para que no se confundan con los pagos.
 */
export function classifyPdf(text: string): DocBucket[] {
  const t = norm(text)
  const buckets: DocBucket[] = []

  // 0) Recibo de nómina timbrado (PDF del CFDI): se coteja contra su XML, no se valida.
  if (
    t.includes("comprobante fiscal digital por internet") &&
    (t.includes("recibo de nomina") || t.includes("folio fiscal") || t.includes("percepciones"))
  ) {
    return ["cfdi-pdf"]
  }
  // Resumen de liquidación SUA: documento de soporte, no es comprobante de pago.
  if (t.includes("resumen de liquidacion") && (t.includes("autodeterminacion") || t.includes("folio sua"))) {
    return ["soporte"]
  }

  if (isRepse(text)) buckets.push("repse")
  if (isIcsoe(text)) buckets.push("icsoe")
  if (isSisub(text)) buckets.push("sisub")

  // 1) Constancias / opiniones de cumplimiento — exclusivas, no son pagos.
  const esConstancia =
    t.includes("opinion del cumplimiento de obligaciones fiscales") ||
    (t.includes("opinion de cumplimiento") &&
      (t.includes("seguridad social") || t.includes("seguro social"))) ||
    (t.includes("infonavit") &&
      (t.includes("sin adeudo") || t.includes("con adeudo") || t.includes("constancia")))
  if (esConstancia) return ["constancia"]

  const curps = countCurps(text)
  const looksLikeWorkerCedula =
    curps >= 2 && (t.includes("cuotas obrero patronales") || t.includes("determinacion"))
  const hasSipareLinea =
    extractLineaCapturaImss(text) != null ||
    t.includes("linea de captura sipare") ||
    t.includes("formato para pago de cuotas")

  // 2) Pago SAT (acuse / comprobante).
  if (detectSatTipo(text)) buckets.push("sat")

  // 3) Cédula de nómina (determinación SUA con detalle de trabajadores).
  if (looksLikeWorkerCedula) buckets.push("cedula-nomina")

  // 4) Pago IMSS (SIPARE / comprobante bancario). La cédula de trabajadores solo
  //    entra aquí si además trae línea de captura SIPARE (documento combinado).
  if (hasSipareLinea || (detectImssTipo(text) && !looksLikeWorkerCedula)) {
    buckets.push("imss")
  }

  if (buckets.length === 0) buckets.push("unknown")
  return buckets
}

/** Recorre un archivo (o ZIP, recursivamente) recolectando XML y PDF. */
async function collect(
  file: File,
  xmls: LoadedXml[],
  pdfs: { name: string; file: File }[],
): Promise<void> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(file)
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue
      if (entry.name.startsWith("__MACOSX") || entry.name.includes("/._")) continue
      const name = entry.name.split("/").pop() || entry.name
      const el = name.toLowerCase()
      if (el.endsWith(".zip")) {
        await collect(new File([await entry.async("blob")], name), xmls, pdfs)
      } else if (el.endsWith(".xml")) {
        xmls.push({ name, text: await entry.async("string") })
      } else if (el.endsWith(".pdf")) {
        pdfs.push({ name, file: new File([await entry.async("blob")], name) })
      }
    }
  } else if (lower.endsWith(".xml")) {
    xmls.push({ name: file.name, text: await file.text() })
  } else if (lower.endsWith(".pdf")) {
    pdfs.push({ name: file.name, file })
  }
}

/**
 * Abre uno o varios archivos (típicamente un solo .zip del expediente completo),
 * extrae todo su contenido de forma recursiva —100% local— y reparte cada
 * documento al módulo que le corresponde por su contenido, sin importar el orden
 * ni la estructura interna del ZIP (subcarpetas, ZIP anidado o archivos sueltos).
 */
export async function loadExpediente(
  files: File[],
  onProgress?: (msg: string) => void,
): Promise<ExpedienteBundle> {
  const xmls: LoadedXml[] = []
  const pdfs: { name: string; file: File }[] = []

  onProgress?.("Descomprimiendo expediente…")
  for (const f of files) await collect(f, xmls, pdfs)

  const bundle: ExpedienteBundle = {
    cfdis: xmls,
    cedulaNomina: [],
    sat: [],
    imss: [],
    constancias: [],
    repse: [],
    icsoe: [],
    sisub: [],
    unknown: [],
    cfdiPdfs: [],
    soporte: [],
    pdfCount: pdfs.length,
    routing: [],
    identity: emisorIdentity(xmls),
  }

  const xmlByUuid = new Map<string, string>()
  for (const x of xmls) {
    const u = uuidFromXml(x.text)
    if (u) xmlByUuid.set(u, x.name)
  }

  for (let i = 0; i < pdfs.length; i++) {
    const { name, file } = pdfs[i]
    onProgress?.(`Analizando ${name} (${i + 1}/${pdfs.length})…`)
    const res = await extractPdfText(file, (m) => onProgress?.(`${name}: ${m}`))
    const doc: LoadedDoc = { name, text: res.text, usedOcr: res.usedOcr }
    const buckets = classifyPdf(res.text)
    for (const b of buckets) {
      if (b === "cfdi-pdf") {
        const uuid = uuidFromPdf(res.text)
        bundle.cfdiPdfs.push({ name, uuid, xml: uuid ? (xmlByUuid.get(uuid) ?? null) : null })
      } else if (b === "soporte") bundle.soporte.push(name)
      else if (b === "cedula-nomina") bundle.cedulaNomina.push(doc)
      else if (b === "sat") bundle.sat.push(doc)
      else if (b === "imss") bundle.imss.push(doc)
      else if (b === "constancia") bundle.constancias.push(doc)
      else if (b === "repse") bundle.repse.push(doc)
      else if (b === "icsoe") bundle.icsoe.push(doc)
      else if (b === "sisub") bundle.sisub.push(doc)
      else bundle.unknown.push(name)
    }
    bundle.routing.push({ name, buckets })
  }

  return bundle
}
