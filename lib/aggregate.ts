import type { EmpleadoRecord, EmpleadoResumen, MatchStatus } from "./types"

function parseNum(s: string): number {
  const v = Number.parseFloat((s ?? "").replace(/,/g, ""))
  return Number.isNaN(v) ? 0 : v
}

function formatMoney(n: number): string {
  return n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Consolida los CFDI en una fila por empleado (agrupando por CURP):
 *  - SBC: el mayor de todos sus recibos (último salario modificado).
 *  - Días CFDI: suma de días pagados de todos sus recibos.
 *  - Días IMSS: días pagados de la cédula (sin incapacidad/ausentismo).
 *  - Estatus final: combina la coincidencia de CURP con el cuadre de días.
 */
export function aggregate(
  records: EmpleadoRecord[],
  imssDays?: Map<string, number> | null,
): EmpleadoResumen[] {
  const days = imssDays ?? new Map<string, number>()
  const groups = new Map<string, EmpleadoRecord[]>()
  for (const r of records) {
    const key = r.curp || `SIN-CURP-${r.id}`
    const arr = groups.get(key)
    if (arr) arr.push(r)
    else groups.set(key, [r])
  }

  const out: EmpleadoResumen[] = []
  for (const arr of groups.values()) {
    const first = arr[0]
    // Un empleado puede tener varios CFDI (y varios registros patronales).
    // No debemos heredar el estatus del primer archivo: basta que uno de sus
    // CFDI concilie para considerar conciliada la presencia del empleado.
    const curpStatus: MatchStatus = arr.some((r) => r.status === "OK")
      ? "OK"
      : arr.some((r) => r.status === "REVISAR")
        ? "REVISAR"
        : "NO_OK"

    let sbcMax = 0
    let diasCfdi = 0
    for (const r of arr) {
      sbcMax = Math.max(sbcMax, parseNum(r.sbc))
      diasCfdi += parseNum(r.diasPagados)
    }

    const matched = arr.find((r) => r.matchedCurp)?.matchedCurp
    const diasImss = matched ? days.get(matched) ?? null : days.get(first.curp) ?? null
    const diferencia = diasImss === null ? null : diasCfdi - diasImss

    // Estatus de presencia: si la CURP está en la cédula IMSS.
    const status: MatchStatus = curpStatus
    const representative = arr.find((r) => r.status === curpStatus) ?? first
    let detalle = representative.detalle

    // Estatus de días: independiente de la presencia.
    let diasStatus: MatchStatus | null = null
    if (curpStatus !== "NO_OK") {
      if (diasImss === null) {
        diasStatus = null
        detalle = "CURP encontrada, pero sin días legibles en la cédula"
      } else if (diferencia === 0) {
        diasStatus = "OK"
        detalle = "Días CFDI e IMSS coinciden"
      } else {
        diasStatus = "REVISAR"
        detalle = `Diferencia de días: CFDI ${diasCfdi} vs IMSS ${diasImss} (${diferencia! > 0 ? "+" : ""}${diferencia})`
      }
    }

    out.push({
      curp: first.curp,
      nombre: first.nombre,
      nss: first.nss,
      rfc: first.rfc,
      puesto: first.puesto,
      fechaIngreso: first.fechaIngreso,
      sbcMax: formatMoney(sbcMax),
      numCfdi: arr.length,
      diasCfdi,
      diasImss,
      diferencia,
      status,
      diasStatus,
      detalle,
    })
  }

  out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
  return out
}
