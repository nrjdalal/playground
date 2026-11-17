import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type Fetch,
  iconFor,
  isMaker,
  makersOf,
  servedIconHeaders,
  serveModelIcon,
} from "../../../../../../api/hono/src/lib/dashboard/model-icons"

// models.dev's fallback, as measured: one SVG it answers every unknown provider id with, at 200
const FALLBACK = '<svg viewBox="0 0 24 24" fill="none"><path d="M9.8 15.9L9 18.7"/></svg>\n'
const LOGO = '<svg viewBox="0 0 40 40"><path d="M26.9 9.8H22.1" fill="currentColor"/></svg>\n'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const HF = "https://huggingface.co/api/organizations/ornith-ai/avatar"
const CDN = "https://cdn-avatars.huggingface.co/v1/production/uploads/x/ornith.png"

// A fetch stub answering by URL, as models.dev does for a URL it does not hold (its fallback) and Hugging Face for an org it does not know (404); every URL asked is recorded, so no test reaches the network.
const stub = (answers: Record<string, () => Response> = {}) => {
  const asked: string[] = []
  const fetch: Fetch = async (url) => {
    asked.push(url)
    const answer = answers[url]
    if (answer) return answer()
    if (url.startsWith("https://models.dev/logos/")) return new Response(FALLBACK)
    return new Response("not found", { status: 404 })
  }
  return { asked, fetch }
}

const offline: Fetch = async () => {
  throw new TypeError("fetch failed")
}

const scratch = () => mkdtempSync(join(tmpdir(), "model-icons-"))

describe("makersOf", () => {
  test("each backend's maker, then the Hugging Face org of each local model's repo id; a bare id has none", () => {
    expect(
      makersOf([
        { id: "ornith-ai/Ornith-1.5-122B-NVFP4" },
        { id: "RecursiveSI/Thing-7B" },
        { id: "ornith-1.5-122b-nvfp4" },
      ]),
    ).toEqual(new Set(["anthropic", "zai", "ornith-ai", "RecursiveSI"]))
    expect(makersOf([])).toEqual(new Set(["anthropic", "zai"]))
  })

  test("a maker is a plain name, never a path or a URL", () => {
    for (const ok of ["anthropic", "ornith-ai", "RecursiveSI", "a.b_c"])
      expect(isMaker(ok)).toBe(true)
    for (const bad of ["", "../x", "a/b", "-x", "x?y", "a b", "x".repeat(97)])
      expect(isMaker(bad)).toBe(false)
  })
})

describe("iconFor", () => {
  test("a new maker's models.dev logo is fetched once, by its lowercased name, and served from the cache after", async () => {
    const dir = scratch()
    const { asked, fetch } = stub({
      "https://models.dev/logos/recursivesi.svg": () => new Response(LOGO),
    })
    const first = await iconFor("RecursiveSI", { dir, fetch })
    expect(first).toEqual({ bytes: new TextEncoder().encode(LOGO), type: "image/svg+xml" })
    const again = await iconFor("RecursiveSI", { dir, fetch })
    expect(again).toEqual(first)
    expect(asked).toEqual([
      "https://models.dev/logos/playground-no-such-maker.svg",
      "https://models.dev/logos/recursivesi.svg",
    ])
    expect(readdirSync(dir)).toEqual(["RecursiveSI.svg"])
  })

  test("models.dev's fallback counts as no logo, so the maker's Hugging Face avatar is taken, typed by its bytes", async () => {
    const dir = scratch()
    const { asked, fetch } = stub({
      [CDN]: () => new Response(PNG, { headers: { "content-type": "text/html" } }),
      [HF]: () => Response.json({ avatarUrl: CDN }),
    })
    expect(await iconFor("ornith-ai", { dir, fetch })).toEqual({ bytes: PNG, type: "image/png" })
    expect(asked.slice(1)).toEqual(["https://models.dev/logos/ornith-ai.svg", HF, CDN])
  })

  test("an avatar URL on a host other than huggingface.co, or an answer that is no image, is refused and never served", async () => {
    for (const avatarUrl of [
      "https://example.com/a.png",
      "http://cdn-avatars.huggingface.co/a.png",
      "https://huggingface.co.example.com/a.png",
    ]) {
      const { asked, fetch } = stub({ [HF]: () => Response.json({ avatarUrl }) })
      expect(await iconFor("ornith-ai", { dir: scratch(), fetch })).toBeNull()
      expect(asked).not.toContain(avatarUrl)
    }
    const html = stub({
      [CDN]: () => new Response("<script>alert(1)</script>"),
      [HF]: () => Response.json({ avatarUrl: CDN }),
    })
    expect(await iconFor("ornith-ai", { dir: scratch(), fetch: html.fetch })).toBeNull()
  })

  test("a maker with neither is cached as none for a day, then asked again", async () => {
    const dir = scratch()
    const { asked, fetch } = stub()
    let now = Date.parse("2026-11-17T09:00:00Z")
    expect(await iconFor("nobody", { dir, fetch, now: () => now })).toBeNull()
    const once = asked.length
    expect(await iconFor("nobody", { dir, fetch, now: () => now })).toBeNull()
    expect(asked).toHaveLength(once)
    now += 25 * 60 * 60 * 1000
    expect(await iconFor("nobody", { dir, fetch, now: () => now })).toBeNull()
    expect(asked.length).toBeGreaterThan(once)
  })

  test("offline gives no icon and caches nothing, so the next ask fetches again", async () => {
    const dir = scratch()
    expect(await iconFor("anthropic", { dir, fetch: offline })).toBeNull()
    expect(readdirSync(dir)).toEqual([])
    const { fetch } = stub({ "https://models.dev/logos/anthropic.svg": () => new Response(LOGO) })
    expect((await iconFor("anthropic", { dir, fetch }))?.type).toBe("image/svg+xml")
  })

  test("a 429 or a 5xx from a source reads as out of reach and caches nothing, where a 404 is no icon", async () => {
    for (const status of [429, 500, 503]) {
      const dir = scratch()
      const { fetch } = stub({ [HF]: () => new Response("busy", { status }) })
      expect(await iconFor("ornith-ai", { dir, fetch })).toBeNull()
      expect(readdirSync(dir)).toEqual([])
    }
    const dir = scratch()
    expect(await iconFor("ornith-ai", { dir, fetch: stub().fetch })).toBeNull()
    expect(readdirSync(dir)).toEqual(["ornith-ai.none"])
  })

  test("an answer past 1 MB is refused, whether its length is declared or not", async () => {
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(PNG)
    const streamed = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(big)
            controller.close()
          },
        }),
      )
    for (const answer of [() => new Response(big), streamed]) {
      const { fetch } = stub({ [CDN]: answer, [HF]: () => Response.json({ avatarUrl: CDN }) })
      expect(await iconFor("ornith-ai", { dir: scratch(), fetch })).toBeNull()
    }
  })
})

describe("servedIconHeaders", () => {
  test("a cached icon is served as the type the cache gave it, with no script able to run", () => {
    expect(servedIconHeaders("image/svg+xml")).toEqual({
      "cache-control": "private, max-age=86400",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "content-type": "image/svg+xml",
      "x-content-type-options": "nosniff",
    })
  })
})

describe("serveModelIcon", () => {
  const LOCAL = [{ id: "RecursiveSI/Thing-7B", label: "R" }]

  test("a new maker in config, with the fetch mocked, is fetched, cached and served with servedIconHeaders", async () => {
    const dir = scratch()
    const { fetch } = stub({ "https://models.dev/logos/recursivesi.svg": () => new Response(LOGO) })
    const served = await serveModelIcon("RecursiveSI", { dir, fetch, local: LOCAL })
    expect(served.status).toBe(200)
    expect(Object.fromEntries(served.headers)).toMatchObject(servedIconHeaders("image/svg+xml"))
    expect(await served.text()).toBe(LOGO)
    const cachedOnly = await serveModelIcon("RecursiveSI", { dir, fetch: offline, local: LOCAL })
    expect(await cachedOnly.text()).toBe(LOGO)
  })

  test("a maker config does not name, a bad name, no icon or offline is a 404, and only a named maker is fetched", async () => {
    const { asked, fetch } = stub()
    for (const maker of ["RecursiveSI", "someone-else", "../etc", "nobody"])
      await expect(serveModelIcon(maker, { dir: scratch(), fetch, local: [] })).rejects.toThrow(
        "No icon for that maker",
      )
    expect(asked).toEqual([])
    await expect(
      serveModelIcon("anthropic", { dir: scratch(), fetch: offline, local: [] }),
    ).rejects.toThrow("No icon for that maker")
  })
})
