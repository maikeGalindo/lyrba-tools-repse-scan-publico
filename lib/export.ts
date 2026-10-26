import * as XLSX from "xlsx"
import { STATUS_LABEL, type EmpleadoRecord, type EmpleadoResumen } from "./types"

const RESUMEN_HEADERS = [
  "Nombre",
  "NSS",
  "RFC",
  "SBC (mayor)",
  "Puesto",
  "Fecha de ingreso",
  "CURP",
  "# CFDI",
  "Días CFDI",
  "Días IMSS pagados",
  "Diferencia",
  "Estatus IMSS",
  "Cuadre días",
  "Detalle",
]

const DETALLE_HEADERS = [
  "Nombre",
  "NSS",
  "RFC",
  "SBC",
  "Días pagados",
  "Puesto",
  "Fecha de ingreso",
  "CURP",
  "Estatus",
  "Detalle",
  "Archivo",
]

function resumenRows(rows: EmpleadoResumen[]): (string | number)[][] {
  return rows.map((r) => [
    r.nombre,
    r.nss,
    r.rfc,
    r.sbcMax,
    r.puesto,
    r.fechaIngreso,
    r.curp,
    r.numCfdi,
    r.diasCfdi,
    r.diasImss ?? "s/d",
    r.diferencia ?? "s/d",
    STATUS_LABEL[r.status],
    r.diasStatus ? STATUS_LABEL[r.diasStatus] : "s/d",
    r.detalle ?? "",
  ])
}

function detalleRows(records: EmpleadoRecord[]): (string | number)[][] {
  return records.map((r) => [
    r.nombre,
    r.nss,
    r.rfc,
    r.sbc,
    r.diasPagados,
    r.puesto,
    r.fechaIngreso,
    r.curp,
    STATUS_LABEL[r.status],
    r.detalle ?? "",
    r.archivo,
  ])
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Excel con dos hojas: "Resumen" (una fila por empleado) y "Detalle" (por CFDI). */
export function exportXlsx(resumen: EmpleadoResumen[], detalle: EmpleadoRecord[]): void {
  const wb = XLSX.utils.book_new()

  const wsResumen = XLSX.utils.aoa_to_sheet([RESUMEN_HEADERS, ...resumenRows(resumen)])
  wsResumen["!cols"] = [
    { wch: 34 },
    { wch: 14 },
    { wch: 15 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 20 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 11 },
    { wch: 12 },
    { wch: 12 },
    { wch: 40 },
  ]
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen")

  const wsDetalle = XLSX.utils.aoa_to_sheet([DETALLE_HEADERS, ...detalleRows(detalle)])
  wsDetalle["!cols"] = [
    { wch: 34 },
    { wch: 14 },
    { wch: 15 },
    { wch: 10 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 20 },
    { wch: 10 },
    { wch: 30 },
    { wch: 28 },
  ]
  XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle")

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  download(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `conciliacion-repse-${timestamp()}.xlsx`,
  )
}

/** CSV del resumen sintetizado (una fila por empleado). */
export function exportCsv(resumen: EmpleadoResumen[]): void {
  const ws = XLSX.utils.aoa_to_sheet([RESUMEN_HEADERS, ...resumenRows(resumen)])
  const csv = XLSX.utils.sheet_to_csv(ws)
  download(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    `conciliacion-repse-resumen-${timestamp()}.csv`,
  )
}
