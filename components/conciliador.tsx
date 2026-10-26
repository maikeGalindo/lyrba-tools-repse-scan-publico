"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { gatherXmls, type LoadedXml } from "@/lib/zip-loader"
import type { LoadedDoc } from "@/lib/expediente-loader"
import { parseCfdiNomina } from "@/lib/xml-parser"
import { extractPdfText } from "@/lib/pdf-extractor"
import { extractCurps, extractImssDaysByCurp, matchEmpleado, normalize } from "@/lib/matcher"
import { aggregate } from "@/lib/aggregate"
import { exportCsv, exportXlsx } from "@/lib/export"
import type { ContribuyenteIdentity, EmpleadoRecord, EmpleadoResumen, MatchStatus } from "@/lib/types"
import { FileDrop } from "./file-drop"
import { ResultsTable } from "./results-table"
import { ResumenTable } from "./resumen-table"
import {
  AlertIcon,
  ArchiveIcon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  LayersIcon,
  SpinnerIcon,
  XIcon,
} from "./icons"

type Phase = "idle" | "processing" | "done" | "error"

export interface NominaInjection {
  cfdis: LoadedXml[]
  cedula: LoadedDoc | null
}

export function Conciliador({
  onIdentity,
  injected,
}: {
  onIdentity?: (id: ContribuyenteIdentity | null) => void
  injected?: NominaInjection | null
}) {
  const fromZip = !!injected
  const [cfdiFiles, setCfdiFiles] = useState<File[]>([])
  const [pdfFile, setPdfFile] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState("")
  const [records, setRecords] = useState<EmpleadoRecord[]>([])
  const [resumen, setResumen] = useState<EmpleadoResumen[]>([])
  const [view, setView] = useState<"resumen" | "detalle">("resumen")
  const [warnings, setWarnings] = useState<string[]>([])
  const [usedOcr, setUsedOcr] = useState(false)
  const [imssDiag, setImssDiag] = useState<{
    textLength: number
    curpsFound: number
    movementsFound: number
    totalDays: number
    sample: string
  } | null>(null)
  const [pdfText, setPdfText] = useState("")
  const [showDiag, setShowDiag] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [patron, setPatron] = useState<ContribuyenteIdentity | null>(null)
  const [multiPatron, setMultiPatron] = useState<string[]>([])

  const canRun = cfdiFiles.length > 0 && pdfFile.length === 1 && phase !== "processing"

  const summary = useMemo(() => {
    const s = { total: resumen.length, ok: 0, revisar: 0, noOk: 0 }
    for (const r of resumen) {
      if (r.status === "OK") s.ok++
      else if (r.status === "REVISAR") s.revisar++
      else s.noOk++
    }
    return s
  }, [resumen])

  // Núcleo de conciliación compartido por la carga manual y por la inyección
  // desde el ZIP maestro: recibe los XML ya leídos y el texto de la cédula ya
  // extraído, así el camino del ZIP no vuelve a correr OCR ni descompresión.
  async function runConciliacion(xmls: LoadedXml[], pdf: { text: string; usedOcr: boolean }) {
    const parsed: EmpleadoRecord[] = []
    const localWarnings: string[] = []
    xmls.forEach((xml, i) => {
      const res = parseCfdiNomina(xml.text, xml.name)
      if (res.ok && res.record) {
        parsed.push({ ...res.record, id: `${i}-${xml.name}`, status: "NO_OK" })
      } else if (res.error) {
        localWarnings.push(res.error)
      }
    })

    if (parsed.length === 0) {
      throw new Error("Ningún XML resultó ser un CFDI de nómina válido.")
    }

    // Identidad del patrón: emisor mayoritario entre los CFDI. Si aparecen
    // varios RFC de emisor, los respaldos mezclan empresas distintas.
    const emisores = new Map<string, { nombre: string; count: number }>()
    for (const r of parsed) {
      if (!r.emisorRfc) continue
      const prev = emisores.get(r.emisorRfc) ?? { nombre: r.emisorNombre, count: 0 }
      prev.count++
      if (!prev.nombre && r.emisorNombre) prev.nombre = r.emisorNombre
      emisores.set(r.emisorRfc, prev)
    }
    const emisorRanking = [...emisores.entries()].sort((a, b) => b[1].count - a[1].count)
    const identity: ContribuyenteIdentity | null = emisorRanking.length
      ? { rfc: emisorRanking[0][0], razonSocial: emisorRanking[0][1].nombre || null }
      : null
    setPatron(identity)
    setMultiPatron(emisorRanking.length > 1 ? emisorRanking.map(([rfc]) => rfc) : [])
    onIdentity?.(identity)

    setUsedOcr(pdf.usedOcr)
    setPdfText(pdf.text)

    const pdfNorm = normalize(pdf.text)
    const pdfCurps = extractCurps(pdf.text)
    const imss = extractImssDaysByCurp(pdf.text)
    setImssDiag(imss.diagnostics)

    setProgress("Cruzando CURP y días contra la cédula…")
    const matched = parsed.map((r) => {
      const outcome = matchEmpleado({ curp: r.curp, nss: r.nss, nombre: r.nombre }, pdfNorm, pdfCurps)
      return {
        ...r,
        status: outcome.status,
        detalle: outcome.detalle,
        matchedCurp: outcome.matchedCurp,
      }
    })

    setRecords(matched)
    setResumen(aggregate(matched, imss.days))
    setWarnings(localWarnings)
    setPhase("done")
    setProgress("")
  }

  async function handleProcess() {
    setPhase("processing")
    setWarnings([])
    setRecords([])
    setErrorMsg("")
    try {
      setProgress("Descomprimiendo y leyendo CFDI…")
      const xmls = await gatherXmls(cfdiFiles)
      if (xmls.length === 0) {
        throw new Error("No se encontraron archivos .xml en las fuentes cargadas.")
      }
      setProgress("Procesando cédula IMSS (PDF)…")
      const pdfRes = await extractPdfText(pdfFile[0], setProgress)
      await runConciliacion(xmls, { text: pdfRes.text, usedOcr: pdfRes.usedOcr })
    } catch (e) {
      setErrorMsg((e as Error).message)
      setPhase("error")
      setProgress("")
    }
  }

  // Camino del ZIP maestro: procesa los documentos ya clasificados y extraídos.
  const injectedKey = injected
    ? `${injected.cfdis.length}:${injected.cedula?.name ?? ""}:${injected.cedula?.text.length ?? 0}`
    : ""
  useEffect(() => {
    if (!injected) return
    if (injected.cfdis.length === 0 && !injected.cedula) return
    setPhase("processing")
    setWarnings([])
    setRecords([])
    setErrorMsg("")
    setProgress("Conciliando expediente…")
    runConciliacion(injected.cfdis, {
      text: injected.cedula?.text ?? "",
      usedOcr: injected.cedula?.usedOcr ?? false,
    }).catch((e) => {
      setErrorMsg((e as Error).message)
      setPhase("error")
      setProgress("")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedKey])

  function reset() {
    setCfdiFiles([])
    setPdfFile([])
    setRecords([])
    setResumen([])
    setWarnings([])
    setErrorMsg("")
    setUsedOcr(false)
    setImssDiag(null)
    setPdfText("")
    setShowDiag(false)
    setPatron(null)
    setMultiPatron([])
    onIdentity?.(null)
    setPhase("idle")
  }

  return (
    <div className="flex w-full flex-col gap-8">
      {!fromZip && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card/50 p-5">
            <SectionLabel step="1" title="CFDI de Nómina" note="Acepta .zip o .xml (múltiples)" />
            <div className="mt-4">
              <FileDrop
                title="Arrastra el ZIP de respaldos o los XML"
                hint="Del ZIP se extraen solo los .xml de nómina; los PDF internos se ignoran"
                accept=".zip,.xml"
                multiple
                icon={<ArchiveIcon width={22} height={22} />}
                files={cfdiFiles}
                onFiles={setCfdiFiles}
                disabled={phase === "processing"}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/50 p-5">
            <SectionLabel step="2" title="Cédula IMSS" note="Un archivo .pdf" />
            <div className="mt-4">
              <FileDrop
                title="Arrastra la cédula de cuotas obrero-patronales"
                hint="Texto nativo o escaneado — el OCR se activa solo si hace falta"
                accept=".pdf"
                icon={<FileTextIcon width={22} height={22} />}
                files={pdfFile}
                onFiles={setPdfFile}
                disabled={phase === "processing"}
              />
            </div>
          </div>
        </section>
      )}

      {fromZip ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <FileTextIcon width={16} height={16} className="shrink-0" />
          {phase === "processing" ? (
            <span className="flex items-center gap-2">
              <SpinnerIcon width={16} height={16} className="animate-spin" />
              {progress || "Procesando expediente…"}
            </span>
          ) : (
            <span>
              Cargado desde el expediente ZIP: {injected?.cfdis.length ?? 0} CFDI
              {injected?.cedula ? " y la cédula IMSS" : " (sin cédula IMSS en el ZIP)"}.
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={handleProcess} disabled={!canRun} size="lg" className="gap-2">
            {phase === "processing" ? (
              <SpinnerIcon width={18} height={18} className="animate-spin" />
            ) : (
              <LayersIcon width={18} height={18} />
            )}
            {phase === "processing" ? "Procesando…" : "Conciliar CFDI ↔ Cédula"}
          </Button>
          {(records.length > 0 || phase === "error") && (
            <Button onClick={reset} variant="outline" size="lg" disabled={phase === "processing"}>
              Limpiar
            </Button>
          )}
          {phase === "processing" && progress && (
            <span className="text-sm text-muted-foreground">{progress}</span>
          )}
        </div>
      )}

      {phase === "error" && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <XIcon width={16} height={16} />
          {errorMsg}
        </p>
      )}

      {pdfText && (
        <div
          className={cn(
            "flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm",
            imssDiag && imssDiag.movementsFound === 0
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <AlertIcon width={16} height={16} />
              Diagnóstico de lectura de días (IMSS)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDiag((v) => !v)}
                className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium"
              >
                {showDiag ? "Ocultar texto" : "Ver texto extraído"}
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(pdfText)}
                className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium"
              >
                Copiar texto
              </button>
            </div>
          </div>
          {imssDiag && (
            <p className="text-xs">
              {imssDiag.curpsFound} CURP detectadas · {imssDiag.textLength} caracteres ·{" "}
              {imssDiag.movementsFound} movimientos con días · {imssDiag.totalDays} días sumados.
              {imssDiag.movementsFound === 0 &&
                ' No se detectaron días. Pulsa "Copiar texto" y compárteme el contenido para ajustar la lectura al formato real de tu cédula.'}
            </p>
          )}
          {showDiag && (
            <textarea
              readOnly
              value={pdfText}
              onFocus={(e) => e.currentTarget.select()}
              className="h-48 w-full resize-y rounded bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-foreground"
            />
          )}
        </div>
      )}

      {resumen.length > 0 && (
        <>
          <OverallBanner summary={summary} multiPatron={multiPatron.length > 1} patron={patron} />

          <SummaryBar {...summary} />

          {multiPatron.length > 1 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              Los CFDI provienen de {multiPatron.length} patrones distintos ({multiPatron.join(", ")}). El expediente debe corresponder a un solo contribuyente.
            </p>
          )}

          {usedOcr && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              La cédula se leyó mediante OCR. Revisa las filas marcadas como REVISAR: pueden deberse a errores de reconocimiento de un solo carácter.
            </p>
          )}

          {warnings.length > 0 && (
            <details className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-foreground">
                {warnings.length} archivo(s) omitido(s)
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i} className="font-mono">
                    {w}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-border bg-card/50 p-1">
                <button
                  type="button"
                  onClick={() => setView("resumen")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    view === "resumen"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Resumen · 1 fila por empleado
                </button>
                <button
                  type="button"
                  onClick={() => setView("detalle")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    view === "detalle"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Detalle · por CFDI
                </button>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => exportXlsx(resumen, records)} variant="outline" className="gap-2">
                  <DownloadIcon width={16} height={16} />
                  Excel (.xlsx)
                </Button>
                <Button onClick={() => exportCsv(resumen)} variant="outline" className="gap-2">
                  <DownloadIcon width={16} height={16} />
                  CSV
                </Button>
              </div>
            </div>
            {view === "resumen" ? (
              <ResumenTable rows={resumen} />
            ) : (
              <ResultsTable records={records} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SectionLabel({ step, title, note }: { step: string; title: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
        {step}
      </span>
      <div className="flex flex-1 items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>
    </div>
  )
}

function OverallBanner({
  summary,
  multiPatron,
  patron,
}: {
  summary: { total: number; ok: number; revisar: number; noOk: number }
  multiPatron: boolean
  patron: ContribuyenteIdentity | null
}) {
  const status: MatchStatus =
    summary.noOk > 0 || multiPatron ? "NO_OK" : summary.revisar > 0 ? "REVISAR" : "OK"

  const theme = {
    OK: {
      ring: "border-success/30",
      bg: "bg-success/10",
      text: "text-success",
      icon: <CheckIcon width={20} height={20} />,
      title: "Nómina conciliada",
      note: "Todos los empleados cuadran entre CFDI y cédula IMSS.",
    },
    REVISAR: {
      ring: "border-warning/30",
      bg: "bg-warning/10",
      text: "text-warning",
      icon: <AlertIcon width={20} height={20} />,
      title: "Requiere revisión",
      note: "Algunos empleados no cuadran; revisa las filas marcadas.",
    },
    NO_OK: {
      ring: "border-danger/30",
      bg: "bg-danger/10",
      text: "text-danger",
      icon: <XIcon width={20} height={20} />,
      title: multiPatron ? "Expediente inconsistente" : "Diferencias detectadas",
      note: multiPatron
        ? "Los CFDI provienen de más de un contribuyente."
        : "Hay empleados sin conciliar entre CFDI y cédula.",
    },
  }[status]

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4", theme.ring, theme.bg)}>
      <div className={cn("flex items-start gap-3", theme.text)}>
        <span className="mt-0.5 shrink-0">{theme.icon}</span>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold">{theme.title}</p>
          <p className="text-xs text-foreground/70">{theme.note}</p>
        </div>
      </div>
      {patron && (patron.rfc || patron.razonSocial) && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Contribuyente (emisor de los CFDI)
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-mono text-sm font-semibold text-foreground">
              {patron.rfc || "RFC no detectado"}
            </span>
            {patron.razonSocial && (
              <span className="text-sm text-foreground/80">{patron.razonSocial}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryBar({
  total,
  ok,
  revisar,
  noOk,
}: {
  total: number
  ok: number
  revisar: number
  noOk: number
}) {
  const cards = [
    { label: "Empleados únicos", value: total, cls: "text-foreground", ring: "border-border" },
    { label: "OK", value: ok, cls: "text-success", ring: "border-success/30" },
    { label: "Revisar", value: revisar, cls: "text-warning", ring: "border-warning/30" },
    { label: "No OK", value: noOk, cls: "text-danger", ring: "border-danger/30" },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className={cn("rounded-xl border bg-card/50 px-4 py-4", c.ring)}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {c.label}
          </p>
          <p className={cn("mt-1 font-mono text-2xl font-semibold", c.cls)}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}
