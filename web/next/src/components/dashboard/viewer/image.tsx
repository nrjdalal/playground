"use client"

import { RiArrowLeftRightLine, RiImageLine } from "@remixicon/react"
import { cn } from "cn"
import { Fragment, type KeyboardEvent, type PointerEvent, useRef, useState } from "react"

import type {
  KindViewer,
  ThumbProps,
  ViewerItem,
  ViewProps,
} from "@/components/dashboard/viewer/registry"
import { useAttachmentUrl } from "@/components/dashboard/viewer/use-attachment-url"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BAR_ITEM, FLOATING_BAR, GLASS } from "@/lib/floating-bar"
import { comparePointer, compareKey, panBy, ZOOM, zoomAt } from "@/lib/pictures"

type Shown = { alt: string; url: string }
type Pair = { after: Shown; before: Shown }

const FIT = "size-full object-contain"
const FOCUS = "focus-visible:border-ring border border-transparent outline-none"
const DRAG_PX = 4

// The box takes the before's shape until it loads, so the divider sits on the picture, not on the space around it.
const WIDE = 16 / 9

const EDGE_KEYS: Partial<Record<string, -1 | 1>> = { ArrowDown: 1, ArrowUp: -1 }

// Up and Down from a control that keeps its keys (the pair's bar, its divider) go back to the viewer for the slide before or after, as the Slider's do
export const handBack = (onEdge: ViewProps["onEdge"]) => (event: KeyboardEvent) => {
  const edge = EDGE_KEYS[event.key]
  if (!edge) return
  event.preventDefault()
  event.stopPropagation()
  onEdge(edge)
}

// One line for both compare modes, the slider's and the split's: the resize panel's 1px line, one neutral line with no ring so it reads on a light or a dark picture, under the buttons and tooltips; only the slider holds the ⇆ knob at its middle, a glass circle as the buttons are.
const DIVIDER = "w-px bg-muted-foreground"

// Our own: checked shadcn, its registries and AI Elements for a before/after compare; none ships one.
function CompareSlider({ after, before, onEdge }: Pair & Pick<ViewProps, "onEdge">) {
  const [position, setPosition] = useState(50)
  const [ratio, setRatio] = useState(WIDE)
  const move = (event: PointerEvent<HTMLDivElement>) =>
    setPosition(comparePointer(event.clientX, event.currentTarget.getBoundingClientRect()))
  return (
    <div className="flex size-full items-center justify-center" style={{ containerType: "size" }}>
      <div
        data-viewer-owns-keys
        data-viewer-owns-pointer
        role="slider"
        tabIndex={0}
        aria-label="Compare before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`Before ${Math.round(position)}%, after ${100 - Math.round(position)}%`}
        onKeyDown={(event) => {
          // Left, Right, Home and End move the divider; Up and Down hand the slide change back to the viewer
          const edge = EDGE_KEYS[event.key]
          if (!edge && compareKey(position, event.key) === null) return
          event.preventDefault()
          event.stopPropagation()
          if (edge) return onEdge(edge)
          setPosition((now) => compareKey(now, event.key) ?? now)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event)
        }}
        // a tap moves the line alone, never the viewer's bars
        onClick={(event) => event.stopPropagation()}
        className={cn("relative cursor-ew-resize touch-none overflow-hidden select-none", FOCUS)}
        style={{ aspectRatio: ratio, width: `min(100cqw, 100cqh * ${ratio})` }}
      >
        <img
          src={before.url}
          alt={before.alt}
          draggable={false}
          onLoad={(event) =>
            setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || WIDE)
          }
          className={cn(FIT, "absolute inset-0")}
        />
        <img
          src={after.url}
          alt={after.alt}
          draggable={false}
          className={cn(FIT, "absolute inset-0")}
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        />
        <span
          className={cn(DIVIDER, "pointer-events-none absolute inset-y-0 -ml-px")}
          style={{ left: `${position}%` }}
        >
          <span
            className={cn(
              GLASS,
              "text-foreground pointer-events-none absolute top-1/2 left-1/2 flex size-8 -translate-1/2 items-center justify-center rounded-full",
            )}
          >
            <RiArrowLeftRightLine className="size-4" />
          </span>
        </span>
      </div>
    </div>
  )
}

// A click zooms in at that point and a second click zooms out; a drag pans while zoomed, when the picture owns the pointer and the viewer's swipe stands aside. A touch tap is the viewer's, showing or hiding its bars as on every other kind.
function ZoomPicture({ picture }: { picture: Shown }) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ dragged: boolean; x: number; y: number } | null>(null)
  const box = (element: HTMLElement) => ({
    height: element.clientHeight,
    width: element.clientWidth,
  })
  return (
    <button
      type="button"
      data-viewer-owns-pointer={offset ? "" : undefined}
      aria-label={`Zoom in on ${picture.alt}`}
      aria-pressed={offset !== null}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        drag.current = { dragged: false, x: event.clientX, y: event.clientY }
        if (offset) event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start || !offset) return
        const delta = { x: event.clientX - start.x, y: event.clientY - start.y }
        if (!start.dragged && Math.hypot(delta.x, delta.y) < DRAG_PX) return
        drag.current = { dragged: true, x: event.clientX, y: event.clientY }
        setDragging(true)
        const size = box(event.currentTarget)
        setOffset((now) => now && panBy(now, delta, size))
      }}
      onPointerUp={(event) => {
        const start = drag.current
        drag.current = null
        setDragging(false)
        if (!start || start.dragged || event.pointerType === "touch") return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_PX) return
        if (offset) return setOffset(null)
        const rect = event.currentTarget.getBoundingClientRect()
        setOffset(
          zoomAt(
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            box(event.currentTarget),
          ),
        )
      }}
      onClick={(event) => {
        if (event.detail !== 0) return
        const size = box(event.currentTarget)
        setOffset(offset ? null : zoomAt({ x: size.width / 2, y: size.height / 2 }, size))
      }}
      className={cn(
        "relative size-full touch-none overflow-hidden select-none",
        FOCUS,
        offset ? (dragging ? "cursor-grabbing" : "cursor-zoom-out") : "cursor-zoom-in",
      )}
    >
      <img
        src={picture.url}
        alt={picture.alt}
        draggable={false}
        className={cn(
          FIT,
          "origin-top-left",
          !dragging && "motion-safe:transition-transform motion-safe:duration-200",
        )}
        style={
          offset
            ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(${ZOOM})` }
            : undefined
        }
      />
    </button>
  )
}

// A pair's modes on one floating bar, the viewer's own look (FLOATING_BAR, BAR_ITEM): Before alone, then the two compare modes between separators, Side (side by side at a divider that drags from the centre, the first view) and Slider (stacked under the drag slider), then After alone; one width each, so the bar centres on the divider. It floats 8px from the stage's top, and the picture takes the whole stage; on a narrow screen the bar stays 3.5rem clear of each side, so the viewer's top-right Close never covers After, its buttons shrinking alike (`shrink` over the stock item's `shrink-0`).
const PAIR_VIEWS = ["before", "side", "slider", "after"] as const
type PairViewId = (typeof PAIR_VIEWS)[number]
const PAIR_LABELS: Record<PairViewId, string> = {
  after: "After",
  before: "Before",
  side: "Side",
  slider: "Slider",
}

export function PairView({ after, before, onEdge }: Pair & Pick<ViewProps, "onEdge">) {
  const [view, setView] = useState<PairViewId>("side")
  return (
    // isolate keeps the divider's layer inside the slide, under the viewer's Close, bar and tooltips
    <div className="relative isolate size-full">
      {/* the bar and the divider keep Left and Right, which move between the views and resize the split there, rather than the slide */}
      <ToggleGroup
        aria-label="Compare view"
        data-viewer-owns-keys=""
        onKeyDown={handBack(onEdge)}
        className={cn(
          FLOATING_BAR,
          "absolute top-2 left-1/2 z-20 max-w-[calc(100%-7rem)] -translate-x-1/2",
        )}
        size="sm"
        spacing={1}
        // a tap picks a view alone, never the viewer's bars
        onClick={(event) => event.stopPropagation()}
        value={[view]}
        onValueChange={(value) => {
          const next = PAIR_VIEWS.find((id) => id === value[0])
          if (next) setView(next)
        }}
      >
        {PAIR_VIEWS.map((id) => (
          <Fragment key={id}>
            {id === "after" && <Separator className="mx-1" orientation="vertical" />}
            <ToggleGroupItem value={id} className={cn(BAR_ITEM, "h-8 w-20 min-w-0 shrink text-xs")}>
              {PAIR_LABELS[id]}
            </ToggleGroupItem>
            {id === "before" && <Separator className="mx-1" orientation="vertical" />}
          </Fragment>
        ))}
      </ToggleGroup>
      {view === "before" || view === "after" ? (
        <ZoomPicture picture={view === "before" ? before : after} />
      ) : view === "slider" ? (
        <CompareSlider before={before} after={after} onEdge={onEdge} />
      ) : (
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="50%" minSize="15%">
            <ZoomPicture picture={before} />
          </ResizablePanel>
          <ResizableHandle
            data-viewer-owns-keys=""
            data-viewer-owns-pointer=""
            onKeyDown={handBack(onEdge)}
            className={cn(DIVIDER, "focus-visible:bg-ring relative z-10 shrink-0 outline-none")}
          />
          <ResizablePanel defaultSize="50%" minSize="15%">
            <ZoomPicture picture={after} />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}

// A pair's card tile: the before and the after halves side by side.
function PairThumb({ after, before }: Pair) {
  return (
    <span className="grid size-full grid-cols-2 gap-px">
      <img src={before.url} alt={before.alt} draggable={false} className="size-full object-cover" />
      <img src={after.url} alt={after.alt} draggable={false} className="size-full object-cover" />
    </span>
  )
}

// A folded pair keeps its before's id, so the url handed in is the before's; the after's is fetched here, null until it arrives.
function usePair(item: ViewerItem, url: string): Pair | null {
  const pair = item.pair
  const afterUrl = useAttachmentUrl(pair ? pair.after.id : item.id, Boolean(pair))
  if (!pair || !afterUrl) return null
  return { after: { alt: pair.after.name, url: afterUrl }, before: { alt: pair.before.name, url } }
}

function ImageThumb({ item, url }: ThumbProps) {
  const pair = usePair(item, url)
  if (!item.pair)
    return <img alt={item.name} className="size-full object-cover" draggable={false} src={url} />
  return pair ? <PairThumb {...pair} /> : null
}

function ImageView({ item, onEdge, url }: ViewProps) {
  const pair = usePair(item, url)
  if (!item.pair) return <ZoomPicture picture={{ alt: item.name, url }} />
  return pair ? <PairView {...pair} onEdge={onEdge} /> : null
}

export const IMAGE_VIEWER: KindViewer = { icon: RiImageLine, Thumb: ImageThumb, View: ImageView }
