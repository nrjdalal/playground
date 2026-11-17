// model-icons: vendors each model maker's icon into web/next/src/lib/model-icons.json, which the Dashboard's sidebar draws from, so it fetches nothing at runtime. Each maker takes models.dev's logo, else its Hugging Face organisation's avatar, else no icon, which draws the one fallback icon. Run on demand with `bun run model-icons`; it fetches only from models.dev and huggingface.co.
import { join } from "node:path"

import sharp from "sharp"

// A model maker: its id (models.dev's provider id), the model ids it makes as a case-insensitive pattern, and its Hugging Face organisation when it has one.
export type Maker = { hf?: string; id: string; match: string }

export const MAKERS: Maker[] = [
  { hf: "Qwen", id: "alibaba", match: "(^|/)qwen" },
  { id: "anthropic", match: "^claude-" },
  { hf: "ornith-ai", id: "ornith", match: "(^|/)ornith" },
  { id: "zai", match: "^glm-" },
]

// One vendored icon: its picture as a data URI, whether it is a one-colour mark drawn in the text colour, and the URL it came from.
export type Icon = { data: string; mono: boolean; source: string }

export type Vendored = Maker & { icon: Icon | null }

export type Fetch = (url: string) => Promise<Response>

const MODELS_DEV = "https://models.dev/logos"
// A provider id models.dev cannot hold: it answers any unknown id with one fallback SVG (1421 bytes, measured) and 200, so this one's body is that fallback, whatever its size.
export const SENTINEL = "playground-no-such-maker"
const AVATAR_PX = 64

export const GENERATED_BY =
  "bun run model-icons (packages/scripts/src/model-icons.ts) writes this file; edit MAKERS there, not here"

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

// Pure: whether models.dev's answer for a maker is its fallback, read by its body against the sentinel's.
export const isFallback = (body: string, fallback: string): boolean =>
  body.trim() === fallback.trim()

// models.dev's fallback SVG, from the sentinel's answer.
export const fallbackOf = async (fetch: Fetch): Promise<string> => {
  const answer = await fetch(`${MODELS_DEV}/${SENTINEL}.svg`)
  const body = await answer.text()
  if (!answer.ok || !body.includes("<svg"))
    throw new Error(`models.dev's fallback did not read: ${answer.status}`)
  return body
}

// A maker's icon: models.dev's logo unless it is the fallback, else its Hugging Face organisation's avatar as a square PNG, else null.
export const iconOf = async (
  maker: Maker,
  fallback: string,
  fetch: Fetch,
): Promise<Icon | null> => {
  const source = `${MODELS_DEV}/${maker.id}.svg`
  const logo = await fetch(source)
  const svg = logo.ok ? await logo.text() : ""
  if (svg.includes("<svg") && !isFallback(svg, fallback))
    return {
      data: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      mono: /currentColor/.test(svg),
      source,
    }
  if (!maker.hf) return null
  const answer = await fetch(`https://huggingface.co/api/organizations/${maker.hf}/avatar`)
  if (!answer.ok) return null
  const { avatarUrl } = (await answer.json()) as { avatarUrl?: unknown }
  if (typeof avatarUrl !== "string" || !huggingFace(avatarUrl)) return null
  const image = await fetch(avatarUrl)
  if (!image.ok) return null
  const png = await sharp(Buffer.from(await image.arrayBuffer()))
    .resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
    .png()
    .toBuffer()
  return { data: `data:image/png;base64,${png.toString("base64")}`, mono: false, source: avatarUrl }
}

// Every maker with its icon, in MAKERS' order.
export const vendor = async (fetch: Fetch, makers = MAKERS): Promise<Vendored[]> => {
  const fallback = await fallbackOf(fetch)
  const out: Vendored[] = []
  for (const maker of makers) out.push({ ...maker, icon: await iconOf(maker, fallback, fetch) })
  return out
}

export const OUT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "web",
  "next",
  "src",
  "lib",
  "model-icons.json",
)

if (import.meta.main) {
  const makers = await vendor((url) => fetch(url))
  await Bun.write(OUT, `${JSON.stringify({ generatedBy: GENERATED_BY, makers }, null, 2)}\n`)
  for (const { icon, id } of makers)
    console.log(`${id}: ${icon ? icon.source : "none, the fallback icon"}`)
}
