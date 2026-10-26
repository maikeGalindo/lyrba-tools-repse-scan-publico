"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ContribuyenteIdentity, MatchStatus } from "@/lib/types"
import { AlertIcon, CheckIcon, SearchIcon, ShieldIcon, SpinnerIcon, XIcon } from "./icons"

type Outcome = "encontrado" | "no_encontrado" | "manual_requerido" | "error"

interface RepseApiResponse {
  outcome: Outcome
  reachable: boolean
  consultaUrl: string
  rfc: string | null
  razonSocial: string | null
  message: string
  registro?: {
    estatus?: string
    actividades?: string[]
    folio?: string
    vigencia?: string
  }
}

/** Registro manual del resultado que el usuario confirma en la consulta oficial. */
export type RepseManual = "sin_verificar" | "vigente" | "no_localizado"

const MANUAL_META: Record<RepseManual, { label: string; status: MatchStatus | null; cls: string }> = {
  sin_verificar: {
    label: "Sin verificar",
    status: null,
    cls: "border-border bg-muted text-muted-foreground",
  },
  vigente: {
    label: "Registro vigente en el padrón",
    status: "OK",
    cls: "border-success/30 bg-success/10 text-success",
  },
  no_localizado: {
    label: "No localizado / no vigente",
    status: "NO_OK",
    cls: "border-danger/30 bg-danger/10 text-danger",
  },
}

export function RepseVerification({
  identity,
  manual,
  onManual,
}: {
  identity: ContribuyenteIdentity | null
  manual: RepseManual
  onManual: (m: RepseManual) => void
}) {
  const [rfc, setRfc] = useState(identity?.rfc ?? "")
  const [razon, setRazon] = useState(identity?.razonSocial ?? "")
  const [loading, setLoading] = useState(false)
  const [resp, setResp] = useState<RepseApiResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState("")

  async function consultar() {
    setLoading(true)
    setErrorMsg("")
    setResp(null)
    try {
      const r = await fetch("/api/repse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfc: rfc.trim(), razonSocial: razon.trim() }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "No se pudo consultar el padrón.")
      setResp(data)
    } catch (e) {
      setErrorMsg((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function abrirConsulta() {
    const url = resp?.consultaUrl ?? "https://repse.stps.gob.mx/Publico/Consulta"
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const manualMeta = MANUAL_META[manual]

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldIcon width={22} height={22} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Verificación en el padrón REPSE</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Consulta el Registro de Prestadoras de Servicios Especializados de la STPS por RFC o razón social.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">RFC del patrón</span>
          <input
            value={rfc}
            onChange={(e) => setRfc(e.target.value.toUpperCase())}
            placeholder="AAA010101AAA"
            className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
            aria-label="RFC del patrón"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Razón social (opcional)</span>
          <input
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            placeholder="Nombre o denominación social"
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            aria-label="Razón social"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={consultar} disabled={loading || (!rfc.trim() && !razon.trim())} className="gap-2">
          {loading ? (
            <SpinnerIcon width={18} height={18} className="animate-spin" />
          ) : (
            <SearchIcon width={18} height={18} />
          )}
          {loading ? "Consultando…" : "Consultar padrón"}
        </Button>
        <Button onClick={abrirConsulta} variant="outline" className="gap-2">
          <ShieldIcon width={18} height={18} />
          Abrir consulta oficial
        </Button>
      </div>

      {errorMsg && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <XIcon width={16} height={16} />
          {errorMsg}
        </p>
      )}

      {resp && (
        <div
          className={cn(
            "flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm",
            resp.outcome === "encontrado"
              ? "border-success/30 bg-success/10 text-success"
              : resp.outcome === "no_encontrado"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-warning/30 bg-warning/10 text-warning",
          )}
        >
          <div className="flex items-start gap-2">
            <AlertIcon width={16} height={16} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {resp.outcome === "manual_requerido"
                  ? "Verificación manual requerida"
                  : resp.outcome === "encontrado"
                    ? "Registro localizado"
                    : "No localizado"}
              </p>
              <p className="opacity-90">{resp.message}</p>
              <p className="text-xs opacity-75">
                Portal {resp.reachable ? "disponible" : "no disponible"} · Consulta:{" "}
                {resp.rfc ?? resp.razonSocial ?? "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Registro del resultado confirmado en la consulta oficial (queda en el informe). */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-xs font-medium text-muted-foreground">
          Resultado verificado en la consulta oficial
        </span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MANUAL_META) as RepseManual[]).map((key) => {
            const m = MANUAL_META[key]
            const activo = manual === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => onManual(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  activo ? m.cls : "border-border bg-background text-muted-foreground hover:border-primary/40",
                )}
              >
                {key === "vigente" ? (
                  <CheckIcon width={13} height={13} strokeWidth={2.5} />
                ) : key === "no_localizado" ? (
                  <XIcon width={13} height={13} />
                ) : (
                  <AlertIcon width={13} height={13} />
                )}
                {m.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Estado actual: <span className="font-medium text-foreground">{manualMeta.label}</span>. Este dato se
          incluye en el informe impreso.
        </p>
      </div>
    </section>
  )
}
