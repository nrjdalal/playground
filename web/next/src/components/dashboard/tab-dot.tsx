"use client"

import { useEffect, useState } from "react"

import { useDashboard } from "@/components/dashboard/dashboard"
import { useInbox } from "@/lib/inbox"
import { DOT, newInInbox, showsDot, TAB_DOT_POLLING, useMark, type DotSources } from "@/lib/tab-dot"
import { useAppUnread } from "@/plugins/registry"

// The plain favicon with the red dot in its top right corner (DOT), drawn once from the icon the page links, in the theme's destructive red; null when the icon cannot be drawn.
async function dottedIcon(href: string): Promise<string | null> {
  const image = new Image()
  image.src = href
  try {
    await image.decode()
  } catch {
    return null
  }
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = DOT.size
  const context = canvas.getContext("2d")
  if (!context) return null
  context.drawImage(image, 0, 0, DOT.size, DOT.size)
  // the ring is cut out of the icon, so the tab bar shows through it
  context.globalCompositeOperation = "destination-out"
  context.beginPath()
  context.arc(DOT.x, DOT.y, DOT.r + DOT.ring, 0, 2 * Math.PI)
  context.fill()
  context.globalCompositeOperation = "source-over"
  context.beginPath()
  context.arc(DOT.x, DOT.y, DOT.r, 0, 2 * Math.PI)
  context.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue("--destructive").trim() || "red"
  context.fill()
  return canvas.toDataURL("image/png")
}

// What is new for you, by source (lib/tab-dot.ts has the rule): an unread Changelog entry, from the count the Changelog's square shows; or an inbox item after your last look at the inbox. The dashboard view writes that look; the tab's dot and each source's own read this.
export function useDotSources(): DotSources {
  const { allowed } = useDashboard()
  // a hidden tab is when the dot matters most, so its reads poll there too
  const changelog = useAppUnread(allowed, TAB_DOT_POLLING.background)("changelog")
  const items = useInbox(allowed, TAB_DOT_POLLING).data?.items ?? []
  const inboxSeenAt = useMark("inbox")
  return {
    changelog: allowed && changelog > 0,
    inbox: allowed && newInInbox(items, inboxSeenAt),
  }
}

// The tab's favicon wears a red dot while any source has something new for you (useDotSources). It draws nothing in the page.
export function TabDot() {
  const dot = showsDot(useDotSources())
  const [dotted, setDotted] = useState<{ href: string; url: string } | null>(null)

  // leaving the Dashboard for a page outside it puts every plain icon back
  useEffect(
    () => () => {
      for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (link.dataset.plain) link.href = link.dataset.plain
      }
    },
    [],
  )

  useEffect(() => {
    // each icon link keeps its plain href in data-plain, and takes the dotted one while the dot shows
    const apply = () => {
      const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
      for (const link of links) link.dataset.plain ??= link.href
      const href = links[0]?.dataset.plain
      const url = dot && dotted && dotted.href === href ? dotted.url : null
      for (const link of links) {
        const want = url ?? link.dataset.plain ?? link.href
        if (link.href !== want) link.href = want
      }
      return href
    }
    const href = apply()
    let current = true
    if (dot && href && dotted?.href !== href) {
      void dottedIcon(href).then((url) => {
        if (current && url) setDotted({ href, url })
      })
    }
    // Next puts its own icon links back on a navigation, so a link it adds or resets is set again
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { attributeFilter: ["href"], childList: true, subtree: true })
    return () => {
      current = false
      observer.disconnect()
    }
  }, [dot, dotted])

  return null
}
