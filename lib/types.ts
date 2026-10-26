export type MatchStatus = "OK" | "REVISAR" | "NO_OK"

export interface EmpleadoRecord {
  id: string
  nombre: string
  nss: string
  rfc: string
  sbc: string
  puesto: string
  fechaIngreso: string
  diasPagados: string
  curp: string
  archivo: string
  /** Fecha en que se pagó el recibo (atributo FechaPago de Nómina 1.2). */
  fechaPago: string
  /** Inicio del periodo pagado (FechaInicialPago). */
  periodoInicio: string
  /** Fin del periodo pagado (FechaFinalPago). */
  periodoFin: string
  /** RFC del emisor (patrón) del CFDI: la empresa que audita el expediente. */
  emisorRfc: string
  /** Razón social del emisor (patrón) del CFDI. */
  emisorNombre: string
  status: MatchStatus
  detalle?: string
  /** CURP tal como aparece en la cédula (exacta o la más parecida por OCR). */
  matchedCurp?: string
}

/**
 * Identidad del contribuyente (patrón) que un módulo logró extraer de sus
 * documentos. Alimenta la barra de consistencia transversal del expediente.
 */
export interface ContribuyenteIdentity {
  rfc: string | null
  razonSocial: string | null
}

/** Una fila por empleado: consolida todos sus CFDI del periodo. */
export interface EmpleadoResumen {
  curp: string
  nombre: string
  nss: string
  rfc: string
  puesto: string
  fechaIngreso: string
  /** SBC mayor de todos los CFDI (último salario modificado). */
  sbcMax: string
  /** Cantidad de CFDI encontrados para este empleado. */
  numCfdi: number
  /** Suma de días pagados de todos los CFDI. */
  diasCfdi: number
  /** Días pagados en la cédula IMSS (sin incapacidad/ausentismo). */
  diasImss: number | null
  /** diasCfdi - diasImss. */
  diferencia: number | null
  /** Presencia de la CURP en la cédula IMSS. */
  status: MatchStatus
  /** Cuadre de días: OK si coinciden, REVISAR si difieren, null si no hay días. */
  diasStatus: MatchStatus | null
  detalle?: string
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  OK: "OK",
  REVISAR: "REVISAR",
  NO_OK: "NO OK",
}
