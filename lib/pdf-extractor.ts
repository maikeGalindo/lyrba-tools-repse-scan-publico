"use client"

import * as pdfjsLib from "pdfjs-dist"

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

const CURP_PATTERN = /[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/

export interface PdfExtractResult {
  text: string
  usedOcr: boolean
  pages: number
}

/**
 * Pipeline híbrido:
 *  1. Extrae la capa de texto con pdf.js (instantáneo para cédulas del SUA).
 *  2. Si no hay texto ni CURP detectable, cae automáticamente a OCR con tesseract.js.
 * Todo ocurre en el navegador; el PDF nunca se sube a un servidor.
 */
export interface ExtractOptions {
  /**
   * Reconstruye las filas visuales a partir de la coordenada Y de cada fragmento.
   * pdf.js devuelve los fragmentos sueltos; sin esto se unen todos con espacios y
   * se pierde la estructura de renglones (crítica para las cédulas del SUA).
   */
  preserveRows?: boolean
}

/**
 * Une los fragmentos de una página respetando renglones (por coordenada Y) y
 * el orden de lectura (por coordenada X). Reproduce el layout visual del PDF.
 */
function itemsToRows(items: any[]): string {
  const frags = items
    .filter((it) => (it.str ?? "").length > 0)
    .map((it) => ({
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
      str: it.str as string,
    }))
  if (frags.length === 0) return ""

  // Agrupa por Y con tolerancia (los fragmentos de un mismo renglón no siempre
  // comparten Y exacto). SUA separa bien los renglones, así que 3px basta.
  frags.sort((a, b) => b.y - a.y)
  const rows: { y: number; frags: typeof frags }[] = []
  for (const f of frags) {
    const row = rows.find((r) => Math.abs(r.y - f.y) <= 3)
    if (row) row.frags.push(f)
    else rows.push({ y: f.y, frags: [f] })
  }
  return rows
    .map((r) =>
      r.frags
        .sort((a, b) => a.x - b.x)
        .map((f) => f.str)
        .join(" "),
    )
    .join("\n")
}

export async function extractPdfText(
  file: File,
  onProgress?: (msg: string) => void,
  opts?: ExtractOptions,
): Promise<PdfExtractResult> {
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: buf })
  const pdf = await loadingTask.promise

  try {
    let text = ""
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`Leyendo texto · página ${i} de ${pdf.numPages}`)
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += opts?.preserveRows
        ? itemsToRows(content.items) + "\n"
        : content.items.map((it: any) => it.str ?? "").join(" ") + "\n"
      page.cleanup()
    }

    const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const looksLikeText = CURP_PATTERN.test(compact) || compact.length > 300

    if (looksLikeText) {
      return { text, usedOcr: false, pages: pdf.numPages }
    }

    onProgress?.("PDF sin capa de texto: iniciando OCR…")
    const ocrText = await ocrPdf(pdf, onProgress)
    return { text: ocrText, usedOcr: true, pages: pdf.numPages }
  } finally {
    // Libera el documento del worker de pdf.js. Sin esto, procesar decenas
    // de PDFs en serie acumula memoria hasta que el navegador mata la pestaña.
    await loadingTask.destroy()
  }
}

async function ocrPdf(
  pdf: any,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js")
  const worker = await createWorker("spa")
  let text = ""
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`OCR · página ${i} de ${pdf.numPages}`)
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2.5 })
      const canvas = document.createElement("canvas")
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext("2d")!
      await page.render({ canvas, canvasContext: ctx, viewport } as any).promise
      const { data } = await worker.recognize(canvas)
      text += data.text + "\n"
      page.cleanup()
      // Libera el bitmap del canvas antes de la siguiente página.
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await worker.terminate()
  }
  return text
}
