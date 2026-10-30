"use client"

import { cn } from "cn"
import type { ReactElement, ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// A Base UI Button that is off yet keeps hover and focus, dimmed, so its Hint still says why; spread it on the button.
export const OFF_FOCUSABLE = {
  className: "data-disabled:opacity-50",
  focusableWhenDisabled: true,
} as const

// One row of a tooltip drawn line by line: its own icon, when it has one, then its words; the icon's slot is kept when empty, so the words sit in one column. dim draws a line that judges nothing quieter.
export type HintLine = { dim?: true; icon?: ReactNode; words: string }

// shadcn's Tooltip around one element, the app's hover in place of the browser's own title box; its delay is TooltipProvider's in providers.tsx, and with nothing to say it shows nothing and describes nothing. Base UI's Tooltip describes nothing to a screen reader, so the words also go on the element as its aria-description, the description a title gave it.
export function Hint({
  body,
  children,
  content,
  description = content,
  lines,
  side,
}: {
  // drawn in place of content and lines, as wide as it needs (the usage windows' rows); content stays the words a screen reader hears
  body?: ReactNode
  children: ReactElement
  content: string | null | undefined
  // what a screen reader hears, when the element's own name already speaks part of the tooltip
  description?: string | null
  // when lines are given they are drawn as rows beside their icons, and content stays the words a screen reader hears
  lines?: HintLine[]
  side?: "bottom" | "left" | "right" | "top"
}) {
  // one element type with or without words, so a hover that comes and goes (the Inbox's paused buttons) never remounts the element and drops its focus
  return (
    <Tooltip disabled={!content}>
      <TooltipTrigger render={children} aria-description={(content && description) || undefined} />
      {content && (
        <TooltipContent side={side} className={body ? "max-w-none" : "whitespace-pre-line"}>
          {body ??
            (lines ? (
              <span data-slot="hint-lines" className="flex min-w-0 flex-col items-stretch gap-1">
                {lines.map((line) => (
                  <span
                    key={line.words}
                    data-slot="hint-line"
                    className={cn("flex items-start gap-1.5", line.dim && "opacity-60")}
                  >
                    <span
                      aria-hidden
                      className="flex size-3.5 shrink-0 translate-y-px items-center justify-center"
                    >
                      {line.icon ?? null}
                    </span>
                    <span className="min-w-0">{line.words}</span>
                  </span>
                ))}
              </span>
            ) : (
              content
            ))}
        </TooltipContent>
      )}
    </Tooltip>
  )
}
