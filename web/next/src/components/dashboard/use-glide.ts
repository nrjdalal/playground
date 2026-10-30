"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  behind,
  behindLabel,
  CATCH_UP_S,
  endOf,
  glideState,
  glideTo,
  labelDue,
  lineFor,
  liveHolds,
  liveStart,
  MESSAGE_REST_MS,
  paceOf,
  READING_WPM,
  spansOf,
  stepTo,
  STREAM_SCROLL,
  type RowSpan,
} from "@/components/dashboard/chat-scroll"

// What the glide knows of a row from its data, by the row's message id: its words and whether it rests at the top.
export type RowFacts = { rests: boolean; words: number }

// A row's place in the content, from the ResizeObserver's cache, with the tops of the steps it rests at ([data-rests], a turn's words).
type Place = { height: number; id: string; rests: number[]; top: number }

// The longest step a frame takes, so a tab that comes back from hiding is judged afresh rather than jumped by the time it was away.
const MAX_FRAME_MS = 100

// Watching at reading speed: one requestAnimationFrame loop, running only while there is something below the view, writes the stream's scrollTop at the pace paceOf gives for the words not yet passed, resting at each new message, yielding to his pointer, his selection and his own scroll down. Row places come from a ResizeObserver cache and their words from the rows' data, so no frame reads the layout of a row; the view's own scroll box is read once a frame. It runs only while on is true.
export function useGlide({
  box,
  content,
  facts,
  on,
  onWrite,
  pace,
}: {
  box: () => HTMLElement | null
  content: () => HTMLElement | null
  facts: () => ReadonlyMap<string, RowFacts>
  on: boolean
  // each scrollTop it writes, as it writes it, so a change in size before that write's scroll event is judged from where the glide put the view
  onWrite?: (top: number) => void
  pace: number
}) {
  const [label, setLabel] = useState<ReturnType<typeof behindLabel>>(() => behindLabel(0))
  const places = useRef<Place[]>([])
  const frame = useRef(0)
  const lastAt = useRef<number | null>(null)
  const pos = useRef<number | null>(null)
  const wrote = useRef<number | null>(null)
  const restUntil = useRef<number | null>(null)
  const downAt = useRef<number | null>(null)
  const pressed = useRef({ pointer: false, selection: false })
  const releasedAt = useRef<number | null>(null)
  const liveAt = useRef<number | null>(null)
  const movedAt = useRef<number | null>(null)
  const labelAt = useRef(Number.NEGATIVE_INFINITY)
  const paceRef = useRef(pace)
  paceRef.current = pace
  const onRef = useRef(on)
  onRef.current = on
  const onWriteRef = useRef(onWrite)
  onWriteRef.current = onWrite
  // whether he asks for reduced motion, kept current by its query rather than read each frame
  const reducedMotion = useRef(false)
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)")
    const read = () => {
      reducedMotion.current = query.matches
    }
    read()
    query.addEventListener("change", read)
    return () => query.removeEventListener("change", read)
  }, [])

  const spans = useCallback((): RowSpan[] => spansOf(places.current, facts()), [facts])

  const tick = useCallback(
    (at: number) => {
      frame.current = 0
      const view = box()
      if (!view || !onRef.current) return
      const dt = lastAt.current === null ? 0 : Math.min(MAX_FRAME_MS, at - lastAt.current)
      lastAt.current = at
      const now = performance.now()
      const top = view.scrollTop
      // moved by anyone else (his scroll, the browser keeping what is in view as rows drop above): go on from there
      if (pos.current === null || wrote.current === null || Math.abs(top - wrote.current) > 1) {
        pos.current = top
      }
      const max = Math.max(0, view.scrollHeight - view.clientHeight)
      const rows = spans()
      const below = behind(rows, pos.current + view.clientHeight)
      const pixels = Math.max(0, max - pos.current)
      const step = paceOf({ pace: paceRef.current, pixels, words: below.words })
      const state = glideState({
        downAt: downAt.current,
        now,
        pressed: pressed.current.pointer || pressed.current.selection,
        releasedAt: releasedAt.current,
        restUntil: restUntil.current,
      }).state
      const caughtUp = pixels <= 0.5 || endOf(view)
      if (labelDue({ caughtUp, sinceLast: now - labelAt.current, state })) {
        labelAt.current = now
        const next = behindLabel(caughtUp ? 0 : step.seconds)
        setLabel((was) => (was.text === next.text ? was : next))
      }
      if (caughtUp) {
        lastAt.current = null
        liveAt.current = null
        return
      }
      const live = liveHolds({
        liveAt: liveAt.current,
        movedAt: movedAt.current,
        now,
        top,
        wrote: wrote.current,
      })
      movedAt.current = live.movedAt
      if (!live.holds) liveAt.current = null
      if (state === "moving" && !live.holds) {
        const reduced = reducedMotion.current
        const margin = STREAM_SCROLL.scrollMargin
        let to: number
        if (step.jump) {
          to = Math.max(
            0,
            lineFor(rows, (CATCH_UP_S * READING_WPM * paceRef.current) / 60) - view.clientHeight,
          )
        } else {
          const by = Number.isFinite(step.pxPerS) ? (step.pxPerS * dt) / 1000 : pixels
          const glide = glideTo({ by, from: pos.current, margin, max, rows })
          if (glide.restAt) restUntil.current = now + MESSAGE_REST_MS
          to = glide.to
        }
        pos.current = to
        const shown = reduced ? stepTo({ at: to, margin, max, rows }) : to
        if (Math.abs(shown - top) > 0.25) {
          view.scrollTop = shown
          wrote.current = view.scrollTop
          onWriteRef.current?.(wrote.current)
        } else wrote.current = top
      } else wrote.current = top
      frame.current = requestAnimationFrame(tick)
    },
    [box, spans],
  )

  // starts the loop when it is not running: on turning Watching, on rows landing or growing, and on his letting go
  const wake = useCallback(() => {
    if (!onRef.current || frame.current) return
    lastAt.current = null
    frame.current = requestAnimationFrame(tick)
  }, [tick])

  // the row places, read only when a row or the content changes size, and the loop woken for what landed
  useEffect(() => {
    const host = content()
    const view = box()
    if (!host || !view) return
    const measure = () => {
      const outer = view.getBoundingClientRect()
      const offset = view.scrollTop - outer.top
      places.current = [...host.children].flatMap((child) => {
        if (!(child instanceof HTMLElement) || !child.dataset.messageId) return []
        const rect = child.getBoundingClientRect()
        const rests = [...child.querySelectorAll("[data-rests]")].map(
          (step) => step.getBoundingClientRect().top + offset,
        )
        return [{ height: rect.height, id: child.dataset.messageId, rests, top: rect.top + offset }]
      })
      wake()
    }
    const sized = new ResizeObserver(measure)
    const watch = () => {
      for (const child of host.children) sized.observe(child)
    }
    watch()
    sized.observe(host)
    const added = new MutationObserver(() => {
      watch()
      measure()
    })
    added.observe(host, { childList: true })
    return () => {
      sized.disconnect()
      added.disconnect()
    }
  }, [box, content, wake])

  // a pointer held on the stream, or text selected in it, pauses the glide until a second after it ends
  useEffect(() => {
    const view = box()
    if (!view) return
    const release = () => {
      if (pressed.current.pointer || pressed.current.selection) return
      releasedAt.current = performance.now()
      wake()
    }
    const down = () => {
      pressed.current.pointer = true
    }
    const up = () => {
      if (!pressed.current.pointer) return
      pressed.current.pointer = false
      release()
    }
    const selected = () => {
      const selection = document.getSelection()
      const inside = Boolean(
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        view.contains(selection.anchorNode),
      )
      if (inside === pressed.current.selection) return
      pressed.current.selection = inside
      if (!inside) release()
    }
    view.addEventListener("pointerdown", down)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    document.addEventListener("selectionchange", selected)
    const shown = () => {
      if (document.visibilityState === "visible") wake()
    }
    document.addEventListener("visibilitychange", shown)
    return () => {
      view.removeEventListener("pointerdown", down)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      document.removeEventListener("selectionchange", selected)
      document.removeEventListener("visibilitychange", shown)
    }
  }, [box, wake])

  useEffect(() => {
    if (on) wake()
    else {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      pos.current = null
      wrote.current = null
    }
    return () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [on, wake])

  return {
    label,
    // his scroll up: the loop stops in this frame, before the render that turns Reading, so no frame writes the view down after his hand
    stop: useCallback(() => {
      onRef.current = false
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }, []),
    // his own scroll down: the glide takes his place as its own and waits HAND_RESUME_MS
    yieldTo: useCallback(() => {
      downAt.current = performance.now()
      pos.current = null
      wake()
    }, [wake]),
    // whether a scroll the stream saw is the glide's own write
    ownScroll: useCallback(
      (top: number) => wrote.current !== null && Math.abs(top - wrote.current) <= 1,
      [],
    ),
    // a jump to live: the glide waits while the click's own glide to the end runs
    toLive: useCallback(
      (smooth: boolean) => {
        liveAt.current = liveStart({
          now: performance.now(),
          reduced: reducedMotion.current,
          smooth,
        })
        movedAt.current = null
        restUntil.current = null
        pos.current = null
        wake()
      },
      [wake],
    ),
    // whether the glide is behind, for Scroll to end
    behindNow: label.band === "behind",
  }
}
