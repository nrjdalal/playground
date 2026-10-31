"use client"

import {
  RiCheckDoubleLine,
  RiExternalLinkLine,
  RiPlayLine,
  RiRefreshLine,
  RiStopCircleLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react"

import { useDashboard } from "@/components/dashboard/dashboard"
import { Badge } from "@/components/ui/badge"
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
import { roleLabel } from "@/lib/agent-label"
import { config } from "@/lib/config"
import {
  doneMessage,
  fetchPreviews,
  loadable,
  PREVIEWS_QUERY_KEY,
  previewUrl,
  stackGroups,
  startAddress,
  STOPPED,
  stoppedIn,
} from "@/lib/previews"
import { fetchStacks, STACKS_QUERY_KEY, startStack, stopStack } from "@/lib/stacks"
import { vibeLabel } from "@/lib/test-data"

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

// The Inbox's Preview row: a picker of every project's worktrees on this machine, by project, and the pages agents leave in Previews, an address, reload and open in a new tab, and the page live in a frame that fills the pane below; a stopped worktree picked offers Start, which runs it as a Vibeground on a copy of the live data, and a running Vibeground wears its badge and offers Stop, and Done, which asks the dispatcher to have the work in its worktree pushed for review.
export function PreviewPane() {
  const [address, setAddress] = useState("")
  const [typed, setTyped] = useState("")
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [bleed, setBleed] = useState(0)
  const [reloads, setReloads] = useState(0)
  // a picked stopped worktree's path, and whether Start has run and its stack is not serving yet
  const [stopped, setStopped] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  // the worktree picked now, so a Start that answers after a re-pick leaves the new pick alone
  const picking = useRef(stopped)
  picking.current = stopped
  // the worktree whose session Done last told, so the strip says it went
  const [handed, setHanded] = useState<string | null>(null)
  const { dispatcher, outbox } = useDashboard()
  const box = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const stacks = useQuery({
    queryFn: fetchStacks,
    queryKey: STACKS_QUERY_KEY,
    // a Vibeground booting, this pane's own Start or one the list shows started, is read every 3s until it serves
    refetchInterval: (query) =>
      waiting || query.state.data?.some((stack) => stack.vibe && !stack.url) ? 3_000 : false,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: STACKS_QUERY_KEY })
  const start = useMutation({
    mutationFn: startStack,
    onSuccess: (_, path) => {
      if (picking.current === path) setWaiting(true)
      void refresh()
    },
  })
  const stop = useMutation({
    mutationFn: stopStack,
    onSuccess: (_, path) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof fetchStacks>>>(STACKS_QUERY_KEY, (data) =>
        data ? stoppedIn(data, path) : data,
      )
      show("")
      setStopped(path)
      void refresh()
    },
  })
  const previews = useQuery({ queryFn: fetchPreviews, queryKey: PREVIEWS_QUERY_KEY })
  const pages = (previews.data?.previews ?? [])
    .filter((preview) => preview.kind === "html")
    .slice(0, PAGES_MAX)
    .map((preview) => ({
      label: preview.page?.title ?? preview.caption ?? preview.name,
      value: previewUrl(config.api.url, preview.name),
    }))
  const groups = stackGroups(stacks.data ?? [])
  const stackItems = groups.flatMap((group) => group.items)

  const show = (next: string) => {
    setAddress(next)
    setTyped(next)
  }
  // the last address comes back for this browser, else the first stack once the list arrives; a fold unmounts the pane, so this runs on every open
  useEffect(() => {
    if (address || stopped) return
    const next = startAddress(localStorage.getItem(URL_KEY), stacks.data ?? [], config.api.url)
    if (next) show(next)
  }, [address, stopped, stacks.data])

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
    setStopped(null)
    show(next)
    localStorage.setItem(URL_KEY, next)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    go(typed.trim())
  }
  const stoppedStack = stopped ? stacks.data?.find((stack) => stack.path === stopped) : undefined
  // once a started worktree serves, the frame opens it, one started before a re-pick or a fold too
  useEffect(() => {
    if (!stoppedStack?.url || !(waiting || stoppedStack.vibe)) return
    setWaiting(false)
    go(`${stoppedStack.url}/`)
  }, [waiting, stoppedStack?.url, stoppedStack?.vibe])
  const page = address.startsWith(PREVIEW_PREFIX)
  // the stack the address is on, the longest URL it starts with
  const shown = page
    ? undefined
    : stacks.data
        ?.filter((stack) => stack.url && address.startsWith(`${stack.url}/`))
        .toSorted((a, b) => (b.url?.length ?? 0) - (a.url?.length ?? 0))[0]
  const picked = page ? address : stopped ? `${STOPPED}${stopped}` : (shown?.url ?? "")
  const stoppedName = stoppedStack?.branch ?? stoppedStack?.name ?? "This worktree"
  // started, by this pane or before a re-pick or a fold, and not serving yet: the list's record, so Stop shows and Start never runs twice
  const booting = Boolean(stoppedStack?.vibe)

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
            if (value.startsWith(STOPPED)) {
              start.reset()
              stop.reset()
              setWaiting(false)
              show("")
              return setStopped(value.slice(STOPPED.length))
            }
            // a new stack keeps the path the address is on
            const path = page ? "/" : address.replace(/^https?:\/\/[^/]+/, "") || "/"
            go(`${value}${path}`)
          }}
        >
          <SelectTrigger aria-label="Stack or page" className="h-7! w-40 shrink-0 text-xs">
            <SelectValue placeholder="Pick a stack" className="truncate" />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className="max-h-72 w-72">
            {/* each project's worktrees, a stopped one picked to start it */}
            {groups.map((group) => (
              <SelectGroup key={group.project}>
                <SelectLabel>{group.project}</SelectLabel>
                {group.items.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="text-xs">
                    <span className="truncate">{item.label}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
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
        {shown?.vibe && shown.path && (
          <Button
            type="button"
            aria-label="Stop"
            size="icon-sm"
            variant="ghost"
            className={PANE_BUTTON}
            disabled={stop.isPending}
            onClick={() => stop.mutate(shown.path!)}
          >
            <RiStopCircleLine />
          </Button>
        )}
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
      {shown?.vibe && shown.branch && (
        <div className="flex min-h-7 items-center gap-1.5 pb-2 text-xs">
          <Badge variant="secondary" className="min-w-0 shrink justify-start">
            <span className="truncate">{vibeLabel(shown.branch)}</span>
          </Badge>
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {handed === shown.path && dispatcher
              ? `Sent to ${roleLabel(dispatcher) ?? dispatcher}`
              : null}
          </span>
          {/* the owner's own click alone sends it, to the dispatcher through the outbox as his chat does, which routes it to the worktree's session */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 text-xs"
            disabled={!dispatcher || !shown.path}
            onClick={() => {
              outbox.send(dispatcher!, {
                attachments: [],
                text: doneMessage({
                  branch: shown.branch!,
                  path: shown.path!,
                  session: shown.session,
                }),
              })
              setHanded(shown.path)
            }}
          >
            <RiCheckDoubleLine />
            Done
          </Button>
        </div>
      )}
      {stop.error && (
        <p className="text-destructive pb-2 text-xs select-text">{stop.error.message}</p>
      )}
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
        ) : stopped ? (
          <div className="grid size-full place-items-center p-4 text-center text-xs">
            <div className="flex max-w-72 flex-col items-center gap-2">
              <p className="text-muted-foreground">
                {waiting || booting || start.isPending
                  ? `Starting ${stoppedName} on a copy of your data. Its log is .turbo/vibe-dev.log in the worktree.`
                  : `${stoppedName} is stopped. Start runs it as it stands, on a copy of your data.`}
              </p>
              {booting && stopped ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={stop.isPending}
                  onClick={() => {
                    setWaiting(false)
                    stop.mutate(stopped)
                  }}
                >
                  <RiStopCircleLine />
                  Stop
                </Button>
              ) : (
                !waiting && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={start.isPending}
                    onClick={() => start.mutate(stopped)}
                  >
                    <RiPlayLine />
                    Start
                  </Button>
                )
              )}
              {start.error && <p className="text-destructive select-text">{start.error.message}</p>}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground grid size-full place-items-center text-xs">
            {stacks.isPending ? "Reading the stacks" : "No stack is running"}
          </p>
        )}
      </div>
    </div>
  )
}
