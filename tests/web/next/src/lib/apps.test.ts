import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  APPS,
  APP_PREFS_KEY,
  APP_SQUARE,
  appById,
  arrangeApps,
  dashboardApps,
  moveApp,
  PARKED_APPS,
  parseAppPrefs,
  readAppPrefs,
  shown,
  shownApps,
  toggleApp,
  writeAppPrefs,
} from "../../../../../web/next/src/lib/apps"

const pages = join(import.meta.dir, "../../../../../web/next/src/app/(protected)")

describe("APPS", () => {
  test("every app's display name is one capitalised word", () => {
    for (const app of APPS) expect(app.title, app.id).toMatch(/^[A-Z][a-z]+$/)
  })

  test("every app takes its title's word as its id and its segment", () => {
    for (const app of APPS) {
      expect(app.title.toLowerCase()).toBe(app.id)
      expect<string>(app.segment, app.id).toBe(app.id)
    }
  })

  test("each app lives under its own segment, and no two share an id or a segment", () => {
    for (const app of APPS) expect(app.href, app.id).toBe(`/dashboard/apps/${app.segment}`)
    expect(new Set(APPS.map((app) => app.id)).size).toBe(APPS.length)
    expect(new Set(APPS.map((app) => app.segment)).size).toBe(APPS.length)
  })

  test("plan shows as Plan at /dashboard/apps/plan", () => {
    expect(appById("plan")).toMatchObject({ href: "/dashboard/apps/plan", title: "Plan" })
  })

  test("usage shows as Usage at /dashboard/apps/usage", () => {
    expect(appById("usage")).toMatchObject({
      href: "/dashboard/apps/usage",
      title: "Usage",
    })
  })

  test("the app squares keep the shape the aside's icon tabs draw", () => {
    expect(APP_SQUARE).toContain("hover:bg-sidebar-accent")
    expect(APP_SQUARE).toContain("hover:text-sidebar-accent-foreground")
  })
})

describe("where an app is reached", () => {
  test("the aside's squares, the Apps tab and the Apps home list Changelog, Plan, Previews and Usage parked", () => {
    const ids = dashboardApps().map((app) => app.id)
    expect(ids).toEqual(["changelog"])
    for (const parked of PARKED_APPS) expect(ids).not.toContain(parked)
  })

  test("every app keeps its page at its route", async () => {
    for (const app of APPS) {
      expect(await Bun.file(join(pages, app.href, "page.tsx")).exists(), app.id).toBe(true)
    }
  })
})

describe("a plugin's app", () => {
  test("shows only while its switch is on, and no other app depends on one", () => {
    expect(shown({ id: "changelog" }, { changelog: true })).toBe(true)
    expect(shown({ id: "changelog" }, { changelog: false })).toBe(false)
    expect(shown({ id: "usage" }, { changelog: false })).toBe(true)
    expect(dashboardApps().map((app) => app.id)).toContain("changelog")
  })
})

// #i787: "A new aside tab, Apps, is the app manager: it lists every app, with show/hide and drag to reorder, kept in this browser's localStorage."
describe("your apps' order and which show", () => {
  const ids = <T extends { id: string }>(apps: T[]): T["id"][] => apps.map((app) => app.id)
  const all = [...APPS]
  const memory = () => {
    const items = new Map<string, string>()
    return {
      getItem: (key: string) => items.get(key) ?? null,
      items,
      removeItem: (key: string) => void items.delete(key),
      setItem: (key: string, value: string) => void items.set(key, value),
    } as unknown as Storage & { items: Map<string, string> }
  }

  test("with nothing stored, every app shows in apps.ts order", () => {
    expect(ids(arrangeApps(all, parseAppPrefs(null)))).toEqual(ids(all))
    expect(ids(shownApps(all, parseAppPrefs(null)))).toEqual(ids(all))
  })

  test("a stored order leads, and an app it does not name follows in apps.ts order", () => {
    const prefs = parseAppPrefs(JSON.stringify({ hidden: [], order: ["usage", "plan"] }))
    expect(ids(arrangeApps(all, prefs))).toEqual(["usage", "plan", "changelog", "previews"])
  })

  test("a hidden app leaves the squares and stays in the manager's list", () => {
    const prefs = toggleApp(parseAppPrefs(null), "previews")
    expect(prefs.hidden).toEqual(["previews"])
    expect(ids(shownApps(all, prefs))).not.toContain("previews")
    expect(ids(arrangeApps(all, prefs))).toContain("previews")
    expect(toggleApp(prefs, "previews").hidden).toEqual([])
  })

  test("a move keeps the place of an app the list leaves out, as Changelog while its switch is off", () => {
    const prefs = moveApp({ hidden: [], order: ["changelog", "plan"] }, ["plan", "usage"], 1, 0)
    expect(prefs.order).toEqual(["usage", "plan", "changelog"])
  })

  test("a move writes the whole order, as the list shows it", () => {
    const prefs = moveApp(parseAppPrefs(null), ids(all), 3, 0)
    expect(prefs.order).toEqual(["usage", "changelog", "plan", "previews"])
    expect(ids(arrangeApps(all, prefs))).toEqual(prefs.order)
  })

  test("an id no app has, or a value that is not one, reads as nothing stored", () => {
    expect(parseAppPrefs("not json")).toEqual({ hidden: [], order: [] })
    expect(parseAppPrefs(JSON.stringify({ hidden: ["gone", 3], order: "plan" }))).toEqual({
      hidden: [],
      order: [],
    })
    expect(
      parseAppPrefs(JSON.stringify({ hidden: ["plan", "gone"], order: ["gone", "plan"] })),
    ).toEqual({
      hidden: ["plan"],
      order: ["plan"],
    })
  })

  test("are kept in this browser's localStorage, and kept in the tab when storage refuses", () => {
    const storage = memory()
    writeAppPrefs({ hidden: ["usage"], order: ["plan"] }, () => storage)
    expect(JSON.parse(storage.items.get(APP_PREFS_KEY)!)).toEqual({
      hidden: ["usage"],
      order: ["plan"],
    })
    expect(readAppPrefs(() => storage)).toEqual({ hidden: ["usage"], order: ["plan"] })
    const refusing = () => {
      throw new Error("denied")
    }
    writeAppPrefs({ hidden: ["plan"], order: [] }, refusing)
    expect(readAppPrefs(refusing)).toEqual({ hidden: ["plan"], order: [] })
  })

  // ReviewBot review round 1: a full quota refuses the write while the old text still reads
  test("keep a refused write's picks in the tab while the old stored text still reads", () => {
    const storage = memory()
    storage.items.set(APP_PREFS_KEY, JSON.stringify({ hidden: ["usage"], order: [] }))
    const full = () =>
      ({
        ...storage,
        getItem: storage.getItem,
        setItem: () => {
          throw new Error("quota")
        },
      }) as unknown as Storage
    writeAppPrefs({ hidden: ["plan"], order: [] }, full)
    expect(readAppPrefs(full)).toEqual({ hidden: ["plan"], order: [] })
  })

  test("follow a key another tab cleared back to every app shown", () => {
    const storage = memory()
    writeAppPrefs({ hidden: ["usage"], order: ["plan"] }, () => storage)
    expect(readAppPrefs(() => storage)).toEqual({ hidden: ["usage"], order: ["plan"] })
    storage.items.delete(APP_PREFS_KEY)
    expect(readAppPrefs(() => storage)).toEqual({ hidden: [], order: [] })
  })
})
