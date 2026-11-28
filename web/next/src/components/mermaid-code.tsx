"use client"

import { cn } from "cn"
import { useEffect, useRef, useState, type ReactNode } from "react"

type Drawn = "loading" | "drawn" | "failed"

// Links and images stay off, so a diagram loads nothing from elsewhere, as transcript text never does.
export const DRAW = { images: false, links: false } as const

// A mermaid block drawn as SVG by Pele, which loads only once a block names mermaid, each diagram type on its own; its colours come from the theme through globals.css's [data-mermaid]. The plain code block shows while Pele loads and stays when the block fails to parse; the box keeps its width while hidden, since Pele lays a diagram out to it (PG-1252).
export function MermaidCode({ code, fallback }: { code: string; fallback: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState<Drawn>("loading")
  useEffect(() => {
    const el = box.current
    if (!el) return
    let live = true
    let mounted: { destroy(): void } | undefined
    const set = (next: Drawn) => {
      if (live) setDrawn(next)
    }
    set("loading")
    import("pele/lazy")
      .then(({ mountAsync }) =>
        mountAsync(el, code, {
          ...DRAW,
          onError: () => set("failed"),
          onRender: () => set("drawn"),
          zoom: false,
        }),
      )
      .then((result) => {
        if (live) mounted = result
        else result.destroy()
      })
      .catch(() => set("failed"))
    return () => {
      live = false
      mounted?.destroy()
    }
  }, [code])
  return (
    <>
      <div
        className={cn(
          "my-3 overflow-x-auto",
          drawn === "drawn" ? "" : "h-0 overflow-hidden",
          drawn === "failed" && "hidden",
        )}
        data-mermaid=""
        ref={box}
      />
      {drawn === "drawn" ? null : fallback}
    </>
  )
}
