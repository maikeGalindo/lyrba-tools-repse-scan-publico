import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { accesoActivo } from "@/lib/acceso"
import { AccesoForm } from "./acceso-form"

export const metadata: Metadata = {
  title: "Acceso · Expediente REPSE",
  robots: { index: false },
}

export default async function AccesoPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const destino = next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
  if (!accesoActivo()) redirect(destino)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-border bg-card p-6 text-card-foreground">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance">Expediente REPSE</h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Ingresa la clave de tu equipo para usar la herramienta.
          </p>
        </header>
        <AccesoForm next={destino} />
      </div>
    </main>
  )
}
