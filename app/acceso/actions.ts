"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ACCESO_COOKIE, ACCESO_DURACION_SEG, accesoActivo, claveCorrecta, tokenAcceso } from "@/lib/acceso"

export type EstadoAcceso = { error?: string }

function destinoSeguro(next: FormDataEntryValue | null): string {
  const ruta = typeof next === "string" ? next : "/"
  return ruta.startsWith("/") && !ruta.startsWith("//") ? ruta : "/"
}

export async function ingresar(_prev: EstadoAcceso, formData: FormData): Promise<EstadoAcceso> {
  const destino = destinoSeguro(formData.get("next"))
  if (!accesoActivo()) redirect(destino)

  const clave = String(formData.get("clave") ?? "")
  if (!(await claveCorrecta(clave))) {
    // Pequeña espera para frenar intentos repetidos.
    await new Promise((r) => setTimeout(r, 800))
    return { error: "Clave incorrecta." }
  }

  const store = await cookies()
  store.set(ACCESO_COOKIE, await tokenAcceso(), {
    httpOnly: true,
    secure: true,
    // "none" permite que funcione dentro de la vista previa (iframe); las API ya validan el origen.
    sameSite: "none",
    path: "/",
    maxAge: ACCESO_DURACION_SEG,
  })
  redirect(destino)
}
