import { cn } from "@/lib/utils"
import { STATUS_LABEL, type MatchStatus } from "@/lib/types"
import { AlertIcon, CheckIcon, XIcon } from "./icons"

const STYLES: Record<MatchStatus, string> = {
  OK: "bg-success/15 text-success",
  REVISAR: "bg-warning/15 text-warning",
  NO_OK: "bg-danger/15 text-danger",
}

export function StatusBadge({ status }: { status: MatchStatus }) {
  const Icon = status === "OK" ? CheckIcon : status === "REVISAR" ? AlertIcon : XIcon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        STYLES[status],
      )}
    >
      <Icon width={13} height={13} strokeWidth={2.25} />
      {STATUS_LABEL[status]}
    </span>
  )
}
