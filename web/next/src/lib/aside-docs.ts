import type { InboxAttachment, InboxAttachmentKind } from "@api/hono"

// A page or a document opened in the aside: an Inbox card's file, or a kept page from Previews by its address.
export type AsideDoc = { key: string; name: string } & ({ item: InboxAttachment } | { url: string })

// An open document's aside tab, by its key.
export type DocTab = `doc:${string}`

export const docTab = (doc: Pick<AsideDoc, "key">): DocTab => `doc:${doc.key}`

// The kinds a card's file opens in an aside tab: a page, a markdown document and a PDF; an image and a code file keep the full-screen viewer.
const OPENS_IN_ASIDE: readonly InboxAttachmentKind[] = ["doc", "html", "pdf"]

export const opensInAside = (kind: InboxAttachmentKind): boolean => OPENS_IN_ASIDE.includes(kind)

export const fileDoc = (item: InboxAttachment): AsideDoc => ({
  item,
  key: `file-${item.id}`,
  name: item.name,
})

export const pageDoc = (name: string, title: string, url: string): AsideDoc => ({
  key: `page-${name}`,
  name: title,
  url,
})

// Pure: the open documents after one more opens, and the tab to focus; a document already open keeps its one tab, which takes the focus.
export const openDoc = (docs: AsideDoc[], doc: AsideDoc): { docs: AsideDoc[]; tab: DocTab } => ({
  docs: docs.some((open) => open.key === doc.key) ? docs : [...docs, doc],
  tab: docTab(doc),
})

// Pure: the open documents once a tab closes.
export const closeDoc = (docs: AsideDoc[], tab: DocTab): AsideDoc[] =>
  docs.filter((doc) => docTab(doc) !== tab)
