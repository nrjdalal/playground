import { cn } from "cn"

import { READ_ONLY_LINE } from "@/lib/relay"

// The hosted dashboard's one line in place of a composer or a write button, in a browser that keeps no paired key, whose writes the relay never carries.
export function ReadOnlyLine({ className }: { className?: string }) {
  return <p className={cn("text-muted-foreground text-xs", className)}>{READ_ONLY_LINE}</p>
}
