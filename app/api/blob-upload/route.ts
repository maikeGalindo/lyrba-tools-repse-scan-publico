import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { NextResponse } from "next/server"
import { BLOB_PREFIX, MAX_ZIP_BYTES } from "@/lib/blob-temporal"
import { isSameOrigin, purgeStaleTempZips } from "@/lib/request-guard"

export async function POST(request: Request) {
  let body: HandleUploadBody
  try {
    body = (await request.json()) as HandleUploadBody
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 })
  }

  // El aviso de "subida completada" lo envía Vercel (firmado); solo la petición de token viene del navegador.
  if (body.type === "blob.generate-client-token" && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403 })
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(BLOB_PREFIX) || !pathname.toLowerCase().endsWith(".zip") || pathname.includes("..")) {
          throw new Error("Solo se permiten expedientes .zip.")
        }
        await purgeStaleTempZips()
        return {
          allowedContentTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
          maximumSizeInBytes: MAX_ZIP_BYTES,
          addRandomSuffix: true,
        }
      },
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
