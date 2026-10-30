"use client"

import type { ChangelogEntry } from "@api/hono"

import { TranscriptMarkdown } from "@/components/transcript-markdown"
import { KIND_ICONS, KIND_LABELS, linkLabel } from "@/plugins/changelog/columns"
import { issueParts, linkIssues, repoOfEntry } from "@/plugins/changelog/groups"
import { imageUrl } from "@/plugins/changelog/unread"

const fullWhen = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

// One entry in full: its line, kind, time and link, then what changed as a few lines of Markdown, rendered as a transcript's text is so nothing loads from elsewhere, and its screenshots when it has them.
export function Detail({ entry }: { entry: ChangelogEntry }) {
  const Icon = KIND_ICONS[entry.kind]
  // each #<n> in the line and the detail opens that issue
  const repo = repoOfEntry(entry)
  return (
    <article aria-labelledby="changelog-entry" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="changelog-entry" className="text-sm font-medium">
          {issueParts(entry.text, repo).map((part, i) =>
            part.href ? (
              <a
                key={i}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {part.text}
              </a>
            ) : (
              part.text
            ),
          )}
        </h2>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Icon className="size-4" aria-hidden />
          {KIND_LABELS[entry.kind]} · {fullWhen(entry.at)}
          {entry.link && (
            <>
              {" · "}
              <a
                href={entry.link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {linkLabel(entry.link)}
              </a>
            </>
          )}
        </p>
      </header>
      {entry.detail && (
        // a wrapped list item hangs under its own text, not under its bullet, since the aside is narrow
        <div className="text-sm [&_ol]:list-outside [&_ol]:pl-5 [&_ul]:list-outside [&_ul]:pl-4">
          <TranscriptMarkdown>{linkIssues(entry.detail, repo)}</TranscriptMarkdown>
        </div>
      )}
      {entry.images.map((image) => {
        const src = imageUrl(image.id)
        if (!src) return null
        return (
          <figure key={image.id} className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={image.alt}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              className="h-auto max-w-full rounded-md border"
            />
            <figcaption className="text-muted-foreground text-xs">{image.alt}</figcaption>
          </figure>
        )
      })}
    </article>
  )
}
