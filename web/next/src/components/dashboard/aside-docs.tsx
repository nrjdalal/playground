"use client"

import { RiCloseLine, RiFileLine, RiHtml5Line } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { createContext, useContext } from "react"

import { HTML_VIEWER } from "@/components/dashboard/viewer/documents"
import { VIEWERS } from "@/components/dashboard/viewer/registry"
import { MISSING, useAttachment } from "@/components/dashboard/viewer/use-attachment-url"
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

// The query for a kept page from Previews, fetched with the owner's cookie into a blob URL as a card's file is (attachmentQuery), once for the page's life, since the HTML view reads its text with a fetch that sends none. load is fetch, a test's stand-in aside.
export const pageQuery = (url: string, load: typeof fetch = fetch) => ({
  gcTime: Number.POSITIVE_INFINITY,
  queryFn: async (): Promise<string> => {
    const response = await load(url, { credentials: "include" })
    if (response.status === 404) return MISSING
    if (!response.ok) throw new Error(`The page did not load (${response.status})`)
    return URL.createObjectURL(await response.blob())
  },
  queryKey: ["aside-page", url],
  staleTime: Number.POSITIVE_INFINITY,
})

function FileBody({ item }: { item: Extract<AsideDoc, { item: unknown }>["item"] }) {
  const { missing, url } = useAttachment(item.id, true)
  const View = VIEWERS[item.kind]?.View
  if (missing) return <Missing />
  return url && View ? <View active={false} item={item} onEdge={stay} url={url} /> : null
}

function PageBody({ doc }: { doc: Extract<AsideDoc, { url: string }> }) {
  const { data } = useQuery(pageQuery(doc.url))
  if (data === MISSING) return <Missing />
  const item = { id: doc.key, kind: "html" as const, name: doc.name }
  return data ? <HTML_VIEWER.View active={false} item={item} onEdge={stay} url={data} /> : null
}

// An open document's square: its kind's icon in the viewer, a kept page's the HTML one.
export function AsideDocsIcon({ doc }: { doc: AsideDoc }) {
  const Icon = "item" in doc ? (VIEWERS[doc.item.kind]?.icon ?? RiFileLine) : RiHtml5Line
  return <Icon />
}

// An open document's pane: a card's file, or a kept page, through the viewer's own renderer (a page in the HTML view's sandboxed frame, its links opening in a browser tab and a page that leaves put back), filling the pane in a bordered box, with a floating bar in its corner that saves a card's file and closes the tab, the look and size of a card's live page.
export function AsideDocsPane({ doc, onClose }: { doc: AsideDoc; onClose: () => void }) {
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-md border">
      {"item" in doc ? <FileBody item={doc.item} /> : <PageBody doc={doc} />}
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
