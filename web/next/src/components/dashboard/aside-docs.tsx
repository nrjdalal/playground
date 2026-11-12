"use client"

import { RiCloseLine, RiFileLine, RiHtml5Line } from "@remixicon/react"
import { cn } from "cn"
import { createContext, useContext, useState } from "react"

import { type ViewerItem, VIEWERS } from "@/components/dashboard/viewer/registry"
import { useAttachment } from "@/components/dashboard/viewer/use-attachment-url"
import {
  Download,
  FullScreen,
  Missing,
  OpenInNewTab,
  Viewer,
} from "@/components/dashboard/viewer/viewer"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import type { AsideDoc } from "@/lib/aside-docs"
import { BAR_ITEM, FLOATING_BAR } from "@/lib/floating-bar"

// Opens a page or a document in an aside tab of its own; null outside the aside, where a card's file keeps the full-screen viewer.
export const AsideDocs = createContext<((doc: AsideDoc) => void) | null>(null)

export const useAsideDocs = () => useContext(AsideDocs)

const SQUARE = cn("size-8", BAR_ITEM)

// a document's pane has no slide before or after to hand the arrows to
const stay = () => {}

// Pure: an open document as the viewer shows it: a card's file as it is, a kept page as an HTML file that loads from its own address and saves from the one that downloads it.
export const docItem = (doc: AsideDoc): ViewerItem =>
  "item" in doc
    ? doc.item
    : {
        id: doc.key,
        kind: "html",
        name: doc.name,
        page: { download: doc.download, url: doc.url },
      }

function DocBody({ item }: { item: ViewerItem }) {
  const { failed, missing, url } = useAttachment(item.id, true, item.page?.url)
  const View = VIEWERS[item.kind]?.View
  if (missing || failed) return <Missing failed={failed} />
  return url && View ? <View active={false} item={item} onEdge={stay} url={url} /> : null
}

// An open document's square: its kind's icon in the viewer, a kept page's the HTML one.
export function AsideDocsIcon({ doc }: { doc: AsideDoc }) {
  const Icon = "item" in doc ? (VIEWERS[doc.item.kind]?.icon ?? RiFileLine) : RiHtml5Line
  return <Icon />
}

// An open document's pane: a card's file, or a kept page, through the viewer's own renderer (a page in the HTML view's sandboxed frame, its links opening in a browser tab and a page that leaves put back), filling the pane in a bordered box, with a floating bar in its corner, the look and size of a card's live page: Download, Open in new tab for a page, an image or a PDF, Full screen, which opens the viewer over the page, and Close, which closes the tab.
export function AsideDocsPane({ doc, onClose }: { doc: AsideDoc; onClose: () => void }) {
  const item = docItem(doc)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-md border">
      <DocBody item={item} />
      <div className={cn(FLOATING_BAR, "absolute top-2 right-2")}>
        <Download className={SQUARE} item={item} />
        <OpenInNewTab item={item} />
        <FullScreen onClick={() => setOpen(true)} />
        <Hint content="Close" description={null}>
          <Button
            aria-label="Close"
            className={SQUARE}
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <RiCloseLine />
          </Button>
        </Hint>
      </div>
      {/* the page already shows in its tab, so the viewer's Open in side panel comes back to it */}
      <Viewer
        index={0}
        items={[item]}
        onIndexChange={stay}
        onOpenChange={setOpen}
        onSidePanel={() => setOpen(false)}
        open={open}
      />
    </div>
  )
}
