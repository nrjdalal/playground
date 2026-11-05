"use client"

import { RiCloseLine, RiFileLine, RiHtml5Line } from "@remixicon/react"
import { cn } from "cn"
import { createContext, useContext } from "react"

import { VIEWERS } from "@/components/dashboard/viewer/registry"
import { useAttachment } from "@/components/dashboard/viewer/use-attachment-url"
import { Download, Missing } from "@/components/dashboard/viewer/viewer"
import { Button } from "@/components/ui/button"
import type { AsideDoc } from "@/lib/aside-docs"
import { BAR_ITEM, FLOATING_BAR } from "@/lib/floating-bar"

// Opens a page or a document in an aside tab of its own; null outside the aside, where a card's file keeps the full-screen viewer.
export const AsideDocs = createContext<((doc: AsideDoc) => void) | null>(null)

export const useAsideDocs = () => useContext(AsideDocs)

const SQUARE = cn("size-8", BAR_ITEM)

// a document's pane has no slide before or after to hand the arrows to
const stay = () => {}

function FileBody({ item }: { item: Extract<AsideDoc, { item: unknown }>["item"] }) {
  const { missing, url } = useAttachment(item.id, true)
  const View = VIEWERS[item.kind]?.View
  if (missing) return <Missing />
  return url && View ? <View active={false} item={item} onEdge={stay} url={url} /> : null
}

// An open document's square: its kind's icon in the viewer, a kept page's the HTML one.
export function AsideDocsIcon({ doc }: { doc: AsideDoc }) {
  const Icon = "item" in doc ? (VIEWERS[doc.item.kind]?.icon ?? RiFileLine) : RiHtml5Line
  return <Icon />
}

// An open document's pane: the file through the viewer's own renderer, or a kept page in a frame that runs its own script with no origin of its own, so it reads none of the API's cookies, filling the pane in a bordered box, with a floating bar in its corner that saves a card's file and closes the tab, the look and size of a card's live page.
export function AsideDocsPane({ doc, onClose }: { doc: AsideDoc; onClose: () => void }) {
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-md border">
      {"item" in doc ? (
        <FileBody item={doc.item} />
      ) : (
        <iframe
          className="size-full border-0 bg-white"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          src={doc.url}
          title={doc.name}
        />
      )}
      <div className={cn(FLOATING_BAR, "absolute top-2 right-2")}>
        {"item" in doc && <Download className={SQUARE} item={doc.item} />}
        <Button
          aria-label={`Close ${doc.name}`}
          className={SQUARE}
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <RiCloseLine />
        </Button>
      </div>
    </div>
  )
}
