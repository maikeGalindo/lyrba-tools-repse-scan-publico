import type { EmpleadoRecord } from "./types"

const NS = {
  cfdi: "http://www.sat.gob.mx/cfd/4",
  nomina12: "http://www.sat.gob.mx/nomina12",
}

export type ParsedRecord = Omit<EmpleadoRecord, "id" | "status" | "detalle">

export interface ParseResult {
  ok: boolean
  record?: ParsedRecord
  error?: string
}

/**
 * Extrae los campos de nómina de un CFDI 4.0 con complemento Nómina 1.2.
 * Usa getElementsByTagNameNS para ser inmune al prefijo del namespace.
 */
export function parseCfdiNomina(xmlText: string, archivo: string): ParseResult {
  try {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml")
    if (doc.getElementsByTagName("parsererror").length > 0) {
      return { ok: false, error: `${archivo}: XML mal formado` }
    }

    const nomReceptor = doc.getElementsByTagNameNS(NS.nomina12, "Receptor")[0]
    const nomina = doc.getElementsByTagNameNS(NS.nomina12, "Nomina")[0]
    const cfdiReceptor = doc.getElementsByTagNameNS(NS.cfdi, "Receptor")[0]
    const cfdiEmisor = doc.getElementsByTagNameNS(NS.cfdi, "Emisor")[0]

    if (!nomReceptor || !nomina) {
      return { ok: false, error: `${archivo}: no contiene complemento de nómina` }
    }

    const record: ParsedRecord = {
      nombre: (cfdiReceptor?.getAttribute("Nombre") ?? "").trim(),
      rfc: (cfdiReceptor?.getAttribute("Rfc") ?? "").trim().toUpperCase(),
      emisorRfc: (cfdiEmisor?.getAttribute("Rfc") ?? "").trim().toUpperCase(),
      emisorNombre: (cfdiEmisor?.getAttribute("Nombre") ?? "").trim().replace(/\s+/g, " "),
      curp: (nomReceptor.getAttribute("Curp") ?? "").trim().toUpperCase(),
      nss: (nomReceptor.getAttribute("NumSeguridadSocial") ?? "").trim(),
      puesto: (nomReceptor.getAttribute("Puesto") ?? "").trim(),
      fechaIngreso: (nomReceptor.getAttribute("FechaInicioRelLaboral") ?? "").trim(),
      sbc: (nomReceptor.getAttribute("SalarioBaseCotApor") ?? "").trim(),
      diasPagados: (nomina.getAttribute("NumDiasPagados") ?? "").trim(),
      archivo,
      fechaPago: (nomina.getAttribute("FechaPago") ?? "").trim(),
      periodoInicio: (nomina.getAttribute("FechaInicialPago") ?? "").trim(),
      periodoFin: (nomina.getAttribute("FechaFinalPago") ?? "").trim(),
    }

    return { ok: true, record }
  } catch (e) {
    return { ok: false, error: `${archivo}: ${(e as Error).message}` }
  }
}

interface PeriodoFields {
  fechaPago?: string
  periodoInicio?: string
  periodoFin?: string
}

/** Convierte "YYYY-MM-DD..." a un timestamp UTC comparable, o null si no aplica. */
function fechaToUTC(s?: string): number | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * Determina si un CFDI de nómina corresponde al mes en revisión ("YYYY-MM").
 * Regla: el periodo de pago (FechaInicialPago a FechaFinalPago) debe tener al
 * menos un día dentro del mes. Así cuentan las semanas que cruzan de un mes a
 * otro (p. ej. 29 jun a 5 jul cuenta para junio y para julio). Si el CFDI no
 * trae periodo, se usa la FechaPago. Devuelve null cuando no hay fecha utilizable.
 */
export function cfdiEnMes(rec: PeriodoFields, mes: string): boolean | null {
  const mm = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!mm) return null
  const year = Number(mm[1])
  const month = Number(mm[2]) // 1-12
  const monthStart = Date.UTC(year, month - 1, 1)
  const monthEnd = Date.UTC(year, month, 0) // día 0 del mes siguiente = último del actual

  const ini = fechaToUTC(rec.periodoInicio)
  const fin = fechaToUTC(rec.periodoFin)
  if (ini != null || fin != null) {
    const desde = ini ?? fin!
    const hasta = fin ?? ini!
    return desde <= monthEnd && hasta >= monthStart
  }

  const pago = fechaToUTC(rec.fechaPago)
  if (pago != null) return pago >= monthStart && pago <= monthEnd

  return null
}

/** Etiqueta legible del periodo del CFDI para mostrar en avisos. */
export function periodoCfdiLabel(rec: PeriodoFields): string {
  if (rec.periodoInicio && rec.periodoFin) return `${rec.periodoInicio} a ${rec.periodoFin}`
  if (rec.periodoInicio || rec.periodoFin) return (rec.periodoInicio || rec.periodoFin)!
  if (rec.fechaPago) return `pago ${rec.fechaPago}`
  return "sin fecha"
}
