export type Picture = { group?: string; kind: string; label?: "after" | "before"; name: string }

type Folded<T extends Picture> = T & { pair?: { after: T; before: T } }

// Pure: each image before and image after in one group (the nth of each) fold into one item where the earlier stood, named by the group, so the viewer shows them as one slide; the rest pass through.
export function foldPairs<T extends Picture>(items: readonly T[]): Folded<T>[] {
  const pairs = new Map<T, { after: T; before: T }>()
  const waiting = new Map<string, { after: T[]; before: T[] }>()
  for (const item of items) {
    if (item.kind !== "image" || !item.label) continue
    const key = item.group ?? ""
    const queues = waiting.get(key) ?? { after: [], before: [] }
    waiting.set(key, queues)
    const other = item.label === "before" ? queues.after : queues.before
    const match = other.shift()
    if (!match) queues[item.label].push(item)
    else
      pairs.set(
        match,
        item.label === "before" ? { after: match, before: item } : { after: item, before: match },
      )
  }
  const taken = new Set([...pairs.values()].flatMap((pair) => [pair.after, pair.before]))
  return items.flatMap((item): Folded<T>[] => {
    const pair = pairs.get(item)
    if (pair)
      return [
        {
          ...pair.before,
          label: undefined,
          name: pair.before.group ?? `${pair.before.name} · ${pair.after.name}`,
          pair,
        },
      ]
    return taken.has(item) ? [] : [item]
  })
}

const COMPARE_STEP = 5

const clamp = (value: number): number => Math.min(Math.max(value, 0), 100)

// Pure: the compare slider's next position for a key, or null when the key is not the slider's; Up and Down stay the viewer's, for the next slide.
export function compareKey(position: number, key: string): number | null {
  if (key === "ArrowRight") return clamp(position + COMPARE_STEP)
  if (key === "ArrowLeft") return clamp(position - COMPARE_STEP)
  if (key === "Home") return 0
  if (key === "End") return 100
  return null
}

// Pure: the compare slider's position under a pointer, as a percent of the box.
export const comparePointer = (clientX: number, box: { left: number; width: number }): number =>
  box.width > 0 ? clamp(((clientX - box.left) / box.width) * 100) : 50

export const ZOOM = 2

type Box = { height: number; width: number }
type Point = { x: number; y: number }

const within = (value: number, low: number) => Math.min(Math.max(value, low), 0)

// Pure: a zoomed picture's offset, kept so the picture still covers its box.
export const panBy = (offset: Point, delta: Point, box: Box): Point => ({
  x: within(offset.x + delta.x, box.width * (1 - ZOOM)),
  y: within(offset.y + delta.y, box.height * (1 - ZOOM)),
})

// Pure: the offset that zooms in with the clicked point kept under the pointer.
export const zoomAt = (point: Point, box: Box): Point =>
  panBy({ x: 0, y: 0 }, { x: point.x * (1 - ZOOM), y: point.y * (1 - ZOOM) }, box)
