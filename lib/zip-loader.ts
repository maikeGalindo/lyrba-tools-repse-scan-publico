import JSZip from "jszip"

export interface LoadedXml {
  name: string
  text: string
}

/**
 * Abre un .zip en memoria (100% local) y devuelve solo los archivos .xml,
 * recorriendo subcarpetas e ignorando PDFs de comprobante y basura de macOS.
 */
export async function extractXmlFromZip(file: File): Promise<LoadedXml[]> {
  const zip = await JSZip.loadAsync(file)
  const out: LoadedXml[] = []

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const lower = entry.name.toLowerCase()
    if (!lower.endsWith(".xml")) continue
    if (entry.name.startsWith("__MACOSX") || entry.name.includes("/._")) continue
    const text = await entry.async("string")
    out.push({ name: entry.name.split("/").pop() || entry.name, text })
  }

  return out
}

export async function readXmlFile(file: File): Promise<LoadedXml> {
  return { name: file.name, text: await file.text() }
}

/** Separa una lista mixta de archivos en fuentes de CFDI (zip/xml). */
export async function gatherXmls(files: File[]): Promise<LoadedXml[]> {
  const result: LoadedXml[] = []
  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".zip")) {
      result.push(...(await extractXmlFromZip(file)))
    } else if (lower.endsWith(".xml")) {
      result.push(await readXmlFile(file))
    }
  }
  return result
}
