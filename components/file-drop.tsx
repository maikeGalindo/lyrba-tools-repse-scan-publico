"use client"

import { useCallback, useId, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

interface FileDropProps {
  title: string
  hint: string
  accept: string
  multiple?: boolean
  icon: ReactNode
  files: File[]
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export function FileDrop({
  title,
  hint,
  accept,
  multiple = false,
  icon,
  files,
  onFiles,
  disabled,
}: FileDropProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accepts = accept.split(",").map((a) => a.trim().toLowerCase())
  const filter = useCallback(
    (list: FileList | null) => {
      if (!list) return []
      return Array.from(list).filter((f) =>
        accepts.some((ext) => f.name.toLowerCase().endsWith(ext)),
      )
    },
    [accepts],
  )

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const valid = filter(e.dataTransfer.files)
    if (valid.length) onFiles(multiple ? [...files, ...valid] : valid.slice(0, 1))
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center transition-colors",
          dragging && "border-primary bg-primary/5",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
            dragging && "bg-primary/10 text-primary",
          )}
        >
          {icon}
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const valid = filter(e.target.files)
            if (valid.length) onFiles(multiple ? [...files, ...valid] : valid.slice(0, 1))
            e.target.value = ""
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2 text-xs"
            >
              <span className="truncate font-mono text-foreground">{f.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">{formatSize(f.size)}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onFiles(files.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
                  aria-label={`Quitar ${f.name}`}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
