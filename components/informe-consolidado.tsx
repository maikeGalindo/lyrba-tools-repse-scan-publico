"use client"

import { useState } from "react"
import { upload } from "@vercel/blob/client"
import { BLOB_PREFIX, MAX_ZIP_BYTES } from "@/lib/blob-temporal"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MatchStatus } from "@/lib/types"
import type { ExpedienteReport, ReportModule } from "@/lib/report"
import { buildInformeCsv } from "@/lib/report"
import type { RepseManual } from "./repse-verification"
import { AlertIcon, CheckIcon, DownloadIcon, FileTextIcon, MailIcon, XIcon } from "./icons"

const CORREO_REPSE = "repse@lyrba.com.mx"
const MAILTO_BODY_MAX = 1800
// Vercel limita el cuerpo de cada solicitud a ~4.5 MB; dejamos margen para el CSV y los campos.
const LIMITE_ENVIO_BYTES = 4 * 1024 * 1024

type EnvioEstado =
  | { tipo: "idle" }
  | { tipo: "enviando" }
  | { tipo: "enviado"; zipAdjunto: boolean; zipOmitidoMb: number | null }
  | { tipo: "error"; mensaje: string }

type ResumenItem = {
  id: string
  title: string
  status: MatchStatus | null
  headline: string
  hallazgos: string[]
}

type Resumen = {
  noCumple: ResumenItem[]
  revisar: ResumenItem[]
  cumple: ResumenItem[]
}

const STATUS_META: Record<MatchStatus, { label: string; chip: string; dot: string; icon: typeof CheckIcon }> = {
  OK: {
    label: "Cumple",
    chip: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
    icon: CheckIcon,
  },
  REVISAR: {
    label: "Revisar",
    chip: "border-warning/30 bg-warning/10 text-warning",
    dot: "bg-warning",
    icon: AlertIcon,
  },
  NO_OK: {
    label: "No cumple",
    chip: "border-danger/30 bg-danger/10 text-danger",
    dot: "bg-danger",
    icon: XIcon,
  },
}

const NULL_META = {
  label: "Sin datos",
  chip: "border-border bg-muted text-muted-foreground",
  dot: "bg-muted-foreground",
  icon: AlertIcon,
}

function metaOf(status: MatchStatus | null) {
  return status ? STATUS_META[status] : NULL_META
}

const MES_NOMBRES = [
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
  const nombre = MES_NOMBRES[idx]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`
}

const REPSE_MANUAL_META: Record<RepseManual, { label: string; status: MatchStatus | null }> = {
  sin_verificar: { label: "Sin verificar", status: null },
  vigente: { label: "Registro vigente en el padrón", status: "OK" },
  no_localizado: { label: "No localizado / no vigente", status: "NO_OK" },
}

function buildResumen(report: ExpedienteReport, repse: { label: string; status: MatchStatus | null }): Resumen {
  const items: ResumenItem[] = [
    {
      id: "repse",
      title: "Padrón REPSE",
      status: repse.status,
      headline: repse.label,
      hallazgos: [],
    },
    ...report.modules.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      headline: m.headline,
      hallazgos: m.rows
        .filter((r) => r.status === "NO_OK" || r.status === "REVISAR")
        .map((r) => `${r.label}: ${r.detalle}`),
    })),
  ]
  return {
    noCumple: items.filter((i) => i.status === "NO_OK"),
    revisar: items.filter((i) => i.status === "REVISAR" || i.status === null),
    cumple: items.filter((i) => i.status === "OK"),
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

function buildCorreo(report: ExpedienteReport, repse: { label: string; status: MatchStatus | null }, conZip: boolean) {
  const razon = report.identity?.razonSocial || report.identity?.rfc || "Proveedor"
  const periodo = mesLabel(report.mes)
  const resumen = buildResumen(report, repse)
  const rfc = report.identity?.rfc || "RFC no identificado"
  const razonSocial = report.identity?.razonSocial || "Razón social no identificada"
  const subject = `Información ${periodo} – ${rfc} – ${razonSocial}`.slice(0, 200)
  const conteo = `${resumen.cumple.length} cumplen · ${resumen.revisar.length} por revisar · ${resumen.noCumple.length} no cumplen`
  const nomina = `Nómina: ${report.nomina.ok} correctos, ${report.nomina.revisar} por revisar, ${report.nomina.noOk} no cumplen (de ${report.nomina.total}).`
  const adjuntos = conZip ? "Se adjuntan el Excel del informe y el expediente .zip original." : "Se adjunta el Excel del informe."
  const todos = [...resumen.noCumple, ...resumen.revisar, ...resumen.cumple]

  const textoGrupo = (titulo: string, lista: ResumenItem[], conDetalle: boolean) =>
    lista.length === 0
      ? []
      : [
          titulo,
          ...lista.flatMap((i) => [
            `• ${i.title} — ${i.headline}`,
            ...(conDetalle ? i.hallazgos.slice(0, 6).map((h) => `    - ${h}`) : []),
          ]),
          "",
        ]

  const text = [
    `Expediente de ${razon} · ${periodo}`,
    report.identity?.rfc ? `RFC: ${report.identity.rfc}` : "",
    "",
    `DICTAMEN GENERAL: ${metaOf(report.overall).label.toUpperCase()}`,
    conteo,
    "",
    "REPORTE CONSOLIDADO DE LA VALIDACIÓN:",
    ...todos.map((i) => `• [${metaOf(i.status).label}] ${i.title} — ${i.headline}`),
    "",
    "DETALLE DE PUNTOS CON OBSERVACIONES:",
    ...textoGrupo("NO CUMPLEN (requieren atención):", resumen.noCumple, true),
    ...textoGrupo("POR REVISAR:", resumen.revisar, true),
    ...textoGrupo("CUMPLEN:", resumen.cumple, false),
    report.nomina.total > 0 ? nomina : "",
    report.unknown.length > 0 ? `Documentos sin clasificar: ${report.unknown.length} (detalle en el Excel).` : "",
    "",
    adjuntos,
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n")

  const COLOR = { NO_OK: "#b42318", REVISAR: "#b54708", OK: "#067647" } as const
  const htmlGrupo = (titulo: string, lista: ResumenItem[], color: string, conDetalle: boolean) =>
    lista.length === 0
      ? ""
      : `<h3 style="margin:20px 0 8px;font-size:14px;color:${color};text-transform:uppercase;letter-spacing:.04em">${escapeHtml(titulo)} (${lista.length})</h3>
<ul style="margin:0;padding-left:18px">${lista
          .map(
            (i) =>
              `<li style="margin:0 0 8px"><strong>${escapeHtml(i.title)}</strong> — ${escapeHtml(i.headline)}${
                conDetalle && i.hallazgos.length
                  ? `<ul style="margin:4px 0 0;padding-left:16px;color:#475467;font-size:13px">${i.hallazgos
                      .slice(0, 6)
                      .map((h) => `<li>${escapeHtml(h)}</li>`)
                      .join("")}</ul>`
                  : ""
              }</li>`,
          )
          .join("")}</ul>`

  const overallColor = report.overall ? COLOR[report.overall] : "#475467"
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#101828;font-size:14px;line-height:1.5;max-width:640px">
<p style="margin:0 0 4px;color:#475467">Expediente de <strong>${escapeHtml(razon)}</strong> · ${escapeHtml(periodo)}</p>
${report.identity?.rfc ? `<p style="margin:0 0 16px;color:#475467">RFC: ${escapeHtml(report.identity.rfc)}</p>` : ""}
<div style="border:1px solid #eaecf0;border-radius:10px;padding:14px 16px">
<p style="margin:0;font-size:12px;color:#475467;text-transform:uppercase;letter-spacing:.04em">Dictamen general</p>
<p style="margin:2px 0 6px;font-size:20px;font-weight:bold;color:${overallColor}">${escapeHtml(metaOf(report.overall).label)}</p>
<p style="margin:0;color:#475467">${escapeHtml(conteo)}</p>
</div>
<h3 style="margin:20px 0 8px;font-size:14px;color:#101828;text-transform:uppercase;letter-spacing:.04em">Reporte consolidado de la validación</h3>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px">${todos
  .map((i) => {
    const color = i.status ? COLOR[i.status] : "#475467"
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eaecf0;white-space:nowrap;font-weight:bold;color:${color}">${escapeHtml(metaOf(i.status).label)}</td><td style="padding:6px 8px;border-bottom:1px solid #eaecf0"><strong>${escapeHtml(i.title)}</strong><br><span style="color:#475467">${escapeHtml(i.headline)}</span></td></tr>`
  })
  .join("")}</table>
${htmlGrupo("No cumplen", resumen.noCumple, COLOR.NO_OK, true)}
${htmlGrupo("Por revisar", resumen.revisar, COLOR.REVISAR, true)}
${htmlGrupo("Cumplen", resumen.cumple, COLOR.OK, false)}
${report.nomina.total > 0 ? `<p style="margin:20px 0 0;color:#475467">${escapeHtml(nomina)}</p>` : ""}
${report.unknown.length > 0 ? `<p style="margin:6px 0 0;color:#475467">Documentos sin clasificar: ${report.unknown.length} (detalle en el Excel).</p>` : ""}
<p style="margin:20px 0 0;color:#475467">${escapeHtml(adjuntos)}</p>
</div>`

  return { subject, text, html }
}

function buildMailtoHref(report: ExpedienteReport, repse: { label: string; status: MatchStatus | null }) {
  const { subject, text } = buildCorreo(report, repse, false)
  const recortado =
    text.length > MAILTO_BODY_MAX ? `${text.slice(0, MAILTO_BODY_MAX)}…\n\n(Ver detalle completo en el Excel.)` : text
  return `mailto:${CORREO_REPSE}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(recortado)}`
}

function bytesToMb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

function StatusChip({ status, size = "sm" }: { status: MatchStatus | null; size?: "sm" | "lg" }) {
  const m = metaOf(status)
  const Icon = m.icon
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium",
        m.chip,
        size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
      )}
    >
      <Icon width={size === "lg" ? 15 : 13} height={size === "lg" ? 15 : 13} strokeWidth={2.25} />
      {m.label}
    </span>
  )
}

export function InformeConsolidado({
  report,
  repseManual,
  archivos,
}: {
  report: ExpedienteReport
  repseManual: RepseManual
  archivos: File[]
}) {
  const repse = REPSE_MANUAL_META[repseManual]
  const resumen = buildResumen(report, repse)
  const [envio, setEnvio] = useState<EnvioEstado>({ tipo: "idle" })
  const [abiertos, setAbiertos] = useState<Set<string>>(
    () => new Set(report.modules.filter((m) => m.status !== "OK").map((m) => m.id)),
  )
  const [verDetalle, setVerDetalle] = useState(false)

  const csvFilename = `informe-expediente-${report.mes || "sin-mes"}.csv`

  function toggleModulo(id: string) {
    setAbiertos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function enviarCorreo() {
    setEnvio({ tipo: "enviando" })
    const csv = buildInformeCsv(report, repse.label)
    const csvBytes = new Blob([csv]).size
    const zipBytes = archivos.reduce((acc, f) => acc + f.size, 0)
    const zipCabe = archivos.length > 0 && csvBytes <= LIMITE_ENVIO_BYTES && zipBytes <= MAX_ZIP_BYTES
    const { subject, text, html } = buildCorreo(report, repse, zipCabe)

    const form = new FormData()
    form.set("subject", subject)
    form.set("text", text)
    form.set("html", html)
    form.set("csv", csv)
    form.set("filename", csvFilename)

    try {
      if (zipCabe) {
        for (const f of archivos) {
          const nombre = f.name.replace(/[^\w.-]+/g, "_") || "expediente.zip"
          const subido = await upload(`${BLOB_PREFIX}${nombre}`, f, {
            access: "private",
            handleUploadUrl: "/api/blob-upload",
            multipart: f.size > 5 * 1024 * 1024,
          })
          form.append("blobPath", subido.pathname)
        }
      }
      const res = await fetch("/api/enviar-informe", { method: "POST", body: form })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setEnvio({ tipo: "error", mensaje: data?.error || "No se pudo enviar el correo." })
        return
      }
      setEnvio({
        tipo: "enviado",
        zipAdjunto: zipCabe,
        zipOmitidoMb: archivos.length > 0 && !zipCabe ? bytesToMb(zipBytes) : null,
      })
    } catch {
      setEnvio({ tipo: "error", mensaje: "Sin conexión. Revisa tu internet e intenta de nuevo." })
    }
  }

  function imprimir() {
    setAbiertos(new Set(report.modules.map((m) => m.id)))
    setTimeout(() => window.print(), 50)
  }

  function exportarExcel() {
    const csv = buildInformeCsv(report, repse.label)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    // En el preview de v0 la app corre dentro de un iframe; la descarga
    // programática puede quedar bloqueada, así que abrimos en pestaña nueva.
    const inIframe = (() => {
      try {
        return window.self !== window.top
      } catch {
        return true
      }
    })()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = csvFilename
    if (inIframe) {
      const w = window.open(url, "_blank", "noopener")
      if (!w) {
        a.target = "_blank"
        a.rel = "noopener"
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    } else {
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  return (
    <div className="print-area flex flex-col gap-6">
      <ResumenCard
        report={report}
        resumen={resumen}
        envio={envio}
        onEnviar={enviarCorreo}
        onExcel={exportarExcel}
        onImprimir={imprimir}
        mailtoHref={buildMailtoHref(report, repse)}
        tieneZip={archivos.length > 0}
      />

      {verDetalle ? (
        <section className="flex flex-col gap-4" aria-labelledby="detalle-informe">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="detalle-informe" className="text-base font-semibold text-foreground">Detalle técnico</h2>
              <p className="mt-1 text-xs text-muted-foreground">Validaciones, empleados y documentos del expediente.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setVerDetalle(false)}>
              Resumen
            </Button>
          </div>

          {report.modules.map((m) => (
            <ModuleBlock key={m.id} module={m} open={abiertos.has(m.id)} onToggle={() => toggleModulo(m.id)} />
          ))}

          {report.nomina.total > 0 && <NominaDetalle report={report} />}

          {report.unknown.length > 0 && (
            <details className="print-card group rounded-xl border border-border bg-card/50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground">
                <span>{report.unknown.length} documento(s) sin clasificar</span>
                <span className="text-xs text-muted-foreground">Incluidos en el Excel</span>
              </summary>
              <ul className="flex flex-col gap-1 px-4 pb-4 text-xs text-muted-foreground">
                {report.unknown.map((n, i) => <li key={i} className="break-all font-mono">{n}</li>)}
              </ul>
            </details>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Generado el {new Date(report.generatedAt).toLocaleString("es-MX")} · Documentos: {report.docCounts.cfdis} CFDI, {report.docCounts.cedula} cédula, {report.docCounts.sat} pago SAT, {report.docCounts.imss} pago IMSS, {report.docCounts.constancias} constancias.
          </p>
        </section>
      ) : (
        <Button type="button" variant="outline" className="no-print h-11 w-full justify-between px-4" onClick={() => setVerDetalle(true)}>
          <span className="flex flex-col items-start gap-0.5">
            <span className="font-medium">Ver detalle técnico</span>
            <span className="text-xs font-normal text-muted-foreground">Empleados, validaciones y documentos</span>
          </span>
          <span aria-hidden="true">→</span>
        </Button>
      )}
    </div>
  )
}

function ResumenCard({
  report,
  resumen,
  envio,
  onEnviar,
  onExcel,
  onImprimir,
  mailtoHref,
  tieneZip,
}: {
  report: ExpedienteReport
  resumen: Resumen
  envio: EnvioEstado
  onEnviar: () => void
  onExcel: () => void
  onImprimir: () => void
  mailtoHref: string
  tieneZip: boolean
}) {
  const total = resumen.cumple.length + resumen.revisar.length + resumen.noCumple.length
  const atencion = [...resumen.noCumple, ...resumen.revisar]
  const segmentos = [
    { key: "ok", n: resumen.cumple.length, label: "cumplen", bar: "bg-success", text: "text-success" },
    { key: "rev", n: resumen.revisar.length, label: "revisar", bar: "bg-warning", text: "text-warning" },
    { key: "no", n: resumen.noCumple.length, label: "no cumplen", bar: "bg-danger", text: "text-danger" },
  ]

  return (
    <section
      className="print-card flex flex-col gap-5 rounded-2xl border border-border bg-card p-5"
      aria-labelledby="resumen-cumplimiento"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="resumen-cumplimiento" className="text-sm font-semibold text-foreground">
            Resumen de cumplimiento
          </h2>
          <span className="text-xs text-muted-foreground">{mesLabel(report.mes)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold text-foreground">
              {report.identity?.razonSocial || "Proveedor sin identificar"}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{report.identity?.rfc || "RFC —"}</span>
          </div>
          <StatusChip status={report.overall} size="lg" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div
          className="flex h-2.5 w-full gap-1 overflow-hidden rounded-full"
          role="img"
          aria-label={`${resumen.cumple.length} cumplen, ${resumen.revisar.length} por revisar, ${resumen.noCumple.length} no cumplen`}
        >
          {segmentos
            .filter((s) => s.n > 0)
            .map((s) => (
              <span key={s.key} className={cn("h-full rounded-full", s.bar)} style={{ flexGrow: s.n }} />
            ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {segmentos.map((s) => (
            <span key={s.key} className="flex items-baseline gap-1">
              <span className={cn("font-mono font-semibold", s.n > 0 ? s.text : "text-muted-foreground")}>{s.n}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </span>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">de {total} validaciones</span>
        </div>
      </div>

      {atencion.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requieren atención</h3>
          <ul className="flex flex-col gap-2">
            {atencion.map((i) => {
              const m = metaOf(i.status)
              const Icon = m.icon
              return (
                <li key={i.id} className={cn("flex items-start gap-3 rounded-xl border p-3", m.chip)}>
                  <Icon width={18} height={18} strokeWidth={2.25} className="mt-0.5 shrink-0" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold">{i.title}</span>
                    <span className="text-pretty text-sm leading-relaxed text-foreground/80">{i.headline}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-medium text-success">
          <CheckIcon width={18} height={18} strokeWidth={2.25} />
          Todas las validaciones cumplen.
        </p>
      )}

      {resumen.cumple.length > 0 && atencion.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cumplen</h3>
          <ul className="flex flex-wrap gap-2">
            {resumen.cumple.map((i) => (
              <li
                key={i.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-sm text-success"
              >
                <CheckIcon width={14} height={14} strokeWidth={2.25} />
                {i.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="no-print flex flex-col gap-3 border-t border-border pt-4">
        <Button
          onClick={onEnviar}
          className="h-11 w-full gap-2"
          disabled={envio.tipo === "enviando"}
          aria-busy={envio.tipo === "enviando"}
        >
          <MailIcon width={18} height={18} />
          {envio.tipo === "enviando" ? "Enviando…" : envio.tipo === "enviado" ? "Enviar de nuevo" : "Enviar por correo"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onExcel} variant="outline" className="h-11 gap-2">
            <DownloadIcon width={16} height={16} />
            Excel
          </Button>
          <Button onClick={onImprimir} variant="outline" className="h-11 gap-2">
            <FileTextIcon width={16} height={16} />
            PDF
          </Button>
        </div>
        <div className="text-xs leading-relaxed" role="status" aria-live="polite">
          {envio.tipo === "enviado" ? (
            <p className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-success">
                <CheckIcon width={14} height={14} strokeWidth={2.25} />
                {`Enviado a ${CORREO_REPSE} con el Excel${envio.zipAdjunto ? " y el .zip del expediente" : ""}.`}
              </span>
              {envio.zipOmitidoMb !== null && (
                <span className="text-warning">
                  {`El .zip pesa ${envio.zipOmitidoMb} MB y supera el límite de envío (25 MB), así que se envió sin él.`}
                </span>
              )}
            </p>
          ) : envio.tipo === "error" ? (
            <p className="text-danger">
              {envio.mensaje}{" "}
              <a
                href={mailtoHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                Abrir en mi app de correo
              </a>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {"Se envía a "}
              <span className="font-medium text-foreground">{CORREO_REPSE}</span>
              {tieneZip ? " con el Excel y el .zip del expediente." : " con el Excel del informe."}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function ModuleBlock({ module, open, onToggle }: { module: ReportModule; open: boolean; onToggle: () => void }) {
  const panelId = `modulo-${module.id}`
  return (
    <div className="print-card overflow-hidden rounded-xl border border-border bg-card/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-foreground">{module.title}</span>
          <span className="truncate text-xs text-muted-foreground">{module.headline}</span>
        </span>
        <StatusChip status={module.status} />
      </button>
      {open && module.rows.length > 0 && (
        <ul id={panelId} className="flex flex-col divide-y divide-border border-t border-border">
          {module.rows.map((row, i) => {
            const m = metaOf(row.status)
            return (
              <li key={i} className="flex flex-col gap-1 px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <span className={cn("size-2 shrink-0 rounded-full", m.dot)} />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className={cn("shrink-0 text-xs font-medium", statusToneClass(row.status))}>{m.label}</span>
                </div>
                <p className="pl-4 text-xs leading-relaxed text-muted-foreground">{row.detalle}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function NominaDetalle({ report }: { report: ExpedienteReport }) {
  return (
    <div className="print-card flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4">
      <h3 className="text-sm font-semibold text-foreground">Detalle de nómina</h3>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Total" value={report.nomina.total} />
        <Stat label="OK" value={report.nomina.ok} tone="success" />
        <Stat label="Revisar" value={report.nomina.revisar} tone="warning" />
        <Stat label="No OK" value={report.nomina.noOk} tone="danger" />
      </div>
      {report.nomina.diasRevisar > 0 && (
        <p className="text-xs text-muted-foreground">
          Informativo: {report.nomina.diasRevisar} empleado(s) con diferencia entre días CFDI y días IMSS.
        </p>
      )}
      {report.nomina.fueraMes > 0 && (
        <p className="text-xs text-warning">{report.nomina.fueraMes} CFDI con periodo fuera del mes en revisión.</p>
      )}
    </div>
  )
}

function statusToneClass(status: MatchStatus | null): string {
  if (status === "OK") return "text-success"
  if (status === "REVISAR") return "text-warning"
  if (status === "NO_OK") return "text-danger"
  return "text-muted-foreground"
}

function Stat({
  label,
  value,
  tone = "foreground",
}: {
  label: string
  value: number
  tone?: "foreground" | "success" | "warning" | "danger"
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-background px-2 py-2">
      <span
        className={cn(
          "font-mono text-lg font-semibold",
          tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : tone === "danger"
                ? "text-danger"
                : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
