import { config } from "@/lib/config"
import { transcriptLink } from "@/lib/markdown"

// A message's links under its text, untrusted as the text is: each passes transcriptLink, so only http or https opens, on a click, another site's in a new tab with no opener or referrer, and anything else shows as its words.
export function MessageLinks({ links }: { links?: string[] }) {
  if (!links?.length) return null
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs">
      {links.map((href, index) => {
        const link = transcriptLink(href, config.app.url)
        return (
          <li key={`${index}-${href}`} className="min-w-0 truncate">
            {link ? (
              <a
                className="text-primary underline"
                href={link.href}
                {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
              >
                {href}
              </a>
            ) : (
              <span className="text-muted-foreground">{href}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
