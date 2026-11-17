import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import sharp from "sharp"

import {
  fallbackOf,
  type Fetch,
  GENERATED_BY,
  iconOf,
  isFallback,
  MAKERS,
  OUT,
  SENTINEL,
  vendor,
} from "../../../../packages/scripts/src/model-icons"

// models.dev's fallback, as measured: one SVG it answers every unknown provider id with, at 200
const FALLBACK = '<svg viewBox="0 0 24 24" fill="none"><path d="M9.8 15.9L9 18.7"/></svg>\n'
const LOGO = '<svg viewBox="0 0 40 40"><path d="M26.9 9.8H22.1" fill="currentColor"/></svg>\n'

// A fetch stub answering by URL; any URL it does not hold answers as models.dev does, with the fallback, and every URL asked is recorded, so no test reaches the network.
const stub = (answers: Record<string, Response | (() => Response)>) => {
  const asked: string[] = []
  const fetch: Fetch = async (url) => {
    asked.push(url)
    const answer = answers[url]
    if (answer) return typeof answer === "function" ? answer() : answer.clone()
    if (url.startsWith("https://models.dev/logos/")) return new Response(FALLBACK)
    return new Response("not found", { status: 404 })
  }
  return { asked, fetch }
}

const avatar = await sharp({
  create: { background: "#ff6600", channels: 4, height: 400, width: 400 },
})
  .webp()
  .toBuffer()

const HF = "https://huggingface.co/api/organizations/ornith-ai/avatar"
const CDN = "https://cdn-avatars.huggingface.co/v1/production/uploads/x/ornith.webp"

describe("model-icons", () => {
  test("tells models.dev's fallback from a real logo by the sentinel's body, whatever its size", async () => {
    const { asked, fetch } = stub({})
    const fallback = await fallbackOf(fetch)
    expect(asked).toEqual([`https://models.dev/logos/${SENTINEL}.svg`])
    expect(isFallback(FALLBACK, fallback)).toBe(true)
    expect(isFallback(LOGO, fallback)).toBe(false)
  })

  test("a maker models.dev holds takes its logo, one colour when it draws in currentColor", async () => {
    const { fetch } = stub({ "https://models.dev/logos/anthropic.svg": new Response(LOGO) })
    const icon = await iconOf({ id: "anthropic", match: "^claude-" }, FALLBACK, fetch)
    expect(icon).toEqual({
      data: `data:image/svg+xml;base64,${Buffer.from(LOGO).toString("base64")}`,
      mono: true,
      source: "https://models.dev/logos/anthropic.svg",
    })
  })

  test("a maker models.dev answers with its fallback takes its Hugging Face avatar, as a 64 px PNG", async () => {
    const { asked, fetch } = stub({
      [CDN]: () => new Response(avatar),
      [HF]: () => Response.json({ avatarUrl: CDN }),
    })
    const icon = await iconOf({ hf: "ornith-ai", id: "ornith", match: "ornith" }, FALLBACK, fetch)
    expect(asked).toEqual(["https://models.dev/logos/ornith.svg", HF, CDN])
    expect(icon?.mono).toBe(false)
    expect(icon?.source).toBe(CDN)
    const png = Buffer.from(icon!.data.replace(/^data:image\/png;base64,/, ""), "base64")
    expect(await sharp(png).metadata()).toMatchObject({ format: "png", height: 64, width: 64 })
  })

  test("a maker with neither, or an avatar off Hugging Face, takes no icon, so the fallback draws", async () => {
    const none = stub({})
    expect(
      await iconOf({ hf: "no-such-org", id: "nobody", match: "x" }, FALLBACK, none.fetch),
    ).toBeNull()
    expect(await iconOf({ id: "nobody", match: "x" }, FALLBACK, none.fetch)).toBeNull()
    const off = stub({ [HF]: () => Response.json({ avatarUrl: "https://example.com/a.png" }) })
    expect(
      await iconOf({ hf: "ornith-ai", id: "ornith", match: "x" }, FALLBACK, off.fetch),
    ).toBeNull()
    expect(off.asked).not.toContain("https://example.com/a.png")
  })

  test("vendor reads the fallback once, then each maker in order", async () => {
    const { asked, fetch } = stub({ "https://models.dev/logos/zai.svg": new Response(LOGO) })
    const out = await vendor(fetch, [{ id: "zai", match: "^glm-" }])
    expect(asked[0]).toBe(`https://models.dev/logos/${SENTINEL}.svg`)
    expect(out.map((m) => [m.id, m.icon?.source])).toEqual([
      ["zai", "https://models.dev/logos/zai.svg"],
    ])
  })

  test("the committed file parses, names its writer and covers every maker in the map", () => {
    const committed = JSON.parse(readFileSync(OUT, "utf8")) as {
      generatedBy: string
      makers: { icon: { data: string; source: string } | null; id: string; match: string }[]
    }
    expect(committed.generatedBy).toBe(GENERATED_BY)
    expect(committed.makers.map(({ id, match }) => ({ id, match }))).toEqual(
      MAKERS.map(({ id, match }) => ({ id, match })),
    )
    for (const { icon } of committed.makers)
      if (icon) {
        expect(icon.data).toMatch(/^data:image\/(svg\+xml|png);base64,/)
        expect(icon.source).toMatch(/^https:\/\/(models\.dev|([a-z-]+\.)?huggingface\.co)\//)
      }
  })
})
