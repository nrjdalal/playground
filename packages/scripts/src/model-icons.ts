// model-icons: vendors each model maker's logo from models.dev into web/next/src/lib/model-icons.json, which the Dashboard's sidebar draws from, so it fetches nothing at runtime; a maker models.dev has no logo for takes none, which draws the one fallback icon. Run on demand with `bun run model-icons`; it fetches only from models.dev.
import { join } from "node:path"

// A model maker: its id (models.dev's provider id) and the model ids it makes, as a case-insensitive pattern.
export type Maker = { id: string; match: string }

export const MAKERS: Maker[] = [
  { id: "alibaba", match: "(^|/)qwen" },
  { id: "anthropic", match: "^claude-" },
  { id: "ornith", match: "(^|/)ornith" },
  { id: "zai", match: "^glm-" },
]

// One vendored logo: its SVG as a data URI, the licence it is used under, whether it draws in the text colour, and the URL it came from.
export type Icon = { data: string; licence: string; mono: boolean; source: string }

export type Vendored = Maker & { icon: Icon | null }

export type Fetch = (url: string) => Promise<Response>

const MODELS_DEV = "https://models.dev/logos"
export const MODELS_DEV_LICENCE =
  "MIT, Copyright (c) 2025 models.dev, from github.com/anomalyco/models.dev"
// A provider id models.dev cannot hold: it answers any unknown id with one fallback SVG (1421 bytes, measured) and 200, so this one's body is that fallback, whatever its size.
export const SENTINEL = "playground-no-such-maker"

export const GENERATED_BY =
  "bun run model-icons (packages/scripts/src/model-icons.ts) writes this file; edit MAKERS there, not here"

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

// A maker's logo: models.dev's SVG unless it is the fallback, else null.
export const iconOf = async (
  maker: Maker,
  fallback: string,
  fetch: Fetch,
): Promise<Icon | null> => {
  const source = `${MODELS_DEV}/${maker.id}.svg`
  const logo = await fetch(source)
  const svg = logo.ok ? await logo.text() : ""
  if (!svg.includes("<svg") || isFallback(svg, fallback)) return null
  return {
    data: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    licence: MODELS_DEV_LICENCE,
    mono: /currentColor/.test(svg),
    source,
  }
}

// Every maker with its logo, in MAKERS' order.
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
  const makers = await vendor((url) => fetch(url, { redirect: "error" }))
  await Bun.write(OUT, `${JSON.stringify({ generatedBy: GENERATED_BY, makers }, null, 2)}\n`)
  for (const { icon, id } of makers)
    console.log(`${id}: ${icon ? icon.source : "none, the fallback icon"}`)
}
