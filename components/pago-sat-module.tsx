"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { extractPdfText } from "@/lib/pdf-extractor"
import { formatMonth } from "@/lib/constancias"
import type { LoadedDoc } from "@/lib/expediente-loader"
import {
  analyzeSatDoc,
  conceptoLabel,
  conciliarSat,
  evaluatePagoSat,
  formatMoney,
  type SatConciliacion,
  type SatDocAnalysis,
  type SatDocTipo,
} from "@/lib/pago-sat"
import type { MatchStatus } from "@/lib/types"
import { FileDrop } from "./file-drop"
import {
  AlertIcon,
  CheckIcon,
  FileTextIcon,
  LandmarkIcon,
  ReceiptIcon,
  SpinnerIcon,
  XIcon,
} from "./icons"

type Phase = "idle" | "processing" | "done" | "error"

const DOC_META: Record<SatDocTipo, { label: string; subtitle: string; icon: typeof ReceiptIcon }> = {
  acuse: {
    label: "Acuse de recibo · SAT",
    subtitle: "Declaración provisional o definitiva",
    icon: FileTextIcon,
  },
  banco: {
    label: "Comprobante de pago",
    subtitle: "Recibo bancario o información registrada de pagos (SAT)",
    icon: LandmarkIcon,
  },
}

export function PagoSatModule({ mes, injected }: { mes: string; injected?: LoadedDoc[] | null }) {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState("")
  const [localDocs, setLocalDocs] = useState<SatDocAnalysis[]>([])
  const [errorMsg, setErrorMsg] = useState("")
  const [localUnknown, setLocalUnknown] = useState<string[]>([])
  const [localTexts, setLocalTexts] = useState<{ text: string; name: string }[]>([])

  const fromZip = Boolean(injected && injected.length)

  // Cuando el ZIP maestro inyecta documentos ya extraídos, se analizan aquí
  // (el OCR ya corrió en el cargador, así que esto es una lectura barata).
  const injectedDocs = useMemo(
    () => (fromZip ? injected!.map((d) => analyzeSatDoc(d.text, d.name, d.usedOcr)) : null),
    [injected, fromZip],
  )

  const docs = injectedDocs ?? localDocs
  const unknown = injectedDocs ? injectedDocs.filter((d) => !d.tipo).map((d) => d.archivo) : localUnknown
  const effectivePhase: Phase = fromZip ? "done" : phase

  const canRun = files.length > 0 && phase !== "processing"

  const acuse = useMemo(() => docs.find((d) => d.tipo === "acuse"), [docs])
  const banco = useMemo(() => {
    const bancos = docs.filter((d) => d.tipo === "banco")
    // Si hay varios comprobantes (recibo bancario + información registrada),
    // prioriza el que comparte la línea de captura con el acuse.
    if (acuse?.lineaCaptura) {
      const matched = bancos.find((b) => b.lineaCaptura === acuse.lineaCaptura)
      if (matched) return matched
    }
    return bancos[0]
  }, [docs, acuse])

  const evalResult = useMemo(() => evaluatePagoSat(acuse, banco, mes), [acuse, banco, mes])
  const usedOcr = docs.some((d) => d.usedOcr)

  const sources = fromZip ? injected! : localTexts
  const conc = useMemo(() => conciliarSat(sources, mes), [sources, mes])
  const multiDecl =
    conc.evals.length > 1 || conc.evals.some((e) => e.pago && e.pago.archivo === e.declaracion.archivo)

  async function handleProcess() {
    setPhase("processing")
    setErrorMsg("")
    setLocalUnknown([])
    try {
      const out: SatDocAnalysis[] = []
      const noIdent: string[] = []
      const texts: { text: string; name: string }[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`Leyendo ${f.name} (${i + 1}/${files.length})…`)
        const res = await extractPdfText(f, (m) => setProgress(`${f.name}: ${m}`))
        texts.push({ text: res.text, name: f.name })
        const analysis = analyzeSatDoc(res.text, f.name, res.usedOcr)
        if (!analysis.tipo) noIdent.push(f.name)
        out.push(analysis)
      }
      setLocalDocs(out)
      setLocalTexts(texts)
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
    setLocalDocs([])
    setLocalTexts([])
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
              <h2 className="text-sm font-semibold text-foreground">Pago de impuestos federales</h2>
              <span className="text-xs text-muted-foreground">2–3 archivos .pdf</span>
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Carga el <strong className="font-medium text-foreground">acuse del SAT</strong> y su{" "}
            <strong className="font-medium text-foreground">comprobante de pago</strong> —recibo bancario o la{" "}
            <strong className="font-medium text-foreground">información registrada de pagos</strong> del SAT—. Se
            identifican automáticamente y se valida que la línea de captura coincida, que el importe cuadre (tolerancia
            ±1%) y que la declaración corresponda a {formatMonth(mes)}.
          </p>
          <div className="mt-4">
            <FileDrop
              title="Arrastra el acuse y el comprobante bancario"
              hint="Cada PDF se clasifica solo por su contenido; el OCR se activa si el documento está escaneado"
              accept=".pdf"
              multiple
              icon={<ReceiptIcon width={22} height={22} />}
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
              <ReceiptIcon width={18} height={18} />
            )}
            {phase === "processing" ? "Validando…" : "Validar pago"}
          </Button>
          {(docs.length > 0 || phase === "error") && (
            <Button onClick={reset} variant="outline" size="lg" disabled={phase === "processing"}>
              Limpiar
            </Button>
          )}
          {phase === "processing" && progress && <span className="text-sm text-muted-foreground">{progress}</span>}
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
          <OverallBanner
            status={multiDecl ? conc.status : evalResult.status}
            detalle={multiDecl ? conc.headline : evalResult.detalle}
          />

          {multiDecl && <DeclaracionesPanel conc={conc} />}

          {usedOcr && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              Al menos un documento se leyó con OCR. Verifica la línea de captura y los importes detectados.
            </p>
          )}

          {unknown.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              No se pudo identificar si es acuse o comprobante bancario: {unknown.join(", ")}.
            </p>
          )}

          {!multiDecl && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <DocCard tipo="acuse" doc={acuse} />
                <DocCard tipo="banco" doc={banco} />
              </div>

              <CrossPanel acuse={acuse} banco={banco} mes={mes} evalResult={evalResult} />
            </>
          )}
        </>
      )}
    </div>
  )
}

const STATUS_TEXT: Record<MatchStatus, { label: string; cls: string }> = {
  OK: { label: "Cumple", cls: "text-success" },
  REVISAR: { label: "Revisar", cls: "text-warning" },
  NO_OK: { label: "No cumple", cls: "text-danger" },
}

function DeclaracionesPanel({ conc }: { conc: SatConciliacion }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-5">
      <h3 className="text-sm font-semibold text-foreground">Declaraciones y su pago</h3>
      <ul className="flex flex-col divide-y divide-border">
        {conc.evals.map((e, i) => {
          const d = e.declaracion
          const s = STATUS_TEXT[e.status]
          return (
            <li key={d.numeroOperacion ?? i} className="flex flex-col gap-1 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-pretty text-sm font-medium text-foreground">{conceptoLabel(d)}</p>
                <span className={cn("shrink-0 text-xs font-medium", s.cls)}>{s.label}</span>
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <div className="flex gap-1">
                  <dt>Periodo:</dt>
                  <dd className="text-foreground">{formatMonth(d.mes)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>A pagar:</dt>
                  <dd className="text-foreground">{formatMoney(d.importe)}</dd>
                </div>
                {e.pago && (
                  <div className="flex gap-1">
                    <dt>Pagado:</dt>
                    <dd className="text-foreground">{formatMoney(e.pago.importe)}</dd>
                  </div>
                )}
                {d.lineaCaptura && (
                  <div className="flex gap-1">
                    <dt>Línea:</dt>
                    <dd className="break-all font-mono text-foreground">{d.lineaCaptura}</dd>
                  </div>
                )}
              </dl>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{e.detalle}</p>
            </li>
          )
        })}
        {conc.pagosSinDeclaracion.map((p, i) => (
          <li key={`p-${i}`} className="flex flex-col gap-1 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Comprobante sin declaración</p>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Informativo</span>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {p.archivo} · Línea {p.lineaCaptura ?? "—"} · {formatMoney(p.importe)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OverallBanner({ status, detalle }: { status: MatchStatus | null; detalle: string }) {
  const map = {
    OK: {
      cls: "border-success/30 bg-success/10 text-success",
      icon: <CheckIcon width={18} height={18} strokeWidth={2.25} />,
      title: "Pago conciliado",
    },
    REVISAR: {
      cls: "border-warning/30 bg-warning/10 text-warning",
      icon: <AlertIcon width={18} height={18} />,
      title: "Requiere revisión",
    },
    NO_OK: {
      cls: "border-danger/30 bg-danger/10 text-danger",
      icon: <XIcon width={18} height={18} />,
      title: "No concilia",
    },
  } as const
  const s = status ?? "REVISAR"
  const v = map[s]
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-5 py-4", v.cls)}>
      <span className="mt-0.5 shrink-0">{v.icon}</span>
      <div>
        <p className="font-semibold">{v.title}</p>
        <p className="text-sm opacity-90">{detalle}</p>
      </div>
    </div>
  )
}

function DocCard({ tipo, doc }: { tipo: SatDocTipo; doc: SatDocAnalysis | undefined }) {
  const meta = DOC_META[tipo]
  const Icon = meta.icon
  const faltante = !doc

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
        {faltante ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <FileTextIcon width={12} height={12} />
            Sin cargar
          </span>
        ) : (
          <span className="max-w-[55%] truncate text-xs text-muted-foreground" title={doc.archivo}>
            {doc.archivo}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
        <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Línea de captura</dt>
          <dd className="font-mono text-xs font-medium text-foreground">{doc?.lineaCaptura ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Importe</dt>
          <dd className="font-medium text-foreground">{formatMoney(doc?.importe ?? null)}</dd>
        </div>
        {tipo === "acuse" && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Período</dt>
            <dd className="font-medium text-foreground">{formatMonth(doc?.mes ?? null)}</dd>
          </div>
        )}
        {doc?.rfc && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">RFC</dt>
            <dd className="font-mono text-xs font-medium text-foreground">{doc.rfc}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function CrossPanel({
  acuse,
  banco,
  mes,
  evalResult,
}: {
  acuse: SatDocAnalysis | undefined
  banco: SatDocAnalysis | undefined
  mes: string
  evalResult: ReturnType<typeof evaluatePagoSat>
}) {
  if (!acuse || !banco) return null
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-5">
      <h3 className="text-sm font-semibold text-foreground">Cruce de validación</h3>
      <div className="flex flex-col divide-y divide-border">
        <CheckRow
          label="Línea de captura"
          match={evalResult.lineaMatch}
          acuseVal={acuse.lineaCaptura ?? "—"}
          bancoVal={banco.lineaCaptura ?? "—"}
          mono
        />
        <CheckRow
          label="Importe"
          match={evalResult.importeMatch}
          acuseVal={formatMoney(acuse.importe)}
          bancoVal={formatMoney(banco.importe)}
        />
        <CheckRow
          label="Mes de la declaración"
          match={evalResult.mesMatch}
          acuseVal={formatMonth(acuse.mes)}
          bancoVal={formatMonth(mes)}
          bancoLabel="Mes revisado"
        />
      </div>
    </div>
  )
}

function CheckRow({
  label,
  match,
  acuseVal,
  bancoVal,
  bancoLabel = "Banco",
  mono = false,
}: {
  label: string
  match: boolean | null
  acuseVal: string
  bancoVal: string
  bancoLabel?: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="shrink-0">
        {match === true ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckIcon width={13} height={13} strokeWidth={2.5} />
          </span>
        ) : match === false ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-danger/15 text-danger">
            <XIcon width={13} height={13} />
          </span>
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <AlertIcon width={13} height={13} />
          </span>
        )}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <div className="mt-0.5 flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            Acuse: <span className={cn("text-foreground", mono && "font-mono")}>{acuseVal}</span>
          </span>
          <span>
            {bancoLabel}: <span className={cn("text-foreground", mono && "font-mono")}>{bancoVal}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
