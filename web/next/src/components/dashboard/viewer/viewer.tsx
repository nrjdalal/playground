"use client"

import type { InboxAttachmentKind } from "@api/hono"
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiFileLine,
} from "@remixicon/react"
import { cn } from "cn"
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { type ViewerItem, VIEWERS } from "@/components/dashboard/viewer/registry"
import { useAttachmentUrl } from "@/components/dashboard/viewer/use-attachment-url"
import { OFF_FOCUSABLE } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Carousel, type CarouselApi, CarouselContent, CarouselItem } from "@/components/ui/carousel"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { BAR_ITEM, FLOATING_BAR } from "@/lib/floating-bar"

const KIND_LABELS: Record<InboxAttachmentKind, string> = {
  code: "Code",
  doc: "Doc",
  html: "HTML",
  image: "Image",
  pdf: "PDF",
}

// The arrows that move the slide: Left and Up back, Right and Down on.
export const STEP_OF_KEY: Record<string, -1 | 1> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
}

export const OWNS_POINTER = "[data-viewer-owns-pointer]"
export const OWNS_KEYS = "[data-viewer-owns-keys]"

// Pure: the slide a step lands on, past either end wrapping to the other, and whether it wrapped, so the move jumps rather than sweeping across every slide.
export function wrapStep(index: number, direction: -1 | 1, count: number) {
  const next = (index + direction + count) % count
  return { next, wraps: next !== index + direction }
}

// The kinds a slide draws in a frame, which keeps a touch to itself, so no tap on it can raise the bars.
const FRAME_KINDS: readonly InboxAttachmentKind[] = ["html", "pdf"]

// Pure: whether the bars stay up whatever the pointer does: a frame kind on a screen with no hover, where nothing else could raise them.
export const pinsBars = (kind: InboxAttachmentKind, touch: boolean): boolean =>
  touch && FRAME_KINDS.includes(kind)

const NO_HOVER = "(hover: none)"
const watchNoHover = (change: () => void) => {
  const query = window.matchMedia(NO_HOVER)
  query.addEventListener("change", change)
  return () => query.removeEventListener("change", change)
}
const useNoHover = () =>
  useSyncExternalStore(
    watchNoHover,
    () => window.matchMedia(NO_HOVER).matches,
    () => false,
  )

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// A drag swipes the slide unless it starts inside a renderer that owns its pointer events.
const watchDrag = (_api: unknown, event: MouseEvent | TouchEvent) =>
  !(event.target instanceof Element && event.target.closest(OWNS_POINTER))

function Slide({
  active,
  item,
  near,
  onEdge,
}: {
  active: boolean
  item: ViewerItem
  near: boolean
  onEdge: (direction: -1 | 1) => void
}) {
  const viewer = VIEWERS[item.kind]
  const url = useAttachmentUrl(item.id, near && Boolean(viewer))
  const Icon = viewer?.icon ?? RiFileLine
  return (
    <CarouselItem
      aria-label={item.name}
      className="flex h-full items-center justify-center"
      inert={!active}
    >
      {viewer && url ? (
        <viewer.View active={active} item={item} onEdge={onEdge} url={url} />
      ) : (
        <Icon className="text-muted-foreground size-8" />
      )}
    </CarouselItem>
  )
}

const CAROUSEL_ITEM = '[data-slot="carousel-item"]'

// A slide holding focus turns inert as it leaves, which drops focus to the page, out of the dialog, so the stage takes it first and the next arrow still moves the slide (a tester: Down from the compare slider left Left, Right and Up dead).
export const keepFocus = (focused: Element | null, stage: HTMLElement | null) => {
  if (focused?.closest(CAROUSEL_ITEM)) stage?.focus({ preventScroll: true })
}

// embla emits select only when the slide changes (a swipe and scrollTo alike), before the old one turns inert, so the hand-off lives here and an arrow that moves nothing (a lone page's edge) leaves focus in the page
export const onSelect = (
  snap: number,
  focused: Element | null,
  stage: HTMLElement | null,
  onIndexChange: (index: number) => void,
) => {
  keepFocus(focused, stage)
  onIndexChange(snap)
}

// How near the bottom edge, in px, the pointer brings the bar up.
const REVEAL_PX = 96

// A square in the floating bar, the aside bar's own size (APP_SQUARE), lit as every bar's square is (BAR_ITEM), a full-size hover background with no focus ring.
const SQUARE = `size-8 ${BAR_ITEM}`

// The bar's count and name at fixed widths, so it holds one width from slide to slide.
export const BAR_COUNT =
  "text-muted-foreground w-16 shrink-0 text-center font-mono text-xs tabular-nums"
export const BAR_NAME = "w-48 min-w-0 shrink truncate px-1 text-xs font-normal"

// The kinds a tab may open as a blob URL, which runs with the Dashboard's origin: only those that run no script, an image being a GIF, JPEG, PNG or WebP (`IMAGE_EXTENSIONS`), never an SVG, and never an HTML page or code.
export const OPENS_IN_TAB: readonly InboxAttachmentKind[] = ["image", "pdf"]

// The shown file on a tab of its own, at full size, off until its file has arrived; a kind OPENS_IN_TAB leaves out has no button at all. No tooltips in the bar: each square's icon says it.
export function OpenInNewTab({ item }: { item: ViewerItem }) {
  const opens = OPENS_IN_TAB.includes(item.kind)
  const url = useAttachmentUrl(item.id, opens && Boolean(VIEWERS[item.kind]))
  // a kind that never opens in a tab keeps the square's room, so the bar holds one width
  if (!opens) return <span aria-hidden className="size-8 shrink-0" />
  return url ? (
    <Button
      aria-label="Open in new tab"
      className={SQUARE}
      render={<a href={url} rel="noreferrer" target="_blank" />}
      size="icon-sm"
      variant="ghost"
    >
      <RiExternalLinkLine />
    </Button>
  ) : (
    <Button
      aria-label="Open in new tab"
      className={cn(SQUARE, OFF_FOCUSABLE.className)}
      disabled
      focusableWhenDisabled={OFF_FOCUSABLE.focusableWhenDisabled}
      size="icon-sm"
      variant="ghost"
    >
      <RiExternalLinkLine />
    </Button>
  )
}

// The Inbox's viewer: full screen over the page on a see-through stage, the stock Dialog overlay's dim and blur, in Slider mode, one file filling the screen at a time, as slides, the file filling it edge to edge, fitted to whichever side runs out first, and one floating bar, the aside's own (FLOATING_BAR), that rises only while the pointer is near the bottom edge or a key has focus in it. The arrows, a swipe or the ‹ › buttons move it (a jump where motion is reduced), Esc or X closes it, and focus stays inside, the stock Dialog's. The bar holds ‹, where it stands ("2 / 6") and ›, the file's name, Open in new tab and X. index is the slide shown, which the viewer reports as it moves.
export function Viewer({
  index,
  items,
  onIndexChange,
  onOpenChange,
  open,
}: {
  index: number
  items: ViewerItem[]
  onIndexChange: (index: number) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [api, setApi] = useState<CarouselApi>()
  const [near, setNear] = useState(false)
  const pinned = pinsBars(items[index]?.kind ?? "image", useNoHover())
  // the slide it opens on, held while it is open: a startIndex that followed index would re-init the carousel on every move, so no slide ever animated; the bars go down at each open or close, since closing with X fires no pointerleave
  const [start, setStart] = useState(index)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    setNear(false)
    if (open) setStart(index)
  }
  // focus opens on the stage, not a button in the bar, so the first arrow moves the slide and the bar stays down until wanted
  const stage = useRef<HTMLDivElement>(null)
  // a touch has no hover: a tap on the stage shows or hides the bottom bar, the corner Close staying (a swipe's click embla swallows), and a lifted finger's pointerleave leaves it be
  const touched = useRef(false)
  const item = items[index]

  useEffect(() => {
    if (!api) return
    const select = () =>
      onSelect(api.selectedScrollSnap(), document.activeElement, stage.current, onIndexChange)
    api.on("select", select)
    return () => {
      api.off("select", select)
    }
  }, [api, onIndexChange])

  const go = useCallback(
    (direction: -1 | 1) => {
      const { next, wraps } = wrapStep(index, direction, items.length)
      if (api) api.scrollTo(next, wraps || reducedMotion())
      else onIndexChange(next)
    },
    [api, index, items.length, onIndexChange],
  )

  // Caught on the way down, ahead of the Carousel's own Left and Right, so every arrow moves the slide one way; a renderer that keeps its own keys marks itself OWNS_KEYS.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_OF_KEY[event.key]
    if (!step || (event.target instanceof Element && event.target.closest(OWNS_KEYS))) return
    event.preventDefault()
    event.stopPropagation()
    go(step)
  }

  if (!item) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* a key in the viewer stays in it: React passes a portal's keys up to the card's Questionnaire, which would read a digit as Approve or Deny */}
      <DialogContent
        className="dark text-foreground top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-transparent p-0 ring-0 sm:max-w-none"
        data-slot="viewer"
        initialFocus={stage}
        onKeyDownCapture={onKeyDownCapture}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return
          setNear(false)
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return
          setNear(event.clientY >= window.innerHeight - REVEAL_PX)
        }}
        showCloseButton={false}
      >
        <DialogDescription className="sr-only">
          {KIND_LABELS[item.kind]}. Slider: the arrow keys or a swipe move between the files.
        </DialogDescription>
        {/* The viewer moves the slides itself (onKeyDownCapture above): the Carousel's own Left and Right go, since they also fired inside a renderer that owns its keys. */}
        <Carousel
          className="min-h-0 flex-1 outline-none focus-visible:bg-transparent [&>[data-slot=carousel-content]]:h-full"
          onClick={() => {
            if (!touched.current) return
            setNear(!near)
          }}
          onKeyDownCapture={undefined}
          onPointerDown={(event) => {
            touched.current = event.pointerType === "touch"
          }}
          opts={{ startIndex: start, watchDrag }}
          ref={stage}
          setApi={setApi}
          tabIndex={-1}
        >
          <CarouselContent className="h-full">
            {items.map((slide, i) => (
              <Slide
                key={slide.id}
                active={i === index}
                item={slide}
                near={Math.abs(i - index) <= 1}
                onEdge={go}
              />
            ))}
          </CarouselContent>
        </Carousel>
        {/* the top-right corner keeps a Close of its own, the place a full-screen view keeps it, always shown: a one-square floating bar, the bottom bar's own look and size */}
        <div className={cn(FLOATING_BAR, "absolute top-2 right-2 z-10")}>
          <DialogClose
            render={<Button aria-label="Close" className={SQUARE} size="icon-sm" variant="ghost" />}
          >
            <RiCloseLine />
          </DialogClose>
        </div>
        {/* a frame keeps the pointer's moves to itself, so a thin strip along the bottom edge brings the bar up over an HTML page or a PDF too */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 z-10 h-4"
          onPointerEnter={() => setNear(true)}
        />
        {/* while the bar hides, the aside's thin pill marks where it rises, for the pointer alone, since Tab raises the bar itself once it has passed the corner Close */}
        {!near && !pinned && (
          <button
            type="button"
            aria-label="Show controls"
            tabIndex={-1}
            className="group/handle focus-visible:ring-ring/50 absolute bottom-0 left-1/2 z-10 -translate-x-1/2 rounded-sm px-4 py-2 outline-none focus-visible:ring-2"
            onClick={() => setNear(true)}
            onPointerEnter={() => setNear(true)}
          >
            <span className="bg-popover group-hover/handle:bg-accent block h-1.5 w-10 rounded-full border shadow-md" />
          </button>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <div
            className={cn(
              FLOATING_BAR,
              "max-w-full transition duration-200 motion-reduce:transition-none",
              !near &&
                !pinned &&
                "pointer-events-none translate-y-[calc(100%+1rem)] opacity-0 has-focus-visible:pointer-events-auto has-focus-visible:translate-y-0 has-focus-visible:opacity-100",
            )}
            data-shown={near || pinned || undefined}
          >
            <Button
              aria-label="Previous"
              className={SQUARE}
              disabled={items.length < 2}
              onClick={() => go(-1)}
              size="icon-sm"
              variant="ghost"
            >
              {/* a chevron's glyph fills less of its box than the bar's other icons, so it takes 20px to read the same size */}
              <RiArrowLeftSLine className="size-5" />
            </Button>
            <span className={BAR_COUNT}>
              {index + 1} / {items.length}
            </span>
            <Button
              aria-label="Next"
              className={SQUARE}
              disabled={items.length < 2}
              onClick={() => go(1)}
              size="icon-sm"
              variant="ghost"
            >
              <RiArrowRightSLine className="size-5" />
            </Button>
            <Separator className="mx-1 h-5" orientation="vertical" />
            <DialogTitle className={BAR_NAME}>{item.name}</DialogTitle>
            <OpenInNewTab item={item} />
            <DialogClose
              render={
                <Button aria-label="Close" className={SQUARE} size="icon-sm" variant="ghost" />
              }
            >
              {/* every bar icon reads one size, 16px, the cross included */}
              <RiCloseLine />
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
