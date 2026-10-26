export const ACCESO_COOKIE = "lyrba_acceso"
export const ACCESO_DURACION_SEG = 60 * 60 * 12

/**
 * El acceso por clave queda apagado salvo que existan las dos variables:
 * ACCESO_ACTIVO="true" y ACCESO_CLAVE con la clave compartida.
 */
export function accesoActivo(): boolean {
  return process.env.ACCESO_ACTIVO === "true" && Boolean(process.env.ACCESO_CLAVE)
}

async function hmacHex(clave: string, mensaje: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(mensaje))
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Token de sesión derivado de la clave: si la clave cambia, todas las sesiones caducan. */
export async function tokenAcceso(): Promise<string> {
  return hmacHex(process.env.ACCESO_CLAVE ?? "", "lyrba-repse-acceso-v1")
}

export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function claveCorrecta(intento: string): Promise<boolean> {
  const real = process.env.ACCESO_CLAVE ?? ""
  if (!real) return false
  // Se comparan las firmas para no depender de la longitud de la clave.
  const [a, b] = await Promise.all([hmacHex("cmp", intento), hmacHex("cmp", real)])
  return igualSeguro(a, b)
}

export async function sesionValida(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false
  return igualSeguro(cookie, await tokenAcceso())
}
