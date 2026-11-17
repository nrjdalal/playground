import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { ApiError } from "@/lib/error"

// The makers whose icons the dashboard draws, from config alone: each backend's (Claude's Anthropic, GLM's Z.ai), then the Hugging Face org of each local model's repo id (org/repo); a bare id names no maker.
export const BACKEND_MAKERS = ["anthropic", "zai"] as const

export const makersOf = (local: readonly { id: string }[]): Set<string> =>
  new Set([
    ...BACKEND_MAKERS,
    ...local.flatMap(({ id }) => {
      const org = id.split("/")[0]
      return id.includes("/") && org && isMaker(org) ? [org] : []
    }),
  ])

// A maker's name as models.dev and Hugging Face spell one: a plain name, never a path, so it can name a cache file and a URL segment.
const MAKER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
export const isMaker = (maker: string): boolean => MAKER.test(maker)

export type Fetch = (url: string) => Promise<Response>

export type ModelIcon = { bytes: Uint8Array<ArrayBuffer>; type: IconType }

type IconType = "image/jpeg" | "image/png" | "image/svg+xml" | "image/webp"

const EXT: Record<IconType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
}

const MODELS_DEV = "https://models.dev/logos"
// A provider id models.dev cannot hold: it answers any unknown id with one fallback SVG (1421 bytes, measured) and 200, so this one's body is that fallback, whatever its size.
const SENTINEL = "playground-no-such-maker"
const MAX_BYTES = 1024 * 1024
// How long a maker found to have no icon stays so before it is asked again, so an icon added later still arrives.
const NONE_FOR_MS = 24 * 60 * 60 * 1000

// Only the maker's name leaves the machine, and a redirect is refused, so no answer can send the fetch to another host.
const plainFetch: Fetch = (url) => fetch(url, { redirect: "error" })

const huggingFace = (url: string): boolean => {
  try {
    const { hostname, protocol } = new URL(url)
    return (
      protocol === "https:" &&
      (hostname === "huggingface.co" || hostname.endsWith(".huggingface.co"))
    )
  } catch {
    return false
  }
}

// An image's type by its own first bytes, never by what its server said: PNG, JPEG or WebP, else null.
const rasterType = (bytes: Uint8Array): IconType | null => {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png"
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"
  return null
}

const body = async (answer: Response): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (!answer.ok) return null
  const bytes = new Uint8Array(await answer.arrayBuffer())
  return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : null
}

// A maker's icon from its source: models.dev's logo unless its answer is the fallback, else its Hugging Face org's avatar from huggingface.co's hosts alone, else null. Throws when a source cannot be reached, so offline is not mistaken for no icon.
const fetchIcon = async (maker: string, fetch: Fetch): Promise<ModelIcon | null> => {
  const fallback = new TextDecoder().decode(
    (await body(await fetch(`${MODELS_DEV}/${SENTINEL}.svg`))) ?? new Uint8Array(),
  )
  if (!fallback.includes("<svg")) throw new Error("models.dev's fallback did not read")
  const logo = await body(await fetch(`${MODELS_DEV}/${maker.toLowerCase()}.svg`))
  const svg = logo ? new TextDecoder().decode(logo) : ""
  if (svg.includes("<svg") && svg.trim() !== fallback.trim())
    return { bytes: logo!, type: "image/svg+xml" }
  const answer = await fetch(`https://huggingface.co/api/organizations/${maker}/avatar`)
  if (!answer.ok) return null
  const { avatarUrl } = (await answer.json().catch(() => ({}))) as { avatarUrl?: unknown }
  if (typeof avatarUrl !== "string" || !huggingFace(avatarUrl)) return null
  const bytes = await body(await fetch(avatarUrl))
  const type = bytes && rasterType(bytes)
  return bytes && type ? { bytes, type } : null
}

const cached = async (
  dir: string,
  maker: string,
  now: number,
): Promise<ModelIcon | null | undefined> => {
  const names = await readdir(dir).catch(() => [] as string[])
  for (const [type, ext] of Object.entries(EXT) as [IconType, string][])
    if (names.includes(`${maker}.${ext}`))
      return {
        bytes: new Uint8Array(await Bun.file(join(dir, `${maker}.${ext}`)).arrayBuffer()),
        type,
      }
  if (!names.includes(`${maker}.none`)) return undefined
  const { mtimeMs } = await stat(join(dir, `${maker}.none`))
  return now - mtimeMs < NONE_FOR_MS ? null : undefined
}

const inFlight = new Map<string, Promise<ModelIcon | null>>()

// A maker's icon, from the cache in dir once fetched; the first ask fetches it (one fetch at a time for a maker) and keeps it, or a none marker for a day. Offline, or any source failing, gives null and keeps nothing, so a later ask tries again.
export const iconFor = async (
  maker: string,
  { dir, fetch = plainFetch, now = Date.now }: { dir: string; fetch?: Fetch; now?: () => number },
): Promise<ModelIcon | null> => {
  const hit = await cached(dir, maker, now())
  if (hit !== undefined) return hit
  const key = `${dir}\0${maker}`
  const running = inFlight.get(key)
  if (running) return running
  const work = (async () => {
    const icon = await fetchIcon(maker, fetch).catch(() => undefined)
    if (icon === undefined) return null
    await mkdir(dir, { recursive: true })
    if (icon) await writeFile(join(dir, `${maker}.${EXT[icon.type]}`), icon.bytes)
    else await writeFile(join(dir, `${maker}.none`), "")
    return icon
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, work)
  return work
}

// How a cached icon is served: as the type the cache gave it, with no script able to run, kept a day by the browser.
export const servedIconHeaders = (type: string): Record<string, string> => ({
  "cache-control": "private, max-age=86400",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "content-type": type,
  "x-content-type-options": "nosniff",
})

// The serve route's work: the icon of a maker config names, from the cache or fetched once, with servedIconHeaders; a 404 for any other name, a maker with none, or one not yet fetched while offline, which the web draws as its fallback.
export async function serveModelIcon(
  maker: string,
  { dir, fetch, local }: { dir: string; fetch?: Fetch; local: readonly { id: string }[] },
): Promise<Response> {
  const icon =
    isMaker(maker) && makersOf(local).has(maker) ? await iconFor(maker, { dir, fetch }) : null
  if (!icon) throw new ApiError(404, "NOT_FOUND", "No icon for that maker")
  return new Response(icon.bytes, { headers: servedIconHeaders(icon.type) })
}
