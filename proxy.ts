import { NextResponse, type NextRequest } from "next/server"
import { ACCESO_COOKIE, accesoActivo, sesionValida } from "@/lib/acceso"

export async function proxy(request: NextRequest) {
  if (!accesoActivo()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (pathname === "/acceso") return NextResponse.next()

  if (await sesionValida(request.cookies.get(ACCESO_COOKIE)?.value)) return NextResponse.next()

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Acceso no autorizado. Ingresa la clave." }, { status: 401 })
  }

  const destino = new URL("/acceso", request.url)
  destino.searchParams.set("next", pathname + search)
  return NextResponse.redirect(destino)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest|.*\\.(?:png|svg|jpg|jpeg|webp|ico|mjs|wasm|traineddata)$).*)"],
}
