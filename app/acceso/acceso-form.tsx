"use client"

import { useActionState } from "react"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ingresar, type EstadoAcceso } from "./actions"

export function AccesoForm({ next }: { next: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAcceso, FormData>(ingresar, {})

  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-2">
        <label htmlFor="clave" className="text-sm font-medium text-foreground">
          Clave de acceso
        </label>
        <input
          id="clave"
          name="clave"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={Boolean(estado.error)}
          aria-describedby={estado.error ? "clave-error" : undefined}
          className="h-12 rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {estado.error && (
          <p id="clave-error" role="alert" className="text-sm text-destructive">
            {estado.error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pendiente} className="h-12 text-base">
        <Lock aria-hidden="true" />
        {pendiente ? "Verificando…" : "Entrar"}
      </Button>
    </form>
  )
}
