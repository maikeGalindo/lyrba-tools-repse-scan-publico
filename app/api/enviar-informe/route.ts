import { del, get } from "@vercel/blob"
import { NextResponse } from "next/server"
import { BLOB_PREFIX, MAX_ZIP_BYTES } from "@/lib/blob-temporal"
import { isSameOrigin, purgeStaleTempZips } from "@/lib/request-guard"

const DESTINATARIO = "repse@lyrba.com.mx"
// Sin dominio propio verificado, Resend solo permite su remitente de pruebas.
const REMITENTE = "Informes REPSE <onboarding@resend.dev>"

const MAX_SUBJECT = 200
const MAX_TEXT = 20_000
const MAX_HTML = 60_000
const MAX_CSV = 3_000_000
const MAX_FILENAME = 120
const MAX_ADJUNTOS = 5

function field(form: FormData, key: string, max: number): string | null {
  const value = form.get(key)
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null
}

function safeZipName(name: string, index: number) {
  const base = name.replace(/[^\w.-]+/g, "_").slice(0, MAX_FILENAME)
  if (!base || base === ".zip") return `expediente-${index + 1}.zip`
  return base.toLowerCase().endsWith(".zip") ? base : `${base}.zip`
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "El servicio de correo no está configurado (falta RESEND_API_KEY)." }, { status: 500 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { error: "Solicitud inválida o demasiado grande (el límite de envío es de 4 MB)." },
      { status: 400 },
    )
  }

  const subject = field(form, "subject", MAX_SUBJECT)
  const text = field(form, "text", MAX_TEXT)
  const html = field(form, "html", MAX_HTML)
  const csv = field(form, "csv", MAX_CSV)
  if (!subject || !text || !csv) {
    return NextResponse.json({ error: "El informe está vacío o es demasiado grande para enviarse." }, { status: 400 })
  }

  const filename = field(form, "filename", MAX_FILENAME)
  const safeFilename = filename && /^[\w.-]+\.csv$/.test(filename) ? filename : "informe-expediente.csv"

  const blobPaths = form
    .getAll("blobPath")
    .filter((v): v is string => typeof v === "string" && v.startsWith(BLOB_PREFIX) && !v.includes(".."))
  if (blobPaths.length > MAX_ADJUNTOS) {
    return NextResponse.json({ error: "Demasiados archivos adjuntos." }, { status: 400 })
  }

  try {
    return await enviar({ apiKey, subject, text, html, csv, safeFilename, blobPaths })
  } finally {
    if (blobPaths.length > 0) await del(blobPaths).catch(() => {})
    await purgeStaleTempZips()
  }
}

async function leerZipsTemporales(blobPaths: string[]) {
  let total = 0
  const adjuntos: { filename: string; content: string }[] = []
  for (const [i, pathname] of blobPaths.entries()) {
    const result = await get(pathname, { access: "private" })
    if (!result || result.statusCode !== 200) throw new Error("No se encontró el .zip temporal.")
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer())
    total += buffer.length
    if (total > MAX_ZIP_BYTES) throw new Error("El .zip supera el límite de 25 MB para adjuntarse.")
    const original = pathname.slice(BLOB_PREFIX.length).replace(/-[A-Za-z0-9]{20,}(?=\.zip$)/i, "")
    adjuntos.push({ filename: safeZipName(original, i), content: buffer.toString("base64") })
  }
  return adjuntos
}

async function enviar({
  apiKey,
  subject,
  text,
  html,
  csv,
  safeFilename,
  blobPaths,
}: {
  apiKey: string
  subject: string
  text: string
  html: string | null
  csv: string
  safeFilename: string
  blobPaths: string[]
}) {
  let zipAttachments: { filename: string; content: string }[]
  try {
    zipAttachments = await leerZipsTemporales(blobPaths)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 413 })
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: REMITENTE,
      to: [DESTINATARIO],
      subject: subject.replace(/[\r\n]+/g, " "),
      text,
      ...(html ? { html } : {}),
      attachments: [
        { filename: safeFilename, content: Buffer.from(csv, "utf8").toString("base64") },
        ...zipAttachments,
      ],
    }),
  })

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null
    console.error("Resend rechazó el envío:", res.status, detail?.message)
    const message =
      res.status === 403
        ? `Resend rechazó el envío. Sin dominio propio, la cuenta de Resend debe estar registrada con ${DESTINATARIO}.`
        : detail?.message || "No se pudo enviar el correo."
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ ok: true, to: DESTINATARIO, adjuntos: zipAttachments.length })
}
