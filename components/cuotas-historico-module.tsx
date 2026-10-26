"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { extractPdfText } from "@/lib/pdf-extractor"
import {
  buildHistoricoCsv,
  consolidar,
  formatMoneyMx,
  parseCedula,
  periodoLabel,
  type CedulaParseResult,
  type TrabajadorPeriodo,
} from "@/lib/cuotas-historico"
import { FileDrop } from "./file-drop"
import {
  AlertIcon,
  ArchiveIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  LayersIcon,
  SearchIcon,
  SpinnerIcon,
  XIcon,
} from "./icons"

type Phase = "idle" | "processing" | "done" | "error"

const PAGE_SIZE = 50

export function CuotasHistoricoModule() {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState("")
  const [errorMsg, setErrorMsg] = useState("")
  const [cedulas, setCedulas] = useState<CedulaParseResult[]>([])
  const [fallidos, setFallidos] = useState<{ name: string; msg: string }[]>([])

  // Filtros de la tabla de detalle.
  const [query, setQuery] = useState("")
  const [regFiltro, setRegFiltro] = useState("todos")
  const [anioFiltro, setAnioFiltro] = useState("todos")
  const [page, setPage] = useState(0)

  const canRun = files.length > 0 && phase !== "processing"

  const consolidado = useMemo(() => (cedulas.length ? consolidar(cedulas) : null), [cedulas])

  const filas = useMemo(() => {
    if (!consolidado) return []
    const q = query.trim().toLowerCase()
    return consolidado.filas
      .filter((f) => (regFiltro === "todos" ? true : f.registroPatronal === regFiltro))
      .filter((f) => (anioFiltro === "todos" ? true : (f.periodo ?? "").startsWith(anioFiltro)))
      .filter((f) => {
        if (!q) return true
        return (
          f.nombre.toLowerCase().includes(q) ||
          f.nss.toLowerCase().includes(q) ||
          (f.curp ?? "").toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const n = a.nombre.localeCompare(b.nombre, "es")
        if (n !== 0) return n
        return (a.periodo ?? "").localeCompare(b.periodo ?? "")
      })
  }, [consolidado, query, regFiltro, anioFiltro])

  const totalPages = Math.max(1, Math.ceil(filas.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages - 1)
  const pageRows = filas.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE)

  const usedOcr = cedulas.some((c) => c.usedOcr)
  const warnings = cedulas.flatMap((c) => c.warnings.map((w) => `${c.archivo}: ${w}`))

  async function handleProcess() {
    setPhase("processing")
    setErrorMsg("")
    setFallidos([])
    try {
      const out: CedulaParseResult[] = []
      const failed: { name: string; msg: string }[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`Leyendo ${f.name} (${i + 1}/${files.length})…`)
        try {
          const res = await extractPdfText(f, (m) => setProgress(`${f.name}: ${m}`), { preserveRows: true })
          const parsed = parseCedula(res.text, f.name, res.usedOcr)
          out.push(parsed)
        } catch (e) {
          // Un PDF ilegible no debe abortar todo el lote: se registra y se sigue.
          failed.push({ name: f.name, msg: (e as Error).message })
        }
        // Cede el hilo entre archivos para que el navegador libere memoria y pinte el progreso.
        await new Promise((r) => setTimeout(r, 0))
      }
      if (out.length === 0) {
        setErrorMsg(`No se pudo leer ninguna de las ${files.length} cédulas cargadas.`)
        setPhase("error")
        setProgress("")
        return
      }
      setCedulas(out)
      setFallidos(failed)
      setPage(0)
      setPhase("done")
      setProgress("")
    } catch (e) {
      setErrorMsg((e as Error).message)
      setPhase("error")
      setProgress("")
    }
  }

  function reset() {
    setFiles([])
    setCedulas([])
    setFallidos([])
    setQuery("")
    setRegFiltro("todos")
    setAnioFiltro("todos")
    setPage(0)
    setErrorMsg("")
    setPhase("idle")
  }

  function exportCsv() {
    if (filas.length === 0) return
    const csv = buildHistoricoCsv(filas)
    const filename = `historico-cuotas-imss-${new Date().toISOString().slice(0, 10)}.csv`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })

    // En el preview de v0 la app corre dentro de un iframe; la descarga
    // programática (a.click con blob) puede quedar bloqueada. Detectamos ese
    // caso y abrimos el archivo en una pestaña nueva como respaldo.
    const inIframe = (() => {
      try {
        return window.self !== window.top
      } catch {
        return true
      }
    })()

    const url = URL.createObjectURL(blob)

    if (inIframe) {
      const win = window.open(url, "_blank")
      if (!win) {
        // Popup bloqueado: como último recurso usamos un data URL descargable.
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        a.target = "_blank"
        a.rel = "noopener"
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }

    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ArchiveIcon width={22} height={22} />
          </span>
          <div>
            <h1 className="text-balance text-xl font-semibold text-foreground sm:text-2xl">
              Histórico de cuotas obrero-patronales
            </h1>
            <p className="text-sm text-muted-foreground">
              Lectura masiva de cédulas SUA de varios registros patronales y años · detalle por trabajador y período.
            </p>
          </div>
        </div>
        <p className="flex items-center gap-2 self-start rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
          <CheckIcon width={14} height={14} strokeWidth={2.25} />
          Procesamiento 100% local · tus archivos nunca salen del navegador
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card/50 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
            1
          </span>
          <div className="flex flex-1 items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Cargar cédulas de determinación</h2>
            <span className="text-xs text-muted-foreground">varios .pdf</span>
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Arrastra todas las cédulas SUA que quieras consolidar —de distintos registros patronales y períodos—. Cada
          trabajador se agrupa por su <strong className="font-medium text-foreground">NSS</strong>, se le propaga su
          identidad a los sub-renglones de movimientos y se conserva el{" "}
          <strong className="font-medium text-foreground">registro patronal</strong> de origen.
        </p>
        <div className="mt-4">
          <FileDrop
            title="Arrastra las cédulas de cuotas (PDF)"
            hint="Puedes soltar 50-60 archivos de varios años; el OCR se activa solo si algún PDF está escaneado"
            accept=".pdf"
            multiple
            icon={<ArchiveIcon width={22} height={22} />}
            files={files}
            onFiles={setFiles}
            disabled={phase === "processing"}
          />
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={handleProcess} disabled={!canRun} size="lg" className="gap-2">
          {phase === "processing" ? (
            <SpinnerIcon width={18} height={18} className="animate-spin" />
          ) : (
            <LayersIcon width={18} height={18} />
          )}
          {phase === "processing" ? "Procesando…" : `Consolidar ${files.length || ""} cédulas`.trim()}
        </Button>
        {(cedulas.length > 0 || phase === "error") && (
          <Button onClick={reset} variant="outline" size="lg" disabled={phase === "processing"}>
            Limpiar
          </Button>
        )}
        {phase === "processing" && progress && (
          <span className="text-sm text-muted-foreground">{progress}</span>
        )}
      </div>

      {phase === "error" && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <XIcon width={16} height={16} />
          {errorMsg}
        </p>
      )}

      {phase === "done" && consolidado && (
        <>
          <KpiGrid consolidado={consolidado} cedulaCount={cedulas.length} />

          {usedOcr && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              Al menos un PDF se leyó con OCR. Verifica los días y las cuotas de esos documentos.
            </p>
          )}

          {fallidos.length > 0 && (
            <details className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-danger">
                {fallidos.length} archivo{fallidos.length > 1 ? "s" : ""} no se pudo leer (el resto sí se consolidó)
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {fallidos.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium text-foreground">{f.name}</span>: {f.msg}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <CedulasResumen cedulas={cedulas} />

          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card/50 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Detalle por trabajador y período</h2>
                <p className="text-xs text-muted-foreground">
                  {filas.length.toLocaleString("es-MX")} registros
                  {filas.length !== consolidado.filas.length
                    ? ` (de ${consolidado.filas.length.toLocaleString("es-MX")})`
                    : ""}
                </p>
              </div>
              <Button onClick={exportCsv} variant="outline" size="sm" className="gap-2 self-start">
                <DownloadIcon width={16} height={16} />
                Exportar Excel
              </Button>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
                <SearchIcon width={16} height={16} className="text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setPage(0)
                  }}
                  placeholder="Buscar por nombre, NSS o CURP…"
                  className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                  aria-label="Buscar trabajador"
                />
              </label>
              <FilterSelect
                icon={<BuildingIcon width={16} height={16} className="text-muted-foreground" />}
                value={regFiltro}
                onChange={(v) => {
                  setRegFiltro(v)
                  setPage(0)
                }}
                ariaLabel="Filtrar por registro patronal"
                options={[
                  { value: "todos", label: "Todos los registros" },
                  ...consolidado.registros.map((r) => ({ value: r, label: r })),
                ]}
              />
              <FilterSelect
                icon={<CalendarIcon width={16} height={16} className="text-muted-foreground" />}
                value={anioFiltro}
                onChange={(v) => {
                  setAnioFiltro(v)
                  setPage(0)
                }}
                ariaLabel="Filtrar por año"
                options={[
                  { value: "todos", label: "Todos los años" },
                  ...consolidado.anios.map((y) => ({ value: y, label: y })),
                ]}
              />
            </div>

            {warnings.length > 0 && (
              <details className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-warning">
                  {warnings.length} advertencia{warnings.length > 1 ? "s" : ""} de lectura
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                  {warnings.slice(0, 40).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {warnings.length > 40 && <li>… y {warnings.length - 40} más.</li>}
                </ul>
              </details>
            )}

            <DetalleTabla rows={pageRows} />

            {filas.length > PAGE_SIZE && (
              <Paginador
                page={pageSafe}
                totalPages={totalPages}
                onPrev={() => setPage((p) => Math.max(0, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}

function KpiGrid({
  consolidado,
  cedulaCount,
}: {
  consolidado: ReturnType<typeof consolidar>
  cedulaCount: number
}) {
  const periodos = consolidado.periodos
  const rango =
    periodos.length > 0
      ? `${periodoLabel(periodos[0])} — ${periodoLabel(periodos[periodos.length - 1])}`
      : "—"
  const items = [
    { label: "Cédulas procesadas", value: cedulaCount.toLocaleString("es-MX") },
    { label: "Registros patronales", value: consolidado.registros.length.toLocaleString("es-MX") },
    { label: "Trabajadores únicos (NSS)", value: consolidado.trabajadoresUnicos.toLocaleString("es-MX") },
    { label: "Renglones trabajador-período", value: consolidado.filas.length.toLocaleString("es-MX") },
    { label: "Días cotizados (total)", value: consolidado.diasTotales.toLocaleString("es-MX") },
    { label: "Cuotas obrero-patronales", value: formatMoneyMx(consolidado.cuotaTotal) },
  ]
  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card/50 px-5 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Rango de períodos:</span> {rango}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col gap-1 rounded-2xl border border-border bg-card/50 p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{it.label}</span>
            <span className="text-2xl font-semibold text-foreground">{it.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function CedulasResumen({ cedulas }: { cedulas: CedulaParseResult[] }) {
  return (
    <details className="rounded-2xl border border-border bg-card/50 p-5">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        Detalle por cédula ({cedulas.length})
      </summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Registro</th>
              <th className="py-2 pr-3 font-medium">Período</th>
              <th className="py-2 pr-3 font-medium">Trabaj.</th>
              <th className="py-2 pr-3 text-right font-medium">Suma cuotas</th>
              <th className="py-2 pr-3 text-right font-medium">Total declarado</th>
              <th className="py-2 font-medium">Cuadre</th>
            </tr>
          </thead>
          <tbody>
            {cedulas.map((c, i) => {
              const suma = c.trabajadores.reduce((s, t) => s + t.cuota, 0)
              const declarado = c.totalDeclarado
              const cuadra = declarado != null ? Math.abs(suma - declarado) <= Math.max(1, declarado * 0.01) : null
              return (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-foreground">
                    {c.header.registroPatronal ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{periodoLabel(c.header.periodo)}</td>
                  <td className="py-2 pr-3 text-foreground">{c.trabajadores.length}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-foreground">{formatMoneyMx(suma)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatMoneyMx(declarado)}
                  </td>
                  <td className="py-2">
                    {cuadra === true ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <CheckIcon width={13} height={13} strokeWidth={2.5} /> Cuadra
                      </span>
                    ) : cuadra === false ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                        <AlertIcon width={13} height={13} /> Revisar
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function DetalleTabla({ rows }: { rows: TrabajadorPeriodo[] }) {
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        <FileTextIcon width={16} height={16} />
        No hay registros que coincidan con los filtros.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Período</th>
            <th className="py-2 pr-3 font-medium">Registro</th>
            <th className="py-2 pr-3 font-medium">NSS</th>
            <th className="py-2 pr-3 font-medium">Nombre</th>
            <th className="py-2 pr-3 font-medium">CURP</th>
            <th className="py-2 pr-3 text-right font-medium">Días</th>
            <th className="py-2 pr-3 text-right font-medium">SDI</th>
            <th className="py-2 text-right font-medium">Cuota O-P</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr key={`${f.nss}-${f.periodo}-${i}`} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{periodoLabel(f.periodo)}</td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-muted-foreground">
                {f.registroPatronal ?? "—"}
                {f.movimientos > 1 && (
                  <span
                    className="ml-1 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
                    title={`${f.movimientos} movimientos consolidados`}
                  >
                    {f.movimientos} mov
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-foreground">{f.nss}</td>
              <td className="py-2 pr-3 text-foreground">{f.nombre}</td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-muted-foreground">
                {f.curp ?? "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">{f.dias}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {f.sdi != null ? f.sdi.toFixed(2) : "—"}
              </td>
              <td className="py-2 text-right tabular-nums text-foreground">{formatMoneyMx(f.cuota)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilterSelect({
  icon,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
      {icon}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[11rem] bg-transparent font-medium text-foreground outline-none"
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Paginador({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number
  totalPages: number
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">
        Página {page + 1} de {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button onClick={onPrev} variant="outline" size="sm" disabled={page === 0} className="gap-1">
          <ChevronLeftIcon width={16} height={16} />
          Anterior
        </Button>
        <Button onClick={onNext} variant="outline" size="sm" disabled={page >= totalPages - 1} className="gap-1">
          Siguiente
          <ChevronRightIcon width={16} height={16} />
        </Button>
      </div>
    </div>
  )
}
