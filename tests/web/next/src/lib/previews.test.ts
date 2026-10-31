import { describe, expect, test } from "bun:test"

import type { Preview } from "../../../../../api/hono/src/lib/apps/previews"
import {
  doneMessage,
  loadable,
  OPEN_PREVIEW,
  openPreview,
  previewClick,
  previewUrl,
  stackGroups,
  startAddress,
  takeMove,
  takePreview,
  topicCounts,
  topicGroups,
} from "../../../../../web/next/src/lib/previews"

const preview = (name: string, topic: string, modifiedAt: string): Preview => ({
  caption: null,
  kind: name.endsWith(".html") ? "html" : "image",
  modifiedAt,
  name,
  size: 1,
  topic,
})

// Newest first, as the API lists them.
const PREVIEWS = [
  preview("spinner-preview.html", "spinner", "2026-01-01T12:00:00Z"),
  preview("system-item-1.png", "system", "2026-01-01T11:00:00Z"),
  preview("spinner-light-1.png", "spinner", "2026-01-01T10:00:00Z"),
]

describe("topicGroups", () => {
  test("groups by topic, newest topic first and newest first within it", () => {
    expect(topicGroups(PREVIEWS).map((g) => [g.topic, g.previews.map((p) => p.name)])).toEqual([
      ["spinner", ["spinner-preview.html", "spinner-light-1.png"]],
      ["system", ["system-item-1.png"]],
    ])
  })

  test("keeps to the topics picked, and a topic the folder lacks shows nothing", () => {
    expect(topicGroups(PREVIEWS, ["system"]).map((g) => g.topic)).toEqual(["system"])
    expect(topicGroups(PREVIEWS, ["missing"])).toEqual([])
  })
})

describe("topicCounts", () => {
  test("counts each topic once, in the order its newest preview comes", () => {
    expect([...topicCounts(PREVIEWS)]).toEqual([
      ["spinner", 2],
      ["system", 1],
    ])
  })
})

describe("previewUrl", () => {
  test("is the API's serve route, the name encoded", () => {
    expect(previewUrl("http://api.x", "a b.png")).toBe(
      "http://api.x/api/v1/apps/previews/a%20b.png",
    )
  })
})

// the Inbox's Preview row loads a local stack or a page from Previews, and nothing from elsewhere
describe("loadable", () => {
  const api = "https://api.playground.localhost"
  test("a local stack, on https or http, and a page from Previews", () => {
    expect(loadable("https://pg-2.playground.localhost/dashboard", api)).toBe(true)
    expect(loadable("http://pg-2.playground.localhost/", api)).toBe(true)
    expect(loadable(previewUrl(api, "plan.html"), api)).toBe(true)
  })

  test("an outside host, another scheme, or no address at all", () => {
    expect(loadable("https://example.com/", api)).toBe(false)
    expect(loadable("https://localhost.example.com/", api)).toBe(false)
    expect(loadable("javascript:alert(1)//.localhost", api)).toBe(false)
    expect(loadable("file:///etc/hosts.localhost", api)).toBe(false)
    expect(loadable("not a url", api)).toBe(false)
    expect(loadable("", api)).toBe(false)
  })
})

// a fold unmounts the Preview pane, and the first stack must not take the kept address's place when it opens again
describe("startAddress", () => {
  const api = "https://api.playground.localhost"
  const stacks = [
    { url: "https://desk.playground.localhost" },
    { url: "https://pg-2.playground.localhost" },
  ]
  test("a kept, loadable address wins over the first stack", () => {
    expect(startAddress("https://pg-2.playground.localhost/docs", stacks, api)).toBe(
      "https://pg-2.playground.localhost/docs",
    )
    expect(startAddress(previewUrl(api, "plan.html"), stacks, api)).toBe(
      previewUrl(api, "plan.html"),
    )
  })

  test("else the first stack's root, else none", () => {
    expect(startAddress(null, stacks, api)).toBe("https://desk.playground.localhost/")
    expect(startAddress("https://example.com/", stacks, api)).toBe(
      "https://desk.playground.localhost/",
    )
    expect(startAddress(null, [], api)).toBe("")
  })

  test("a stopped worktree, with no URL, is passed over for the first running one", () => {
    expect(startAddress(null, [{ url: null }, ...stacks], api)).toBe(
      "https://desk.playground.localhost/",
    )
    expect(startAddress(null, [{ url: null }], api)).toBe("")
  })
})

// the owner: "this preview thingy should be vibeground, working on multiple projects, or worktrees and things"
describe("stackGroups", () => {
  const stack = (
    project: string,
    branch: string | null,
    url: string | null,
    session: string | null = null,
  ) => ({
    branch,
    name: "folder",
    path: `/${project}/${branch}`,
    project,
    session,
    url,
  })

  test("one group a project in the list's order, each worktree its branch and session, a stopped one its path, to start it", () => {
    expect(
      stackGroups([
        stack("playground", "canary", "https://playground.localhost", "dispatcher"),
        stack("playground", "feat/b", null),
        stack("yard", null, "https://folder.yard.localhost"),
      ]),
    ).toEqual([
      {
        items: [
          { label: "canary · dispatcher", value: "https://playground.localhost" },
          { label: "feat/b · stopped", value: "stopped:/playground/feat/b" },
        ],
        project: "playground",
      },
      {
        items: [{ label: "folder", value: "https://folder.yard.localhost" }],
        project: "yard",
      },
    ])
  })

  test("a Vibeground started and not serving yet reads starting, so the pane offers Stop and never a second Start", () => {
    const booting = { ...stack("playground", "feat/c", null), vibe: true }
    expect(stackGroups([booting])[0]?.items).toEqual([
      { label: "feat/c · starting", value: "stopped:/playground/feat/c" },
    ])
  })
})

// the owner: "also clicking on Playground logo should switch it to vibeground"
describe("openPreview", () => {
  test("the brand's click asks for the Preview row once, so an Inbox that mounts after it still opens it, and one that mounts later does not", () => {
    const heard: string[] = []
    const listen = () => heard.push("open")
    globalThis.window ??= globalThis as unknown as Window & typeof globalThis
    window.addEventListener(OPEN_PREVIEW, listen)
    openPreview(null)
    window.removeEventListener(OPEN_PREVIEW, listen)
    expect(heard).toEqual(["open"])
    expect(takePreview()).toBe(true)
    expect(takePreview()).toBe(false)
  })

  // a phone shows one tab, and a move to another page resets it to the page's own, which hid the Inbox the brand opened
  test("a click that moves the page asks the aside for the Inbox once, at the first address past the one it left", () => {
    globalThis.window ??= globalThis as unknown as Window & typeof globalThis
    openPreview("/dashboard/sessions")
    expect(takeMove("/dashboard/sessions")).toBe(false)
    expect(takeMove("/dashboard")).toBe(true)
    expect(takeMove("/dashboard/system")).toBe(false)
    openPreview(null)
    expect(takeMove("/dashboard/system")).toBe(false)
    takePreview()
  })

  // a click from /dashboard?worker=<the dispatcher> keeps the aside's `where`, so a move judged by `where` stayed armed and pulled a later page change to the Inbox
  test("a move that keeps the aside's session is spent by its own address change, so a later page change keeps its tab", () => {
    globalThis.window ??= globalThis as unknown as Window & typeof globalThis
    openPreview("/dashboard?worker=d")
    expect(takeMove("/dashboard")).toBe(true)
    expect(takeMove("/dashboard?worker=b")).toBe(false)
    takePreview()
  })

  test("a plain click opens the row, moving the page unless it is already home; a modified click opens a tab and leaves the row alone", () => {
    const click = { altKey: false, button: 0, ctrlKey: false, metaKey: false, shiftKey: false }
    const home = { pathname: "/dashboard", search: "" }
    expect(previewClick(click, "/dashboard", home)).toEqual({ from: null })
    expect(
      previewClick(click, "/dashboard", { pathname: "/dashboard/sessions", search: "" }),
    ).toEqual({ from: "/dashboard/sessions" })
    expect(
      previewClick(click, "/dashboard", { pathname: "/dashboard", search: "?worker=a" }),
    ).toEqual({ from: "/dashboard?worker=a" })
    expect(previewClick({ ...click, metaKey: true }, "/dashboard", home)).toBeNull()
    expect(previewClick({ ...click, button: 1 }, "/dashboard", home)).toBeNull()
  })
})

// Done hands the work back for review, never merged; it goes to the dispatcher, the one session the owner's messages reach, which routes it to the worktree's session
describe("doneMessage", () => {
  test("names the worktree, branch and session, pushes to its open PR or opens one into its parent, and never merges", () => {
    const text = doneMessage({ branch: "feat/rooms", path: "/w/rooms", session: "rooms-worker" })
    expect(text).toContain("feat/rooms")
    expect(text).toContain("/w/rooms")
    expect(text).toContain("rooms-worker")
    expect(text).toContain("push it to the branch's open PR")
    expect(text).toContain("only when none is open")
    expect(text).toContain("Do not merge")
  })

  test("a worktree no session works in says so", () => {
    expect(doneMessage({ branch: "main", path: "/w/yard", session: null })).toContain(
      "no session works in it",
    )
  })
})
