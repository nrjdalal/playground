"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { config } from "@/lib/config"
import type { OutboxMessage } from "@/lib/outbox"

// The version a reload was made for, in this tab's sessionStorage, so a reload that lands on the same mismatch never reloads again.
export const BUILD_RELOAD_KEY = "dashboard.build.reloadedFor.v1"

const BUILD_QUERY_KEY = ["dashboard", "build-version"] as const
const BUILD_POLL_MS = 30_000
const WAIT_MS = 2_000

export type BuildReload = "reload" | "stay" | "wait"

// Pure: what the page does when the API names version current: it reloads once onto a build other than the one it loaded against (loaded, the API's version at its first read), never twice for one version (reloadedFor), so a version that keeps differing never loops, and waits while a field holds typed words or a failed message shows (busy).
export function buildReload({
  busy,
  current,
  loaded,
  reloadedFor,
}: {
  busy: boolean
  current: string | null
  loaded: string | null
  reloadedFor: string | null
}): BuildReload {
  if (!current || !loaded || current === loaded || current === reloadedFor) return "stay"
  return busy ? "wait" : "reload"
}

// Pure: whether the outbox shows words a reload would lose: a failed message, which waits on the owner's Retry and is never kept in the tab's storage, while a queued or sending one is resent under its own id.
export const holdsText = (outbox: readonly Pick<OutboxMessage, "state">[]): boolean =>
  outbox.some((m) => m.state === "failed")

// Pure: the version a /api/health body names, or null for any other body.
export const versionOf = (body: unknown): string | null => {
  const version = (body as { data?: { version?: unknown } } | null)?.data?.version
  return typeof version === "string" && version ? version : null
}

const readVersion = async (): Promise<string | null> => {
  const response = await fetch(`${config.api.url}/api/health`, { cache: "no-store" })
  if (!response.ok) throw new Error(`health answered ${response.status}`)
  return versionOf(await response.json())
}

// The attribute on an element whose typed words live in its fields alone (an Inbox card's reply, comment and draft), so a reload waits on them; the composer keeps its own draft, and the app fills a field such as the preview's Address itself.
export const HOLDS_RELOAD = "data-holds-reload"

// Pure: whether a field the owner typed into still shows words a reload would lose (atRisk: inside HOLDS_RELOAD), focused or not; one emptied, or gone with its card, lets the reload go.
export const holdsTyped = (
  fields: Iterable<{ atRisk: boolean; isConnected: boolean; text: string }>,
): boolean => {
  for (const field of fields)
    if (field.atRisk && field.isConnected && field.text.trim()) return true
  return false
}

// A field that takes words: a textarea, an editable element, or an input whose type is typed into, never a choice (a checkbox's value reads "on").
const TEXT_INPUTS = new Set(["email", "password", "search", "tel", "text", "url"])
const takesWords = (field: EventTarget | null): field is HTMLElement =>
  field instanceof HTMLTextAreaElement ||
  (field instanceof HTMLInputElement && TEXT_INPUTS.has(field.type)) ||
  (field instanceof HTMLElement && !(field instanceof HTMLInputElement) && field.isContentEditable)

const textOf = (field: HTMLElement): string =>
  field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    ? field.value
    : (field.textContent ?? "")

const storedReload = (): string | null => {
  try {
    return sessionStorage.getItem(BUILD_RELOAD_KEY)
  } catch {
    return null
  }
}

// Reloads the page once when a roll serves a new build: the live Dashboard's production build has no dev socket, so an open tab would keep its old build against the new API. It reads /api/health every 30s and on focus; the outbox keeps queued messages across the reload in sessionStorage, and the reload waits while a failed one shows or a field inside HOLDS_RELOAD holds words the owner typed.
export function useBuildReload(outbox: readonly OutboxMessage[]): void {
  const { data } = useQuery({
    queryKey: BUILD_QUERY_KEY,
    queryFn: readVersion,
    refetchInterval: BUILD_POLL_MS,
    retry: false,
  })
  const loaded = useRef<string | null>(null)
  const held = useRef(false)
  held.current = holdsText(outbox)
  // every field the owner has typed into, by its own input events, since React keeps a controlled field's defaultValue equal to its value
  const typed = useRef(new Set<HTMLElement>())
  useEffect(() => {
    const mark = (event: Event) => {
      if (takesWords(event.target)) typed.current.add(event.target)
    }
    document.addEventListener("input", mark, true)
    return () => document.removeEventListener("input", mark, true)
  }, [])
  useEffect(() => {
    if (!data) return
    if (loaded.current === null) {
      loaded.current = data
      return
    }
    const check = () => {
      for (const field of typed.current) if (!field.isConnected) typed.current.delete(field)
      const next = buildReload({
        busy:
          held.current ||
          holdsTyped(
            [...typed.current].map((field) => ({
              atRisk: !!field.closest(`[${HOLDS_RELOAD}]`),
              isConnected: field.isConnected,
              text: textOf(field),
            })),
          ),
        current: data,
        loaded: loaded.current,
        reloadedFor: storedReload(),
      })
      if (next === "reload") {
        try {
          sessionStorage.setItem(BUILD_RELOAD_KEY, data)
        } catch {}
        window.location.reload()
      }
      return next
    }
    if (check() !== "wait") return
    const timer = setInterval(() => {
      if (check() !== "wait") clearInterval(timer)
    }, WAIT_MS)
    return () => clearInterval(timer)
  }, [data])
}
