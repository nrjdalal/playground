import { cn } from "cn"

import { READ_ONLY_LINE } from "@/lib/relay"

// The hosted dashboard's one line in place of a composer or a write button, since its relay carries reads alone.
export function ReadOnlyLine({ className }: { className?: string }) {
  return <p className={cn("text-muted-foreground text-xs", className)}>{READ_ONLY_LINE}</p>
}
