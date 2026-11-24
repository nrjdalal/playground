"use client"

import type { ProgressItem } from "@packages/config/inbox"
import { Fragment } from "react"

import { Hint } from "@/components/hint"
import { Progress } from "@/components/ui/progress"
import { config } from "@/lib/config"
import { transcriptLink } from "@/lib/markdown"

// An active row's bar, and a row with no state under 100, fills in the palette's blue, since the primary colour has no hue; every other row's fill is muted.
export const ACTIVE_BAR = "**:data-[slot=progress-indicator]:bg-chart-2"
export const MUTED_BAR = "**:data-[slot=progress-indicator]:bg-muted-foreground/40"

// A row's name written as a markdown link to an http or https page, `[ABC-12](https://...)`, draws as that link once transcriptLink passes it, another site's in a new tab; any other name draws as plain text.
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/

// A progress fenced block, drawn at the width of whatever holds it, so its bars fill an Inbox card on a phone and a wide screen alike: each item is its name, a bar and its percent on one line, the names in one column of at most 6rem so the bars start at one x and a long name never narrows them, a name past it cut short with its whole name on hover, then what is going on with its ETA at the right; each bar takes ACTIVE_BAR or MUTED_BAR by its row's state.
export function ProgressBlock({ items }: { items: ProgressItem[] }) {
  return (
    <div
      className="my-3 grid grid-cols-[fit-content(6rem)_minmax(4rem,1fr)_auto] items-center gap-x-3 rounded-md border p-3 text-xs"
      data-language="progress"
    >
      {items.map((item, index) => {
        const [, label = item.name, href] = LINK.exec(item.name) ?? []
        const link = href ? transcriptLink(href, config.app.url) : null
        return (
          <Fragment key={index}>
            <Hint content={label} description={null}>
              {link ? (
                <a
                  href={link.href}
                  {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {label}
                </a>
              ) : (
                <span className="min-w-0 truncate font-medium">{label}</span>
              )}
            </Hint>
            <Progress
              aria-label={item.state ? `${label}, ${item.state}` : label}
              className={!item.state || item.state === "active" ? ACTIVE_BAR : MUTED_BAR}
              value={item.percent}
            />
            <span className="text-right font-mono tabular-nums">{`${item.percent}%`}</span>
            <div className="text-muted-foreground col-span-3 mt-1 flex gap-3 not-last:mb-3">
              <span className="min-w-0 wrap-anywhere">{item.text}</span>
              <span className="ml-auto shrink-0">{item.eta}</span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
