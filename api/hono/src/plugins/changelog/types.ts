// What the Changelog plugin shares with the web: one entry as the API serves it.
export type ChangelogKind = "feature" | "fix" | "ops" | "release" | "rule" | "setting"

// A screenshot the sync copied into the owner-only changelog folder, by the id the API serves it under, as an entry stores it.
export type ChangelogImage = { alt: string; id: string }

// A screenshot as the API serves it: with its size in pixels, read from the file, so the page holds its box before it loads; null when the file is gone or its header does not read.
export type ShownImage = ChangelogImage & { height: number | null; width: number | null }

export type ChangelogEntry = {
  id: string
  actor: string
  at: string
  createdAt: string
  detail: string | null
  images: ShownImage[]
  kind: ChangelogKind
  link: string | null
  // What the entry came from (`pr:owner/name#253`, `release:v0.0.9`, `rule:<key>`), null for a line added by hand; the page names an entry in its links by it.
  sourceKey: string | null
  text: string
}
