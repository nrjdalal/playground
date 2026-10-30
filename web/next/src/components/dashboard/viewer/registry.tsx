"use client"

import type { InboxAttachment, InboxAttachmentKind } from "@api/hono"
import type { RemixiconComponentType } from "@remixicon/react"
import type { FC } from "react"

import {
  CODE_VIEWER,
  DOC_VIEWER,
  HTML_VIEWER,
  PDF_VIEWER,
} from "@/components/dashboard/viewer/documents"
import { IMAGE_VIEWER } from "@/components/dashboard/viewer/image"

// A file an ask carries, as the viewer and the card's thumbnails show it; a before and an after folded into one slide carry both (foldPairs).
export type ViewerItem = InboxAttachment & {
  pair?: { after: InboxAttachment; before: InboxAttachment }
}

export type ThumbProps = { item: ViewerItem; url: string }

// active: this slide is the one shown. onEdge hands the arrows back to the viewer from a renderer that keeps its own keys (an HTML page): -1 for the previous slide, 1 for the next.
export type ViewProps = {
  active: boolean
  item: ViewerItem
  onEdge: (direction: -1 | 1) => void
  url: string
}

// How one kind shows: its icon where a slide has no file to show yet, and its full-size View. A View that owns its pointer events (zoom and pan, a page) puts data-viewer-owns-pointer on its root, so a drag there never swipes the slide.
export type KindViewer = {
  icon: RemixiconComponentType
  Thumb?: FC<ThumbProps>
  View: FC<ViewProps>
}

// One line a kind.
export const VIEWERS: Partial<Record<InboxAttachmentKind, KindViewer>> = {
  code: CODE_VIEWER,
  doc: DOC_VIEWER,
  html: HTML_VIEWER,
  image: IMAGE_VIEWER,
  pdf: PDF_VIEWER,
}
