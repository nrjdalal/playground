"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { config } from "@/lib/config"

// The version a reload was made for, in this tab's sessionStorage, so a reload that lands on the same mismatch never reloads again.
export const BUILD_RELOAD_KEY = "dashboard.build.reloadedFor.v1"

const BUILD_QUERY_KEY = ["dashboard", "build-version"] as const
const BUILD_POLL_MS = 30_000
const WAIT_MS = 2_000

export type BuildReload = "reload" | "stay" | "wait"

// Pure: what the page does when the API names version current: it reloads once onto a build other than the one it loaded against (loaded, the API's version at its first read), never twice for one version (reloadedFor), so a version that keeps differing never loops, and waits while the owner types (busy).
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

// A field the owner is typing in: the focused input, textarea or editable element while it holds text, which a reload would lose (the composer keeps its draft in localStorage, but the reload still waits until it is sent or emptied).
const typing = (): boolean => {
  const field = document.activeElement
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)
    return field.value.trim() !== ""
  return field instanceof HTMLElement && field.isContentEditable && !!field.textContent?.trim()
}

const reloadedFor = (): string | null => {
  try {
    return sessionStorage.getItem(BUILD_RELOAD_KEY)
  } catch {
    return null
  }
}

// Reloads the page once when a roll serves a new build: the live Dashboard's production build has no dev socket, so an open tab would keep its old build against the new API. It reads /api/health every 30s and on focus; the outbox keeps queued messages across the reload in sessionStorage.
export function useBuildReload(): void {
  const { data } = useQuery({
    queryKey: BUILD_QUERY_KEY,
    queryFn: readVersion,
    refetchInterval: BUILD_POLL_MS,
    retry: false,
  })
  const loaded = useRef<string | null>(null)
  useEffect(() => {
    if (!data) return
    if (loaded.current === null) {
      loaded.current = data
      return
    }
    const check = () => {
      const next = buildReload({
        busy: typing(),
        current: data,
        loaded: loaded.current,
        reloadedFor: reloadedFor(),
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
