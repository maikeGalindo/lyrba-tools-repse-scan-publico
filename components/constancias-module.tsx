"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { extractPdfText } from "@/lib/pdf-extractor"
import type { LoadedDoc } from "@/lib/expediente-loader"
import {
  analyzeConstancia,
  evaluateConstancia,
  formatMonth,
  sameMonth,
  CONSTANCIA_TIPOS,
  type ConstanciaAnalysis,
  type ConstanciaTipo,
  type ConstanciaTipoMeta,
} from "@/lib/constancias"
import type { MatchStatus } from "@/lib/types"
import { FileDrop } from "./file-drop"
import {
  AlertIcon,
  BuildingIcon,
  CheckIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  LandmarkIcon,
  ReceiptIcon,
  SpinnerIcon,
  XIcon,
} from "./icons"

type Phase = "idle" | "processing" | "done" | "error"

const TIPO_ICON: Record<ConstanciaTipo, typeof ReceiptIcon> = {
  sat: ReceiptIcon,
  imss: LandmarkIcon,
  infonavit: BuildingIcon,
}

export function ConstanciasModule({ mes, injected }: { mes: string; injected?: LoadedDoc[] | null }) {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState("")
  const [localAnalyses, setLocalAnalyses] = useState<ConstanciaAnalysis[]>([])
  const [errorMsg, setErrorMsg] = useState("")
  const [localUnknown, setLocalUnknown] = useState<string[]>([])

  const fromZip = Boolean(injected && injected.length)

  const injectedAnalyses = useMemo(
    () => (fromZip ? injected!.map((d) => analyzeConstancia(d.text, d.name, d.usedOcr)) : null),
    [injected, fromZip],
  )

  const analyses = injectedAnalyses ?? localAnalyses
  const unknown = injectedAnalyses
    ? injectedAnalyses.filter((a) => !a.tipo).map((a) => a.archivo)
    : localUnknown
  const effectivePhase: Phase = fromZip ? "done" : phase

  const canRun = files.length > 0 && phase !== "processing"

  const byTipo = useMemo(() => {
    const map = new Map<ConstanciaTipo, ConstanciaAnalysis>()
    for (const a of analyses) {
      if (a.tipo && !map.has(a.tipo)) map.set(a.tipo, a)
    }
    return map
  }, [analyses])

  const evaluations = useMemo(
    () =>
      CONSTANCIA_TIPOS.map((meta) => ({
        meta,
        analysis: byTipo.get(meta.tipo),
        result: evaluateConstancia(byTipo.get(meta.tipo), meta, mes),
      })),
    [byTipo, mes],
  )

  const mesesPresentes = useMemo(() => {
    const set = new Set<string>()
    for (const { analysis } of evaluations) {
      if (analysis?.mesEmision) set.add(analysis.mesEmision)
    }
    return [...set]
  }, [evaluations])

  const mismatchMeses = mesesPresentes.length > 1
  const usedOcr = analyses.some((a) => a.usedOcr)

  const overall = useMemo<MatchStatus | null>(() => {
    if (effectivePhase !== "done") return null
    const statuses = evaluations.map((e) => e.result.status)
    if (statuses.some((s) => s === null)) return "REVISAR"
    if (statuses.some((s) => s === "NO_OK")) return "NO_OK"
    if (statuses.some((s) => s === "REVISAR") || mismatchMeses) return "REVISAR"
    return "OK"
  }, [evaluations, phase, mismatchMeses])

  async function handleProcess() {
    setPhase("processing")
    setErrorMsg("")
    setLocalUnknown([])
    try {
      const out: ConstanciaAnalysis[] = []
      const noIdent: string[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`Leyendo ${f.name} (${i + 1}/${files.length})…`)
        const res = await extractPdfText(f, (m) => setProgress(`${f.name}: ${m}`))
        const analysis = analyzeConstancia(res.text, f.name, res.usedOcr)
        if (!analysis.tipo) noIdent.push(f.name)
        out.push(analysis)
      }
      setLocalAnalyses(out)
      setLocalUnknown(noIdent)
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
    setLocalAnalyses([])
    setLocalUnknown([])
    setErrorMsg("")
    setPhase("idle")
  }

  return (
    <div className="flex w-full flex-col gap-8">
      {!fromZip && (
        <section className="rounded-2xl border border-border bg-card/50 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
              1
            </span>
            <div className="flex flex-1 items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Constancias de cumplimiento</h2>
              <span className="text-xs text-muted-foreground">Hasta 3 archivos .pdf</span>
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Carga las opiniones de <strong className="font-medium text-foreground">SAT (32-D)</strong>,{" "}
            <strong className="font-medium text-foreground">IMSS</strong> e{" "}
            <strong className="font-medium text-foreground">INFONAVIT</strong>. Se identifican automáticamente; se
            valida que las tres tengan sentido positivo y fecha de expedición dentro de {formatMonth(mes)}.
          </p>
          <div className="mt-4">
            <FileDrop
              title="Arrastra las constancias (32-D, IMSS, INFONAVIT)"
              hint="Cada PDF se clasifica solo por su contenido; el OCR se activa si el documento está escaneado"
              accept=".pdf"
              multiple
              icon={<ClipboardCheckIcon width={22} height={22} />}
              files={files}
              onFiles={setFiles}
              disabled={phase === "processing"}
            />
          </div>
        </section>
      )}

      {fromZip && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <FileTextIcon width={16} height={16} />
          Documentos tomados del expediente .zip cargado. Para reemplazarlos, usa la carga individual desde el modo
          manual.
        </p>
      )}

      {!fromZip && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={handleProcess} disabled={!canRun} size="lg" className="gap-2">
            {phase === "processing" ? (
              <SpinnerIcon width={18} height={18} className="animate-spin" />
            ) : (
              <ClipboardCheckIcon width={18} height={18} />
            )}
            {phase === "processing" ? "Validando…" : "Validar constancias"}
          </Button>
          {(analyses.length > 0 || phase === "error") && (
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

      {effectivePhase === "done" && (
        <>
          <OverallBanner status={overall} mes={mes} />

          {usedOcr && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              Al menos una constancia se leyó con OCR. Verifica las fechas y el sentido detectados.
            </p>
          )}

          {mismatchMeses && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              Las constancias no fueron expedidas en el mismo mes ({mesesPresentes.map(formatMonth).join(", ")}). Deben corresponder al mismo periodo.
            </p>
          )}

          {unknown.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              No se pudo identificar la autoridad de: {unknown.join(", ")}. ¿Es una constancia de SAT, IMSS o INFONAVIT?
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            {evaluations.map(({ meta, analysis, result }) => (
              <ConstanciaCard key={meta.tipo} meta={meta} analysis={analysis} status={result.status} detalle={result.detalle} mes={mes} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function OverallBanner({ status, mes }: { status: MatchStatus | null; mes: string }) {
  const map = {
    OK: {
      cls: "border-success/30 bg-success/10 text-success",
      icon: <CheckIcon width={18} height={18} strokeWidth={2.25} />,
      title: "Constancias en regla",
      desc: `Las tres opiniones son positivas y fueron expedidas en ${formatMonth(mes)}.`,
    },
    REVISAR: {
      cls: "border-warning/30 bg-warning/10 text-warning",
      icon: <AlertIcon width={18} height={18} />,
      title: "Requiere revisión",
      desc: "Falta alguna constancia, hay fechas fuera del mes revisado o un sentido no determinado.",
    },
    NO_OK: {
      cls: "border-danger/30 bg-danger/10 text-danger",
      icon: <XIcon width={18} height={18} />,
      title: "Constancia no favorable",
      desc: "Al menos una opinión es negativa o presenta adeudo.",
    },
  } as const
  const s = status ?? "REVISAR"
  const v = map[s]
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-5 py-4", v.cls)}>
      <span className="mt-0.5 shrink-0">{v.icon}</span>
      <div>
        <p className="font-semibold">{v.title}</p>
        <p className="text-sm opacity-90">{v.desc}</p>
      </div>
    </div>
  )
}

function ConstanciaCard({
  meta,
  analysis,
  status,
  detalle,
  mes,
}: {
  meta: ConstanciaTipoMeta
  analysis: ConstanciaAnalysis | undefined
  status: MatchStatus | null
  detalle: string
  mes: string
}) {
  const Icon = TIPO_ICON[meta.tipo]
  const faltante = status === null

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card/50 p-5",
        faltante ? "border-dashed border-border opacity-80" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            faltante ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          <Icon width={22} height={22} />
        </span>
        <StatusBadge status={status} />
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
        <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Sentido</dt>
          <dd className="font-medium text-foreground">{sentidoLabel(analysis, meta)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Expedición</dt>
          <dd className="font-medium text-foreground">{analysis?.fechaRaw ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Mes</dt>
          <dd
            className={cn(
              "font-medium",
              sameMonth(analysis?.mesEmision, mes) ? "text-success" : analysis?.mesEmision ? "text-warning" : "text-muted-foreground",
            )}
          >
            {formatMonth(analysis?.mesEmision ?? null)}
          </dd>
        </div>
      </dl>

      <p className="mt-auto text-xs leading-relaxed text-muted-foreground">{detalle}</p>
    </div>
  )
}

function sentidoLabel(analysis: ConstanciaAnalysis | undefined, meta: ConstanciaTipoMeta) {
  if (!analysis) return "—"
  if (analysis.sentido === "positivo") return meta.positivoLabel
  if (analysis.sentido === "negativo") return meta.negativoLabel
  return "No determinado"
}

function StatusBadge({ status }: { status: MatchStatus | null }) {
  if (status === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <FileTextIcon width={12} height={12} />
        Sin cargar
      </span>
    )
  }
  if (status === "OK") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
        <CheckIcon width={12} height={12} strokeWidth={2.5} />
        OK
      </span>
    )
  }
  if (status === "REVISAR") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
        <AlertIcon width={12} height={12} />
        Revisar
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
      <XIcon width={12} height={12} />
      No OK
    </span>
  )
}
