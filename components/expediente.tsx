"use client"

import { useMemo, useState, type ComponentType, type SVGProps } from "react"
import { cn } from "@/lib/utils"
import type { ContribuyenteIdentity } from "@/lib/types"
import { loadExpediente, type ExpedienteBundle, type LoadedDoc } from "@/lib/expediente-loader"
import { buildExpedienteReport } from "@/lib/report"
import { Button } from "@/components/ui/button"
import { RepseVerification, type RepseManual } from "./repse-verification"
import { InformeConsolidado } from "./informe-consolidado"
import { Conciliador } from "./conciliador"
import { ConstanciasModule } from "./constancias-module"
import { PagoSatModule } from "./pago-sat-module"
import { PagoImssModule } from "./pago-imss-module"
import { FileDrop } from "./file-drop"
import {
  AlertIcon,
  ArchiveIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  LandmarkIcon,
  LayersIcon,
  LockIcon,
  ReceiptIcon,
  ShieldIcon,
  SpinnerIcon,
  XIcon,
} from "./icons"

type Icon = ComponentType<SVGProps<SVGSVGElement>>
type ModuleStatus = "activo" | "proximamente"

interface ModuleMeta {
  id: string
  n: number
  title: string
  subtitle: string
  desc: string
  icon: Icon
  status: ModuleStatus
}

const MODULES: ModuleMeta[] = [
  {
    id: "nomina",
    n: 1,
    title: "Nómina",
    subtitle: "CFDI de nómina ↔ Cédula IMSS",
    desc: "Cruce de CURP y días cotizados entre los respaldos de nómina y la cédula de cuotas obrero-patronales.",
    icon: LayersIcon,
    status: "activo",
  },
  {
    id: "sat",
    n: 2,
    title: "Pago de impuestos",
    subtitle: "Acuse SAT ↔ Comprobante bancario",
    desc: "Coincidencia de línea de captura e importe entre el acuse de la declaración y el pago del banco.",
    icon: ReceiptIcon,
    status: "activo",
  },
  {
    id: "imss",
    n: 3,
    title: "Pago IMSS",
    subtitle: "SIPARE ↔ Comprobante bancario",
    desc: "Línea de captura o folio SUA, registro patronal e importe entre el SIPARE y el pago del banco.",
    icon: LandmarkIcon,
    status: "activo",
  },
  {
    id: "constancias",
    n: 4,
    title: "Constancias de cumplimiento",
    subtitle: "32-D · IMSS · INFONAVIT",
    desc: "Sentido positivo y fecha de expedición dentro del mes revisado para las tres opiniones.",
    icon: ClipboardCheckIcon,
    status: "activo",
  },
]

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
]

function mesLabel(mes: string) {
  const [y, m] = mes.split("-")
  const idx = Number(m) - 1
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return "—"
  const nombre = MESES[idx]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`
}

/**
 * Un proveedor con varios registros patronales sube varias cédulas IMSS de
 * nómina. Se combinan en un solo documento (su texto concatenado) para que el
 * conciliador vea el universo completo de trabajadores; el parser extrae a cada
 * trabajador por sus líneas ancla, sin importar de cuál cédula provenga.
 */
function mergeCedulas(cedulas: LoadedDoc[]): LoadedDoc | null {
  if (cedulas.length === 0) return null
  if (cedulas.length === 1) return cedulas[0]
  return {
    name: `${cedulas.length} cédulas IMSS`,
    text: cedulas.map((c) => c.text).join("\n\n"),
    usedOcr: cedulas.some((c) => c.usedOcr),
  }
}

export function Expediente() {
  const now = new Date()
  const [mes, setMes] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)
  const [active, setActive] = useState<string | null>(null)
  const [identity, setIdentity] = useState<ContribuyenteIdentity | null>(null)
  const [bundle, setBundle] = useState<ExpedienteBundle | null>(null)
  const [repseManual, setRepseManual] = useState<RepseManual>("vigente")
  const [archivos, setArchivos] = useState<File[]>([])

  function handleBundle(b: ExpedienteBundle | null, files: File[] = []) {
    setBundle(b)
    setArchivos(b ? files : [])
  }

  const activeMeta = MODULES.find((m) => m.id === active) ?? null
  const disponibles = MODULES.filter((m) => m.status === "activo").length

  // Con el ZIP maestro la identidad proviene del propio bundle; en la carga
  // manual la aporta el módulo de nómina vía onIdentity.
  const effectiveIdentity = bundle ? bundle.identity : identity

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
      <BrandHeader />
      {activeMeta ? (
        <ModuleView
          meta={activeMeta}
          mes={mes}
          bundle={bundle}
          onBack={() => setActive(null)}
          onIdentity={setIdentity}
        />
      ) : (
        <Overview
          mes={mes}
          setMes={setMes}
          disponibles={disponibles}
          onOpen={setActive}
          identity={effectiveIdentity}
          bundle={bundle}
          onBundle={handleBundle}
          repseManual={repseManual}
          onRepseManual={setRepseManual}
          archivos={archivos}
        />
      )}
    </div>
  )
}

const MESES_SELECTOR = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]

// Dos listas en vez de <input type="month">: Safari y Firefox lo muestran como
// texto libre y el valor podía no quedar como "AAAA-MM".
function MesSelector({ mes, setMes }: { mes: string; setMes: (v: string) => void }) {
  const [anio, mm] = mes.split("-")
  const actual = new Date().getFullYear()
  const anios = Array.from({ length: 6 }, (_, i) => String(actual - 4 + i))
  if (anio && !anios.includes(anio)) anios.unshift(anio)
  const selectClass = "cursor-pointer bg-transparent font-medium text-foreground outline-none"
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={mm}
        onChange={(e) => setMes(`${anio}-${e.target.value}`)}
        className={selectClass}
        aria-label="Mes en revisión"
      >
        {MESES_SELECTOR.map((nombre, i) => {
          const v = String(i + 1).padStart(2, "0")
          return (
            <option key={v} value={v}>
              {nombre}
            </option>
          )
        })}
      </select>
      <select
        value={anio}
        onChange={(e) => setMes(`${e.target.value}-${mm}`)}
        className={selectClass}
        aria-label="Año en revisión"
      >
        {anios.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </span>
  )
}

function BrandHeader() {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ShieldIcon width={22} height={22} />
        </span>
        <div>
          <h1 className="text-balance text-xl font-semibold text-foreground sm:text-2xl">
            Expediente REPSE
          </h1>
          <p className="text-sm text-muted-foreground">
            Validación documental de cumplimiento: nómina, pagos e opiniones fiscales.
          </p>
        </div>
      </div>
      <p className="flex items-center gap-2 self-start rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
        <CheckIcon width={14} height={14} strokeWidth={2.25} />
        Procesamiento 100% local · tus archivos nunca salen del navegador
      </p>
    </header>
  )
}

function Overview({
  mes,
  setMes,
  disponibles,
  onOpen,
  identity,
  bundle,
  onBundle,
  repseManual,
  onRepseManual,
  archivos,
}: {
  mes: string
  setMes: (v: string) => void
  disponibles: number
  onOpen: (id: string) => void
  identity: ContribuyenteIdentity | null
  bundle: ExpedienteBundle | null
  onBundle: (b: ExpedienteBundle | null, files?: File[]) => void
  repseManual: RepseManual
  onRepseManual: (m: RepseManual) => void
  archivos: File[]
}) {
  const report = useMemo(() => (bundle ? buildExpedienteReport(bundle, mes) : null), [bundle, mes])
  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Expediente en revisión
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground">{mesLabel(mes)}</p>
        </div>
        <label className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-background px-3 py-2 text-sm">
          <CalendarIcon width={18} height={18} className="text-muted-foreground" />
          <span className="text-muted-foreground">Mes:</span>
          <MesSelector mes={mes} setMes={setMes} />
        </label>
      </section>

      <MasterZipLoader bundle={bundle} onBundle={onBundle} />

      {report ? <InformeConsolidado report={report} repseManual={repseManual} archivos={archivos} /> : null}

      <RepseVerification identity={identity} manual={repseManual} onManual={onRepseManual} />

      <ConsistencyBar identity={identity} />

      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {report ? "Abrir módulos para revisar a fondo" : "Validaciones del expediente"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {disponibles} de {MODULES.length} disponibles
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {MODULES.map((m) => (
            <ModuleCard key={m.id} meta={m} onOpen={onOpen} count={bundleCount(bundle, m.id)} />
          ))}
        </div>
      </div>
    </>
  )
}

/** Cuántos documentos del ZIP maestro se enrutaron a cada módulo. */
function bundleCount(bundle: ExpedienteBundle | null, moduleId: string): number | null {
  if (!bundle) return null
  switch (moduleId) {
    case "nomina":
      return bundle.cfdis.length + bundle.cedulaNomina.length
    case "sat":
      return bundle.sat.length
    case "imss":
      return bundle.imss.length
    case "constancias":
      return bundle.constancias.length
    default:
      return null
  }
}

type ZipPhase = "idle" | "loading" | "done" | "error"

function MasterZipLoader({
  bundle,
  onBundle,
}: {
  bundle: ExpedienteBundle | null
  onBundle: (b: ExpedienteBundle | null, files?: File[]) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<ZipPhase>("idle")
  const [progress, setProgress] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

  const canRun = files.length > 0 && phase !== "loading"

  async function handleLoad() {
    setPhase("loading")
    setErrorMsg("")
    try {
      const result = await loadExpediente(files, setProgress)
      if (result.pdfCount === 0 && result.cfdis.length === 0) {
        throw new Error("El archivo no contiene PDF ni XML reconocibles.")
      }
      onBundle(result, files)
      setPhase("done")
      setProgress("")
    } catch (e) {
      setErrorMsg((e as Error).message)
      setPhase("error")
      setProgress("")
    }
  }

  function clear() {
    setFiles([])
    setErrorMsg("")
    setProgress("")
    setPhase("idle")
    onBundle(null)
  }

  if (bundle) {
    return <BundleSummary bundle={bundle} onClear={clear} />
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ArchiveIcon width={22} height={22} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Cargar expediente completo (.zip)</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Sube un solo ZIP con toda la documentación; cada archivo se clasifica por su contenido y
            se reparte a su módulo. La estructura interna no importa (subcarpetas, ZIP anidado o
            archivos sueltos). Todo se procesa en tu navegador.
          </p>
        </div>
      </div>

      <FileDrop
        title="Arrastra el ZIP del expediente"
        hint="Acepta .zip con PDF y XML mezclados; el orden y las carpetas dan igual"
        accept=".zip"
        icon={<ArchiveIcon width={22} height={22} />}
        files={files}
        onFiles={setFiles}
        disabled={phase === "loading"}
      />

      {errorMsg && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <XIcon width={16} height={16} />
          {errorMsg}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={handleLoad} disabled={!canRun} size="lg" className="gap-2">
          {phase === "loading" ? (
            <SpinnerIcon width={18} height={18} className="animate-spin" />
          ) : (
            <ArchiveIcon width={18} height={18} />
          )}
          {phase === "loading" ? "Clasificando…" : "Clasificar y repartir"}
        </Button>
        {phase === "loading" && progress && (
          <span className="truncate text-sm text-muted-foreground">{progress}</span>
        )}
      </div>
    </section>
  )
}

function BundleSummary({ bundle, onClear }: { bundle: ExpedienteBundle; onClear: () => void }) {
  const rows = [
    { label: "CFDI de nómina", value: bundle.cfdis.length, hint: "XML" },
    { label: "Cédula IMSS (nómina)", value: bundle.cedulaNomina.length, hint: "PDF" },
    { label: "Pago SAT", value: bundle.sat.length, hint: "PDF" },
    { label: "Pago IMSS", value: bundle.imss.length, hint: "PDF" },
    { label: "REPSE", value: bundle.repse.length, hint: "PDF" },
    { label: "ICSOE", value: bundle.icsoe.length, hint: "PDF" },
    { label: "SISUB", value: bundle.sisub.length, hint: "PDF" },
    { label: "Constancias", value: bundle.constancias.length, hint: "PDF" },
  ]

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ArchiveIcon width={22} height={22} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Expediente ZIP clasificado</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {bundle.pdfCount} PDF y {bundle.cfdis.length} XML repartidos por contenido. Abre cada
              validación para ver el resultado.
            </p>
          </div>
        </div>
        <Button onClick={onClear} variant="outline" size="sm">
          Quitar ZIP
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "flex flex-col gap-0.5 rounded-xl border bg-card/60 px-3 py-3",
              r.value > 0 ? "border-border" : "border-dashed border-border opacity-60",
            )}
          >
            <span className="text-xs text-muted-foreground">{r.label}</span>
            <span className="font-mono text-xl font-semibold text-foreground">{r.value}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.hint}</span>
          </div>
        ))}
      </div>

      {bundle.cfdiPdfs.length > 0 && <CfdiPdfCotejo items={bundle.cfdiPdfs} />}

      {bundle.unknown.length > 0 && (
        <details className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <AlertIcon width={16} height={16} />
            {bundle.unknown.length} documento(s) sin clasificar
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-foreground/70">
            {bundle.unknown.map((n, i) => (
              <li key={i} className="font-mono">
                {n}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-foreground/70">
            No coinciden con ningún módulo. Revísalos y, si aplica, cárgalos manualmente en el módulo
            correcto.
          </p>
        </details>
      )}
    </section>
  )
}

function CfdiPdfCotejo({ items }: { items: ExpedienteBundle["cfdiPdfs"] }) {
  const conXml = items.filter((i) => i.xml).length
  const sinXml = items.filter((i) => !i.xml)
  const completo = sinXml.length === 0

  return (
    <details className="rounded-lg border border-border bg-card/60 px-4 py-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
        <span>PDF de recibos de nómina</span>
        <span className={cn("font-mono", completo ? "text-success" : "text-warning")}>
          {conXml}/{items.length} corresponden a su XML
        </span>
      </summary>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Se cotejan por folio fiscal (UUID) contra los XML cargados. Son informativos: no afectan el dictamen.
      </p>
      {sinXml.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-warning">Sin XML que les corresponda:</span>
          <ul className="flex flex-col gap-1 text-xs text-foreground/70">
            {sinXml.map((i) => (
              <li key={i.name} className="break-all font-mono">
                {i.name}
                {i.uuid ? ` · ${i.uuid}` : " · sin folio fiscal legible"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  )
}

function ConsistencyBar({ identity }: { identity: ContribuyenteIdentity | null }) {
  const hasData = Boolean(identity && (identity.rfc || identity.razonSocial))
  const rfc = identity?.rfc || "—"
  const razon = identity?.razonSocial || "—"

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            hasData ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <BuildingIcon width={22} height={22} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Consistencia del contribuyente
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            RFC y razón social compartidos por todo el expediente
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:justify-end">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">RFC</span>
          <span className="font-mono text-sm font-medium text-foreground">{rfc}</span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">Razón social</span>
          <span className="max-w-[16rem] truncate text-sm font-medium text-foreground">{razon}</span>
        </div>
        {hasData ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <CheckIcon width={12} height={12} strokeWidth={2.5} />
            Detectado
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <LockIcon width={12} height={12} />
            Pendiente
          </span>
        )}
      </div>
    </section>
  )
}

function ModuleCard({
  meta,
  onOpen,
  count,
}: {
  meta: ModuleMeta
  onOpen: (id: string) => void
  count: number | null
}) {
  const Icon = meta.icon
  const activo = meta.status === "activo"
  const fromZip = count != null

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            activo ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon width={22} height={22} />
        </span>
        <StatusChip status={meta.status} />
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-muted-foreground">Validación {meta.n}</p>
        <h3 className="text-base font-semibold text-foreground">{meta.title}</h3>
        <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{meta.desc}</p>
      {fromZip && (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
            count > 0
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-warning/30 bg-warning/10 text-warning",
          )}
        >
          <ArchiveIcon width={12} height={12} />
          {count > 0
            ? `${count} documento(s) del ZIP`
            : "Sin documentos en el ZIP"}
        </span>
      )}
    </>
  )

  if (!activo) {
    return (
      <div className="flex cursor-default flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-5 opacity-75">
        {inner}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(meta.id)}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-5 text-left transition-colors hover:border-primary/50 hover:bg-card"
    >
      {inner}
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
        Abrir validación
        <ChevronRightIcon
          width={16}
          height={16}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </button>
  )
}

function StatusChip({ status }: { status: ModuleStatus }) {
  if (status === "activo") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
        <CheckIcon width={12} height={12} strokeWidth={2.5} />
        Disponible
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <LockIcon width={12} height={12} />
      Próximamente
    </span>
  )
}

function ModuleView({
  meta,
  mes,
  bundle,
  onBack,
  onIdentity,
}: {
  meta: ModuleMeta
  mes: string
  bundle: ExpedienteBundle | null
  onBack: () => void
  onIdentity: (id: ContribuyenteIdentity | null) => void
}) {
  const Icon = meta.icon
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon width={16} height={16} />
          Volver al expediente
        </button>
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon width={22} height={22} />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Validación {meta.n} · {mesLabel(mes)}
            </p>
            <h2 className="text-lg font-semibold text-foreground">{meta.title}</h2>
            <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
          </div>
        </div>
      </div>
      {meta.id === "nomina" ? (
        <Conciliador
          onIdentity={onIdentity}
          injected={bundle ? { cfdis: bundle.cfdis, cedula: mergeCedulas(bundle.cedulaNomina) } : null}
        />
      ) : meta.id === "constancias" ? (
        <ConstanciasModule mes={mes} injected={bundle?.constancias ?? null} />
      ) : meta.id === "sat" ? (
        <PagoSatModule mes={mes} injected={bundle?.sat ?? null} />
      ) : meta.id === "imss" ? (
        <PagoImssModule mes={mes} injected={bundle?.imss ?? null} />
      ) : (
        <ComingSoon meta={meta} />
      )}
    </div>
  )
}

function ComingSoon({ meta }: { meta: ModuleMeta }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <LockIcon width={24} height={24} />
      </span>
      <h3 className="text-base font-semibold text-foreground">Módulo en construcción</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{meta.desc}</p>
      <p className="text-xs text-muted-foreground">
        Se activará en las próximas fases del expediente.
      </p>
    </div>
  )
}
