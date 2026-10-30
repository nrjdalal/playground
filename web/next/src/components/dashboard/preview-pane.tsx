"use client"

import { RiExternalLinkLine, RiRefreshLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { config } from "@/lib/config"
import {
  fetchPreviews,
  loadable,
  PREVIEWS_QUERY_KEY,
  previewUrl,
  startAddress,
} from "@/lib/previews"
import { fetchStacks, STACKS_QUERY_KEY } from "@/lib/stacks"

const URL_KEY = "dashboard.preview.url.v1"
const PREVIEW_PREFIX = previewUrl(config.api.url, "")
// the frame's least height, for a pane too short to fill
const MIN_HEIGHT = 320
// the picker offers the newest pages from Previews alone
const PAGES_MAX = 8
// the bar's two icon buttons, their icons 14px and muted as the line's chevron until hovered
const PANE_BUTTON = "text-muted-foreground hover:text-foreground size-7 [&_svg]:size-3.5!"

// an address the frame may load: a local stack or a page from Previews
const canLoad = (address: string) => loadable(address, config.api.url)

// The nearest ancestor that scrolls, the pane the frame fills.
const scrollerOf = (el: HTMLElement | null): HTMLElement | null => {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

// The Inbox's Preview row: a picker of the machine's dev stacks and the pages agents leave in Previews, an address, reload and open in a new tab, and the page live in a frame that fills the pane below.
export function PreviewPane() {
  const [address, setAddress] = useState("")
  const [typed, setTyped] = useState("")
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [bleed, setBleed] = useState(0)
  const [reloads, setReloads] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const stacks = useQuery({ queryFn: fetchStacks, queryKey: STACKS_QUERY_KEY })
  const previews = useQuery({ queryFn: fetchPreviews, queryKey: PREVIEWS_QUERY_KEY })
  const pages = (previews.data?.previews ?? [])
    .filter((preview) => preview.kind === "html")
    .slice(0, PAGES_MAX)
    .map((preview) => ({
      label: preview.page?.title ?? preview.caption ?? preview.name,
      value: previewUrl(config.api.url, preview.name),
    }))
  const stackItems = (stacks.data ?? []).map((stack) => ({ label: stack.name, value: stack.url }))

  const show = (next: string) => {
    setAddress(next)
    setTyped(next)
  }
  // the last address comes back for this browser, else the first stack once the list arrives; a fold unmounts the pane, so this runs on every open
  useEffect(() => {
    if (address) return
    const next = startAddress(localStorage.getItem(URL_KEY), stacks.data ?? [], config.api.url)
    if (next) show(next)
  }, [address, stacks.data])

  // the frame takes the pane's height left under the rows above, down to the pane's very bottom, reaching over the padding below it, so the pane does not scroll and the Inbox row stays on screen; with an open list above, it keeps its least height and the pane scrolls; inside the Inbox's Preview row, whose accordion panel clips anything pulled past it, the pane drops its bottom padding instead (data-preview-frame), so nothing of the page is cut off
  useLayoutEffect(() => {
    const el = box.current
    const pane = scrollerOf(el)
    const section = el?.closest("section")
    if (!el || !pane) return
    const fit = () => {
      const frame = el.getBoundingClientRect()
      const top = frame.top - pane.getBoundingClientRect().top + pane.scrollTop
      // what sits under the frame, its own pull over it given back: the rest of the Inbox's padding, then the pane's
      const below =
        (section ? section.getBoundingClientRect().bottom - frame.bottom : 0) -
        Number.parseFloat(getComputedStyle(el).marginBottom) +
        Number.parseFloat(getComputedStyle(pane).paddingBottom)
      setBleed(Math.ceil(below))
      setHeight(Math.max(MIN_HEIGHT, Math.floor(pane.clientHeight - top)))
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(pane)
    if (section) watch.observe(section)
    return () => watch.disconnect()
  }, [])

  const go = (next: string) => {
    if (!canLoad(next)) return
    show(next)
    localStorage.setItem(URL_KEY, next)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    go(typed.trim())
  }
  const page = address.startsWith(PREVIEW_PREFIX)
  const picked = page
    ? address
    : (stacks.data?.find((stack) => address.startsWith(`${stack.url}/`))?.url ?? "")

  return (
    <div className="flex flex-col pb-3">
      {/* the bar is one accordion row tall, 34px, its controls 28px */}
      <form onSubmit={submit} className="flex h-[34px] items-center gap-1.5">
        {/* shadcn's Select, the stacks then the newest pages, each cut to one line */}
        <Select
          items={[...stackItems, ...pages]}
          value={picked || null}
          onValueChange={(value: string | null) => {
            if (!value) return
            if (value.startsWith(PREVIEW_PREFIX)) return go(value)
            // a new stack keeps the path the address is on
            const path = page ? "/" : address.replace(/^https?:\/\/[^/]+/, "") || "/"
            go(`${value}${path}`)
          }}
        >
          <SelectTrigger aria-label="Stack or page" className="h-7! w-40 shrink-0 text-xs">
            <SelectValue placeholder="Pick a stack" className="truncate" />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className="max-h-72 w-72">
            <SelectGroup>
              <SelectLabel>Stacks</SelectLabel>
              {stackItems.map((item) => (
                <SelectItem key={item.value} value={item.value} className="text-xs">
                  <span className="truncate">{item.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            {pages.length > 0 && (
              <SelectGroup>
                <SelectLabel>Previews</SelectLabel>
                {pages.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="text-xs">
                    <span className="truncate">{item.label}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <Input
          aria-label="Address"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-invalid={typed !== "" && !canLoad(typed.trim()) ? true : undefined}
          placeholder="https://<stack>.localhost/"
          className="h-7 min-w-0 flex-1 text-xs md:text-xs"
        />
        <Button
          type="button"
          aria-label="Reload"
          size="icon-sm"
          variant="ghost"
          className={PANE_BUTTON}
          disabled={!address}
          onClick={() => setReloads((count) => count + 1)}
        >
          <RiRefreshLine />
        </Button>
        <Button
          aria-label="Open in a new tab"
          size="icon-sm"
          variant="ghost"
          className={PANE_BUTTON}
          disabled={!address}
          render={<a href={address || undefined} target="_blank" rel="noreferrer" />}
          nativeButton={false}
        >
          <RiExternalLinkLine />
        </Button>
      </form>
      {/* the frame runs edge to edge of the pane with square corners, a browser window's body */}
      <div
        ref={box}
        data-preview-frame
        style={{ height, marginBottom: -bleed }}
        className="-mx-(--pane-x) overflow-hidden border-t bg-black"
      >
        {address ? (
          // a stack is the owner's own local app, so it runs as itself; a page from Previews runs no script, as on the Previews page
          <iframe
            key={`${address}#${reloads}`}
            src={address}
            title="Preview"
            className="size-full bg-white"
            {...(page ? { referrerPolicy: "no-referrer" as const, sandbox: "" } : {})}
          />
        ) : (
          <p className="text-muted-foreground grid size-full place-items-center text-xs">
            {stacks.isPending ? "Reading the stacks" : "No stack is running"}
          </p>
        )}
      </div>
    </div>
  )
}
