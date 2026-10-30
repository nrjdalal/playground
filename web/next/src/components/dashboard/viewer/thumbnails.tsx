"use client"

import { RiFullscreenLine } from "@remixicon/react"
import { cn } from "cn"
import { type KeyboardEvent, useState } from "react"

import { HTML_VIEWER } from "@/components/dashboard/viewer/documents"
import { FileIcon } from "@/components/dashboard/viewer/file-icons"
import { type ViewerItem, VIEWERS } from "@/components/dashboard/viewer/registry"
import { useAttachmentUrl } from "@/components/dashboard/viewer/use-attachment-url"
import { Viewer } from "@/components/dashboard/viewer/viewer"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { BAR_ITEM, FLOATING_BAR } from "@/lib/floating-bar"
import { foldPairs } from "@/lib/pictures"

// The card shows its files in a four-by-four grid of squares: up to sixteen tiles, or fifteen and a +N tile for the rest (the owner's pick on #i855).
export const GRID_TILES = 16

const GRID_COLUMNS = 4

// A picture sits dimmed on the dark theme until hovered, so a white screenshot does not glare.
const TILE =
  "text-muted-foreground hover:bg-muted/50 [&_img]:transition dark:[&_img]:brightness-75 dark:hover:[&_img]:brightness-100 dark:focus-visible:[&_img]:brightness-100 relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border focus-visible:ring-ring/50 outline-none focus-visible:ring-3 focus-visible:border-ring"

function Thumb({
  index,
  item,
  onOpen,
}: {
  index: number
  item: ViewerItem
  onOpen: (index: number) => void
}) {
  const viewer = VIEWERS[item.kind]
  const url = useAttachmentUrl(item.id, Boolean(viewer?.Thumb))
  return (
    <Hint content={item.name}>
      <button
        aria-label={`Open ${item.name}`}
        className={TILE}
        onClick={() => onOpen(index)}
        type="button"
      >
        {viewer?.Thumb && url ? (
          <viewer.Thumb item={item} url={url} />
        ) : (
          <span className="flex w-full min-w-0 flex-col items-center gap-2 px-2">
            <FileIcon className="size-8 shrink-0" name={item.name} />
            <span className="text-2xs w-full truncate text-center">{item.name}</span>
          </span>
        )}
      </button>
    </Hint>
  )
}

// Pure: where a key moves focus in a grid of columns, from tile at of count: Left and Right a tile, Up and Down a row, held at the edges, Home and End to its ends; null for any other key, which the grid leaves alone (Enter or Space opens the focused tile).
export function focusTarget(
  key: string,
  at: number,
  count: number,
  columns = GRID_COLUMNS,
): number | null {
  const step = { ArrowDown: columns, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns }[key]
  const to = key === "Home" ? 0 : key === "End" ? count - 1 : step ? at + step : null
  return to === null ? null : to < 0 || to >= count ? at : to
}

const moveFocus = (columns: number) => (event: KeyboardEvent<HTMLDivElement>) => {
  const tiles = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")]
  const at = tiles.indexOf(document.activeElement as HTMLButtonElement)
  const to = at === -1 ? null : focusTarget(event.key, at, tiles.length, columns)
  if (to === null) return
  event.preventDefault()
  event.stopPropagation()
  tiles[to]?.focus()
}

// One side of a lone before/after pair, its label over the picture at the card's full width in a box of fixed height, so it holds its room before the picture loads and a tall screenshot cannot stretch the card; it opens the pair in the viewer.
function WideSide({
  item,
  label,
  onOpen,
}: {
  item: ViewerItem
  label: string
  onOpen: () => void
}) {
  const url = useAttachmentUrl(item.id)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <button
        aria-label={`Open ${label.toLowerCase()}: ${item.name}`}
        className="focus-visible:border-ring block h-48 w-full overflow-hidden rounded-md border outline-none"
        onClick={onOpen}
        type="button"
      >
        {url ? <img alt={item.name} className="size-full object-contain" src={url} /> : null}
      </button>
    </div>
  )
}

// a card has no slide before or after to hand the arrows to
const stay = () => {}

// A lone HTML page live in the card at its full width, through the viewer's own HTML view (its sandboxed frame, links opened in a tab, a page that leaves put back, Spinner and Unreadable), never taking the focus, with a one-square floating bar in its corner that opens it full screen.
function LivePage({ item, onOpen }: { item: ViewerItem; onOpen: () => void }) {
  const url = useAttachmentUrl(item.id, true)
  return (
    <div className="relative flex h-80 items-center justify-center overflow-hidden rounded-md border">
      {url ? <HTML_VIEWER.View active={false} item={item} onEdge={stay} url={url} /> : null}
      <div className={cn(FLOATING_BAR, "absolute top-2 right-2")}>
        <Button
          aria-label={`Open ${item.name} full screen`}
          className={cn("size-8", BAR_ITEM)}
          onClick={onOpen}
          size="icon-sm"
          variant="ghost"
        >
          <RiFullscreenLine />
        </Button>
      </div>
    </div>
  )
}

// An ask's files under its text: a lone HTML page live (LivePage), a lone before/after pair at full width, Before over After, else up to GRID_TILES thumbnails (a kind with no Thumb a titled tile, its icon over its name), then a +N tile that opens the first one it stands for; each opens the viewer at its own place.
export function AttachmentThumbs({
  items,
  onOpen,
}: {
  items: ViewerItem[]
  onOpen: (index: number) => void
}) {
  const page = items.length === 1 && items[0]?.kind === "html" ? items[0] : undefined
  if (page)
    return (
      <div aria-label="Attached files" data-slot="attachment-thumbs" role="group">
        <LivePage item={page} onOpen={() => onOpen(0)} />
      </div>
    )
  const lone = items.length === 1 ? items[0]?.pair : undefined
  if (lone)
    return (
      <div
        aria-label="Attached files"
        className="flex flex-col gap-3"
        data-slot="attachment-thumbs"
        onKeyDown={moveFocus(1)}
        role="group"
      >
        <WideSide item={lone.before} label="Before" onOpen={() => onOpen(0)} />
        <WideSide item={lone.after} label="After" onOpen={() => onOpen(0)} />
      </div>
    )
  const shown = items.length > GRID_TILES ? GRID_TILES - 1 : items.length
  const more = items.length - shown
  return (
    <div
      aria-label="Attached files"
      className="grid grid-cols-4 gap-3"
      data-slot="attachment-thumbs"
      onKeyDown={moveFocus(GRID_COLUMNS)}
      role="group"
    >
      {items.slice(0, shown).map((item, index) => (
        <Thumb key={item.id} index={index} item={item} onOpen={onOpen} />
      ))}
      {more > 0 ? (
        <Hint content={`${more} more`}>
          <button
            aria-label={`Open ${more} more`}
            className={`${TILE} text-foreground text-sm font-medium`}
            onClick={() => onOpen(shown)}
            type="button"
          >
            +{more}
          </button>
        </Hint>
      ) : null}
    </div>
  )
}

// The one component a surface drops in for a set of files: the thumbnails, and the viewer they open (the Inbox's ask today).
export function Attachments({ items: files }: { items: ViewerItem[] }) {
  const items = foldPairs(files)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  return (
    <>
      <AttachmentThumbs
        items={items}
        onOpen={(at) => {
          setIndex(at)
          setOpen(true)
        }}
      />
      <Viewer
        index={index}
        items={items}
        onIndexChange={setIndex}
        onOpenChange={setOpen}
        open={open}
      />
    </>
  )
}
