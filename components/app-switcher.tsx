"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Expediente } from "./expediente"
import { CuotasHistoricoModule } from "./cuotas-historico-module"
import { ArchiveIcon, ShieldIcon } from "./icons"

type Mode = "expediente" | "historico"

const TABS: { id: Mode; label: string; icon: typeof ShieldIcon }[] = [
  { id: "expediente", label: "Expediente mensual", icon: ShieldIcon },
  { id: "historico", label: "Histórico de cuotas", icon: ArchiveIcon },
]

export function AppSwitcher() {
  const [mode, setMode] = useState<Mode>("expediente")

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex w-full max-w-6xl items-center gap-1 px-5 py-2 sm:px-8" aria-label="Módulos">
          {TABS.map((t) => {
            const Icon = t.icon
            const activo = mode === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  activo
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon width={16} height={16} />
                {t.label}
              </button>
            )
          })}
        </nav>
      </div>

      {mode === "expediente" ? <Expediente /> : <CuotasHistoricoModule />}

      <footer className="mt-auto border-t border-border py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-1 px-5 text-center sm:px-8">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            Powered by <span className="text-foreground">C.P. Miguel Ángel Galindo</span>
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Herramienta de auditoría de cumplimiento · uso interno
          </p>
        </div>
      </footer>
    </div>
  )
}
