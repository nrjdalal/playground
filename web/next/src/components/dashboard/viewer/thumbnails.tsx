"use client"

import { cn } from "cn"
import { type KeyboardEvent, useState } from "react"

import { useAsideDocs } from "@/components/dashboard/aside-docs"
import { HTML_VIEWER } from "@/components/dashboard/viewer/documents"
import { FileIcon } from "@/components/dashboard/viewer/file-icons"
import { type ViewerItem, VIEWERS } from "@/components/dashboard/viewer/registry"
import { useAttachment } from "@/components/dashboard/viewer/use-attachment-url"
import {
  Download,
  FullScreen,
  Missing,
  OpenInNewTab,
  SidePanel,
  Viewer,
} from "@/components/dashboard/viewer/viewer"
import { Hint } from "@/components/hint"
import { fileDoc, opensInAside } from "@/lib/aside-docs"
import { BAR_ITEM, FLOATING_BAR } from "@/lib/floating-bar"
import { foldPairs } from "@/lib/pictures"

// The card shows its files in a four-by-four grid of squares: up to sixteen tiles, or fifteen and a +N tile for the rest (the owner's pick on #i855).
export const GRID_TILES = 16

const GRID_COLUMNS = 4

// A picture sits dimmed on the dark theme until hovered, so a white screenshot does not glare.
const TILE =
  "text-muted-foreground hover:bg-muted/50 [&_img]:transition dark:[&_img]:brightness-75 dark:hover:[&_img]:brightness-100 dark:focus-visible:[&_img]:brightness-100 relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border focus-visible:ring-ring/50 outline-none focus-visible:ring-3 focus-visible:border-ring"

// A tile's own Download on the glass in its top-right corner, shown while the tile is hovered or holds focus and always on a touch screen, as a code block's copy button is.
function TileDownload({ item }: { item: ViewerItem }) {
  return (
    <div
      className={cn(
        FLOATING_BAR,
        "absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 pointer-coarse:opacity-100",
      )}
    >
      <Download className={cn("size-7", BAR_ITEM)} item={item} label={`Download ${item.name}`} />
    </div>
  )
}

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
  const { failed, missing, url } = useAttachment(item.id, Boolean(viewer?.Thumb))
  return (
    <div className="group/tile relative">
      <Hint
        content={
          missing ? `${item.name} is missing` : failed ? `${item.name} did not load` : item.name
        }
      >
        <button
          aria-label={`Open ${item.name}`}
          className={TILE}
          data-tile=""
          onClick={() => onOpen(index)}
          type="button"
        >
          {viewer?.Thumb && url ? (
            <viewer.Thumb item={item} url={url} />
          ) : (
            <span className="flex w-full min-w-0 flex-col items-center gap-2 px-2">
              <FileIcon className="size-8 shrink-0" name={item.name} />
              <span className="text-2xs w-full truncate text-center">
                {missing ? "Missing" : failed ? "Did not load" : item.name}
              </span>
            </span>
          )}
        </button>
      </Hint>
      <TileDownload item={item} />
    </div>
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
  // the tiles alone, so a tile's Download takes no arrow stop
  const tiles = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-tile]")]
  const at = tiles.indexOf(document.activeElement as HTMLButtonElement)
  const to = at === -1 ? null : focusTarget(event.key, at, tiles.length, columns)
  if (to === null) return
  event.preventDefault()
  event.stopPropagation()
  tiles[to]?.focus()
}

// One side of a lone before/after pair, its label over the picture at the card's full width in a box of fixed height, so it holds its room before the picture loads and a tall screenshot cannot stretch the card; it opens the pair in the viewer, and its corner Download saves its own file.
function WideSide({
  item,
  label,
  onOpen,
}: {
  item: ViewerItem
  label: string
  onOpen: () => void
}) {
  const { failed, missing, url } = useAttachment(item.id)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="group/tile relative">
        <button
          aria-label={`Open ${label.toLowerCase()}: ${item.name}`}
          className="focus-visible:border-ring block h-48 w-full overflow-hidden rounded-md border outline-none"
          data-tile=""
          onClick={onOpen}
          type="button"
        >
          {url ? (
            <img alt={item.name} className="size-full object-contain" src={url} />
          ) : missing || failed ? (
            <Missing failed={failed} />
          ) : null}
        </button>
        <TileDownload item={item} />
      </div>
    </div>
  )
}

// a card has no slide before or after to hand the arrows to
const stay = () => {}

// A lone HTML page live in the card at its full width, through the viewer's own HTML view (its sandboxed frame, links opened in a tab, a page that leaves put back, Spinner and Unreadable), never taking the focus, with a floating bar in its corner: Download, Open in new tab, Open in side panel where the card shows in the aside (onSidePanel), and Full screen, which opens the viewer.
function LivePage({
  item,
  onFullScreen,
  onSidePanel,
}: {
  item: ViewerItem
  onFullScreen: () => void
  onSidePanel?: () => void
}) {
  const { failed, missing, url } = useAttachment(item.id, true)
  return (
    <div className="relative flex h-80 items-center justify-center overflow-hidden rounded-md border">
      {url ? (
        <HTML_VIEWER.View active={false} item={item} onEdge={stay} url={url} />
      ) : missing || failed ? (
        <Missing failed={failed} />
      ) : null}
      <div className={cn(FLOATING_BAR, "absolute top-2 right-2")}>
        <Download className={cn("size-8", BAR_ITEM)} item={item} />
        <OpenInNewTab item={item} />
        {onSidePanel && <SidePanel onClick={onSidePanel} />}
        <FullScreen onClick={onFullScreen} />
      </div>
    </div>
  )
}

// An ask's, a draft's, a Slack decision's or a read-only update's files under its text: a lone HTML page live (LivePage), a lone before/after pair at full width, Before over After, else up to GRID_TILES thumbnails (a kind with no Thumb a titled tile, its icon over its name), then a +N tile that opens the first one it stands for; each opens at its own place (onOpen), the lone page's Full screen in the viewer (onFullScreen) and its Open in side panel in an aside tab (onSidePanel, in the aside alone), and each tile but +N saves its file, a pair's both, with its corner Download.
export function AttachmentThumbs({
  items,
  onFullScreen,
  onOpen,
  onSidePanel,
}: {
  items: ViewerItem[]
  onFullScreen?: (index: number) => void
  onOpen: (index: number) => void
  onSidePanel?: (index: number) => void
}) {
  const page = items.length === 1 && items[0]?.kind === "html" ? items[0] : undefined
  if (page)
    return (
      <div aria-label="Attached files" data-slot="attachment-thumbs" role="group">
        <LivePage
          item={page}
          onFullScreen={() => (onFullScreen ?? onOpen)(0)}
          onSidePanel={onSidePanel && (() => onSidePanel(0))}
        />
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
            data-tile=""
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

// The one component a surface drops in for a set of files: the thumbnails, and what they open: in the aside, a page, a markdown document or a PDF in an aside tab of its own, and anything else the viewer, at its place; a lone page's Full screen opens the viewer wherever it shows, and the viewer offers the aside tab too.
export function Attachments({ items: files }: { items: ViewerItem[] }) {
  const items = foldPairs(files)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const openInAside = useAsideDocs()
  const view = (at: number) => {
    setIndex(at)
    setOpen(true)
  }
  const toAside = openInAside
    ? (item: ViewerItem) => {
        setOpen(false)
        openInAside(fileDoc(item))
      }
    : undefined
  return (
    <>
      <AttachmentThumbs
        items={items}
        onFullScreen={view}
        onOpen={(at) => {
          const item = items[at]
          if (toAside && item && !item.pair && opensInAside(item.kind)) return toAside(item)
          view(at)
        }}
        onSidePanel={
          toAside &&
          ((at) => {
            const item = items[at]
            if (item) toAside(item)
          })
        }
      />
      <Viewer
        index={index}
        items={items}
        onIndexChange={setIndex}
        onOpenChange={setOpen}
        onSidePanel={toAside}
        open={open}
      />
    </>
  )
}
