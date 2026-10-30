import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DASHBOARD_MAP,
  driftProblems,
  MAP_PATH,
  ROOT,
  showsProblems,
} from "../../../../../packages/scripts/src/verify/map"
import { homeTitle } from "../../../../../web/next/src/lib/agent-label"

const DASHBOARD_VIEW = join(
  import.meta.dir,
  "../../../../../web/next/src/components/dashboard/dashboard-view.tsx",
)

describe("the dashboard map", () => {
  // The guard against drift: a PR that adds a dashboard page, a sidebar group or renames an API route a page names fails here until it updates the map.
  test("matches the code: every dashboard page and sidebar group, and only API routes the API serves", async () => {
    expect(await driftProblems()).toEqual([])
  })

  // the map and verify's checks speak of the owner, never a real person, org or team key.
  test("names no real person, org or team", async () => {
    for (const file of [MAP_PATH, "packages/scripts/src/verify/checks.ts"]) {
      const text = await Bun.file(join(ROOT, file)).text()
      expect([file, text.match(/.{0,30}(?:acme|acme-owner|\b(?:NG|PLAT)-\d).{0,30}/gi)]).toEqual([
        file,
        null,
      ])
    }
  })

  test("says what every page and group shows, how to reach each page, and what uses each unpaged route", () => {
    for (const page of DASHBOARD_MAP.pages) {
      expect(page.title.trim(), page.route).not.toBe("")
      expect(page.reach.length, page.route).toBeGreaterThan(0)
    }
    for (const group of DASHBOARD_MAP.sidebar) expect(group.shows.trim(), group.label).not.toBe("")
    for (const { route, use } of DASHBOARD_MAP.unpagedApi) expect(use.trim(), route).not.toBe("")
  })

  // The point of the list: two PRs that each add a feature to /dashboard, in its sorted place, merge with no conflict.
  test("takes two additions to one page's shows, from two branches, with no conflict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashboard-map-"))
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(
        ["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
        {
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        },
      )
      return { code: result.exitCode, out: result.stdout.toString().trim() }
    }
    const file = join(dir, "dashboard-map.json")
    const text = await Bun.file(join(ROOT, MAP_PATH)).text()
    const home = DASHBOARD_MAP.pages.find((page) => page.route === "/dashboard")!.shows
    // each addition lands in its sorted place, as a line of its own before the entry it sorts ahead of
    const add = (entry: string) => {
      const next = home.find((shown) => entry.localeCompare(shown) < 0)!
      const line = `        ${JSON.stringify(next)},`
      return text.replace(`\n${line}`, `\n        ${JSON.stringify(entry)},\n${line}`)
    }
    try {
      expect(git("init", "-q", "-b", "base")).toMatchObject({ code: 0 })
      await Bun.write(file, text)
      expect(git("add", ".")).toMatchObject({ code: 0 })
      expect(git("commit", "-q", "-m", "base")).toMatchObject({ code: 0 })
      for (const [branch, entry] of [
        ["one", "Bookmarks keep a session's view one click away."],
        ["two", "Messages can be pinned above the steps."],
      ] as const) {
        expect(git("checkout", "-q", "-b", branch, "base")).toMatchObject({ code: 0 })
        const added = add(entry)
        expect(added).not.toBe(text)
        await Bun.write(file, added)
        expect(git("commit", "-q", "-am", branch)).toMatchObject({ code: 0 })
      }
      const merged = git("merge-tree", "--write-tree", "one", "two")
      expect(merged.code).toBe(0)
      const shows = (
        JSON.parse(git("show", `${merged.out}:dashboard-map.json`).out) as typeof DASHBOARD_MAP
      ).pages.find((page) => page.route === "/dashboard")!.shows
      expect(shows.length).toBe(home.length + 2)
      expect(showsProblems([{ ...DASHBOARD_MAP.pages[0]!, shows }])).toEqual([])
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  // verify pages reads /dashboard's heading in a browser, which bun run test never opens, once the page has one: the primary dispatcher's label, Alpha, never a session's name (#i520).
  test("gives /dashboard the heading the page shows once the API names the dispatcher", async () => {
    const home = DASHBOARD_MAP.pages.find((page) => page.route === "/dashboard")
    expect(home?.heading).toBe(homeTitle("dispatcher") ?? "")
    expect(home?.heading).toBe("Alpha")
    expect(home?.dispatcherHeading).toBe(true)
    expect(homeTitle(null)).toBeNull()
    const view = await Bun.file(DASHBOARD_VIEW).text()
    // the view has no header, so its heading is for screen readers alone, the same while no dispatcher is live and after
    expect(view).toContain('{title && <h1 className="sr-only">{title}</h1>}')
    expect(view).toContain('<h1 className="sr-only">{chatLabel(selected, dispatcher)}</h1>')
    expect(view).not.toMatch(/<PageHeader title="(?!Dashboard")/)
  })

  test("lists each page and each sidebar group once", () => {
    const routes = DASHBOARD_MAP.pages.map((page) => page.route)
    const labels = DASHBOARD_MAP.sidebar.map((group) => group.label)
    expect(new Set(routes).size).toBe(routes.length)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
