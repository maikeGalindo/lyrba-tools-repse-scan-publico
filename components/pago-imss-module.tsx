"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { extractPdfText } from "@/lib/pdf-extractor"
import { formatMonth } from "@/lib/constancias"
import type { LoadedDoc } from "@/lib/expediente-loader"
import {
  analyzeImssDoc,
  evaluatePagoImss,
  formatMoney,
  pairImssDocs,
  rollupImssStatus,
  type ImssDocAnalysis,
  type ImssDocTipo,
  type ImssPair,
} from "@/lib/pago-imss"
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

const DOC_META: Record<ImssDocTipo, { label: string; subtitle: string; icon: typeof ReceiptIcon }> = {
  sipare: {
    label: "Cédula SIPARE · IMSS",
    subtitle: "Propuesta de cuotas obrero-patronales (SUA)",
    icon: FileTextIcon,
  },
  banco: {
    label: "Comprobante de pago",
    subtitle: "Recibo bancario del pago SIPARE / IMSS",
    icon: LandmarkIcon,
  },
}

const LINK_LABEL: Record<string, string> = {
  linea: "línea de captura",
  folio: "folio SUA",
  registro: "registro patronal",
}

export function PagoImssModule({ mes, injected }: { mes: string; injected?: LoadedDoc[] | null }) {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState("")
  const [localDocs, setLocalDocs] = useState<ImssDocAnalysis[]>([])
  const [errorMsg, setErrorMsg] = useState("")
  const [localUnknown, setLocalUnknown] = useState<string[]>([])

  const fromZip = Boolean(injected && injected.length)

  const injectedDocs = useMemo(
    () => (fromZip ? injected!.map((d) => analyzeImssDoc(d.text, d.name, d.usedOcr)) : null),
    [injected, fromZip],
  )

  const docs = injectedDocs ?? localDocs
  const unknown = injectedDocs ? injectedDocs.filter((d) => !d.tipo).map((d) => d.archivo) : localUnknown
  const effectivePhase: Phase = fromZip ? "done" : phase

  const canRun = files.length > 0 && phase !== "processing"

  const pairs = useMemo(() => pairImssDocs(docs), [docs])
  const evals = useMemo(() => pairs.map((p) => evaluatePagoImss(p.sipare, p.banco, mes)), [pairs, mes])
  const overallStatus = useMemo(() => rollupImssStatus(evals.map((e) => e.status)), [evals])
  const overallDetalle = useMemo(() => {
    if (pairs.length === 0) return "Carga la cédula SIPARE y el comprobante bancario."
    if (pairs.length === 1) return evals[0].detalle
    const ok = evals.filter((e) => e.status === "OK").length
    const noOk = evals.filter((e) => e.status === "NO_OK").length
    const rev = pairs.length - ok - noOk
    const partes = [`${pairs.length} registros patronales`]
    if (ok) partes.push(`${ok} conciliados`)
    if (rev) partes.push(`${rev} por revisar`)
    if (noOk) partes.push(`${noOk} no concilian`)
    return partes.join(" · ") + "."
  }, [pairs, evals])
  const usedOcr = docs.some((d) => d.usedOcr)

  async function handleProcess() {
    setPhase("processing")
    setErrorMsg("")
    setLocalUnknown([])
    try {
      const out: ImssDocAnalysis[] = []
      const noIdent: string[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`Leyendo ${f.name} (${i + 1}/${files.length})…`)
        const res = await extractPdfText(f, (m) => setProgress(`${f.name}: ${m}`))
        const analysis = analyzeImssDoc(res.text, f.name, res.usedOcr)
        if (!analysis.tipo) noIdent.push(f.name)
        out.push(analysis)
      }
      setLocalDocs(out)
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
              <h2 className="text-sm font-semibold text-foreground">Pago de cuotas IMSS</h2>
              <span className="text-xs text-muted-foreground">2 archivos .pdf</span>
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Carga la <strong className="font-medium text-foreground">cédula SIPARE</strong> (propuesta de cuotas) y su{" "}
            <strong className="font-medium text-foreground">comprobante de pago bancario</strong>. Se validan en
            cascada: primero la <strong className="font-medium text-foreground">línea de captura</strong>; si el banco
            no la trae, el <strong className="font-medium text-foreground">folio SUA</strong> o el registro patronal.
            Además se corrobora el importe (tolerancia ±1%) y que el pago corresponda a {formatMonth(mes)}.
          </p>
          <div className="mt-4">
            <FileDrop
              title="Arrastra la cédula SIPARE y el comprobante bancario"
              hint="Cada PDF se clasifica solo por su contenido; el OCR se activa si el documento está escaneado"
              accept=".pdf"
              multiple
              icon={<LandmarkIcon width={22} height={22} />}
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
              <LandmarkIcon width={18} height={18} />
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
          <OverallBanner status={overallStatus} detalle={overallDetalle} />

          {usedOcr && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              Al menos un documento se leyó con OCR. Verifica la línea de captura y los importes detectados.
            </p>
          )}

          {unknown.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <AlertIcon width={16} height={16} />
              No se pudo identificar si es cédula SIPARE o comprobante bancario: {unknown.join(", ")}.
            </p>
          )}

          {pairs.map((p, i) => (
            <PairBlock
              key={`${p.registro ?? "pair"}-${i}`}
              pair={p}
              index={pairs.length > 1 ? i + 1 : null}
              multi={pairs.length > 1}
              mes={mes}
              evalResult={evals[i]}
            />
          ))}
        </>
      )}
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

function DocCard({ tipo, doc }: { tipo: ImssDocTipo; doc: ImssDocAnalysis | undefined }) {
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
        <div className="flex items-start justify-between gap-2">
          <dt className="shrink-0 text-muted-foreground">Línea de captura</dt>
          <dd className="break-all text-right font-mono text-xs font-medium text-foreground">
            {doc?.lineaCaptura ?? "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Folio SUA</dt>
          <dd className="font-mono text-xs font-medium text-foreground">{doc?.folioSua ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Registro patronal</dt>
          <dd className="font-mono text-xs font-medium text-foreground">{doc?.registroPatronal ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Importe</dt>
          <dd className="font-medium text-foreground">{formatMoney(doc?.importe ?? null)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Período</dt>
          <dd className="font-medium text-foreground">{formatMonth(doc?.periodo ?? null)}</dd>
        </div>
      </dl>
    </div>
  )
}

const PAIR_STATUS: Record<MatchStatus, { cls: string; label: string; icon: React.ReactNode }> = {
  OK: {
    cls: "border-success/30 bg-success/10 text-success",
    label: "Conciliado",
    icon: <CheckIcon width={12} height={12} strokeWidth={2.5} />,
  },
  REVISAR: {
    cls: "border-warning/30 bg-warning/10 text-warning",
    label: "Revisar",
    icon: <AlertIcon width={12} height={12} />,
  },
  NO_OK: {
    cls: "border-danger/30 bg-danger/10 text-danger",
    label: "No concilia",
    icon: <XIcon width={12} height={12} />,
  },
}

function StatusPill({ status }: { status: MatchStatus | null }) {
  const v = PAIR_STATUS[status ?? "REVISAR"]
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", v.cls)}>
      {v.icon}
      {v.label}
    </span>
  )
}

function PairBlock({
  pair,
  index,
  multi,
  mes,
  evalResult,
}: {
  pair: ImssPair
  index: number | null
  multi: boolean
  mes: string
  evalResult: ReturnType<typeof evaluatePagoImss>
}) {
  const { sipare, banco } = pair
  return (
    <div className={cn("flex flex-col gap-4", multi && "rounded-2xl border border-border bg-card/30 p-4 sm:p-5")}>
      {index != null && (
        <div className="flex items-center gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
            {index}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
            <h3 className="truncate font-mono text-sm font-semibold text-foreground" title={pair.registro ?? undefined}>
              {pair.registro ?? "Registro sin identificar"}
            </h3>
            <StatusPill status={evalResult.status} />
          </div>
        </div>
      )}
      {multi && <p className="text-sm leading-relaxed text-muted-foreground">{evalResult.detalle}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <DocCard tipo="sipare" doc={sipare} />
        <DocCard tipo="banco" doc={banco} />
      </div>
      <CrossPanel sipare={sipare} banco={banco} mes={mes} evalResult={evalResult} />
    </div>
  )
}

function CrossPanel({
  sipare,
  banco,
  mes,
  evalResult,
}: {
  sipare: ImssDocAnalysis | undefined
  banco: ImssDocAnalysis | undefined
  mes: string
  evalResult: ReturnType<typeof evaluatePagoImss>
}) {
  if (!sipare || !banco) return null
  const anclaLabel = evalResult.linkVia ? LINK_LABEL[evalResult.linkVia] : "vínculo"

  // El vínculo se muestra según el ancla resuelta en la cascada.
  const vinculoMatch =
    evalResult.linkVia === "linea"
      ? evalResult.lineaMatch
      : evalResult.linkVia === "folio"
        ? evalResult.folioMatch
        : evalResult.linkVia === "registro"
          ? evalResult.registroMatch
          : null

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-5">
      <h3 className="text-sm font-semibold text-foreground">Cruce de validación</h3>
      <div className="flex flex-col divide-y divide-border">
        <CheckRow
          label={`Vínculo · ${anclaLabel}`}
          match={vinculoMatch}
          sipareVal={
            evalResult.linkVia === "folio"
              ? (sipare.folioSua ?? "—")
              : evalResult.linkVia === "registro"
                ? (sipare.registroPatronal ?? "—")
                : (sipare.lineaCaptura ?? "—")
          }
          bancoVal={
            evalResult.linkVia === "folio"
              ? (banco.folioSua ?? "—")
              : evalResult.linkVia === "registro"
                ? (banco.registroPatronal ?? "—")
                : (banco.lineaCaptura ?? "—")
          }
          mono
        />
        <CheckRow
          label="Importe"
          match={evalResult.importeMatch}
          sipareVal={formatMoney(sipare.importe)}
          bancoVal={formatMoney(banco.importe)}
        />
        <CheckRow
          label="Período del pago"
          match={evalResult.mesMatch}
          sipareVal={formatMonth(sipare.periodo ?? banco.periodo)}
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
  sipareVal,
  bancoVal,
  bancoLabel = "Banco",
  mono = false,
}: {
  label: string
  match: boolean | null
  sipareVal: string
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
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <div className="mt-0.5 flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
          <span className="min-w-0 break-all">
            SIPARE: <span className={cn("text-foreground", mono && "font-mono")}>{sipareVal}</span>
          </span>
          <span className="min-w-0 break-all">
            {bancoLabel}: <span className={cn("text-foreground", mono && "font-mono")}>{bancoVal}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
