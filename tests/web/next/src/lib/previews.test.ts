import { describe, expect, test } from "bun:test"

import type { Preview } from "../../../../../api/hono/src/lib/apps/previews"
import {
  loadable,
  OPEN_PREVIEW,
  openPreview,
  previewUrl,
  stackGroups,
  startAddress,
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
})

// the owner: "also clicking on Playground logo should switch it to vibeground"
describe("openPreview", () => {
  test("the brand's click asks for the Preview row once, so an Inbox that mounts after it still opens it, and one that mounts later does not", () => {
    const heard: string[] = []
    const listen = () => heard.push("open")
    globalThis.window ??= globalThis as unknown as Window & typeof globalThis
    window.addEventListener(OPEN_PREVIEW, listen)
    openPreview()
    window.removeEventListener(OPEN_PREVIEW, listen)
    expect(heard).toEqual(["open"])
    expect(takePreview()).toBe(true)
    expect(takePreview()).toBe(false)
  })
})
