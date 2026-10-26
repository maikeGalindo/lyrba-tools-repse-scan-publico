"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { STATUS_LABEL, type EmpleadoResumen, type MatchStatus } from "@/lib/types"
import { StatusBadge } from "./status-badge"
import { SearchIcon } from "./icons"

type Filter = "ALL" | MatchStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "OK", label: STATUS_LABEL.OK },
  { key: "REVISAR", label: STATUS_LABEL.REVISAR },
  { key: "NO_OK", label: STATUS_LABEL.NO_OK },
]

export function ResumenTable({ rows }: { rows: EmpleadoResumen[] }) {
  const [filter, setFilter] = useState<Filter>("ALL")
  const [query, setQuery] = useState("")

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: rows.length, OK: 0, REVISAR: 0, NO_OK: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter !== "ALL" && r.status !== filter) return false
      if (!q) return true
      return (
        r.nombre.toLowerCase().includes(q) ||
        r.curp.toLowerCase().includes(q) ||
        r.rfc.toLowerCase().includes(q) ||
        r.nss.toLowerCase().includes(q)
      )
    })
  }, [rows, filter, query])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <SearchIcon
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nombre, CURP, RFC…"
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium" title="¿La CURP aparece en la cédula IMSS?">
                Estatus IMSS
              </th>
              <th className="px-4 py-3 font-medium">Empleado</th>
              <th className="px-4 py-3 font-medium">CURP</th>
              <th className="px-4 py-3 text-right font-medium">SBC (mayor)</th>
              <th className="px-4 py-3 text-center font-medium">CFDI</th>
              <th className="px-4 py-3 text-right font-medium">Días CFDI</th>
              <th className="px-4 py-3 text-right font-medium" title="Días cotizados menos incapacidad y ausentismo (no se pagan)">
                Días IMSS pag.
              </th>
              <th className="px-4 py-3 text-right font-medium">Dif.</th>
              <th className="px-4 py-3 font-medium" title="¿Coinciden los días pagados en CFDI vs IMSS?">
                Cuadre días
              </th>
              <th className="px-4 py-3 font-medium">F. ingreso</th>
              <th className="px-4 py-3 font-medium">Puesto</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.curp} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-foreground">{r.nombre || "—"}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                    NSS {r.nss || "—"} · {r.rfc || "—"}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-foreground">{r.curp || "—"}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{r.sbcMax}</td>
                <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">{r.numCfdi}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{r.diasCfdi}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                  {r.diasImss ?? "s/d"}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right font-mono text-xs font-semibold",
                    r.diferencia === null
                      ? "text-muted-foreground"
                      : r.diferencia === 0
                        ? "text-success"
                        : "text-warning",
                  )}
                >
                  {r.diferencia === null ? "s/d" : r.diferencia > 0 ? `+${r.diferencia}` : r.diferencia}
                </td>
                <td className="px-4 py-3">
                  {r.diasStatus ? (
                    <StatusBadge status={r.diasStatus} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">s/d</span>
                  )}
                  {r.detalle && r.diasStatus === "REVISAR" && (
                    <p className="mt-1 max-w-52 text-pretty text-[11px] leading-tight text-muted-foreground">
                      {r.detalle}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.fechaIngreso || "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{r.puesto || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No hay registros que coincidan con el filtro.
          </p>
        )}
      </div>
    </div>
  )
}
