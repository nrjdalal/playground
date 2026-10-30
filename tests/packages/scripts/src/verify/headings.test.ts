import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const WEB = join(import.meta.dir, "../../../../../web/next/src")

// Files whose heading changes with what they read, each guarded elsewhere: session-view's is a session's own label, on /dashboard/sessions/[id], and thread-view's a thread's own title, on /dashboard/threads/[id], routes verify pages never opens. dashboard-view has no header: its one PageHeader is the owner-only Dashboard, and its sr-only heading is pinned by dashboard-map.test.ts.
const CHANGING = ["components/dashboard/thread-view.tsx", "components/sessions/session-view.tsx"]

// Each file's PageHeader titles, and how many PageHeaders it renders, so one whose title this cannot read fails rather than going unseen.
const headersIn = async (): Promise<Map<string, { count: number; titles: string[] }>> => {
  const headers = new Map<string, { count: number; titles: string[] }>()
  for await (const path of new Bun.Glob("**/*.tsx").scan(WEB)) {
    if (path.startsWith("components/ui/")) continue
    const text = await Bun.file(join(WEB, path)).text()
    const count = text.match(/<PageHeader\b/g)?.length ?? 0
    const titles = [...text.matchAll(/<PageHeader\s+title=(\{[^}]*\}|"[^"]*")/g)].map(
      (match) => match[1]!,
    )
    if (count) headers.set(path, { count, titles })
  }
  return headers
}

const titlesIn = async (): Promise<Map<string, Set<string>>> =>
  new Map([...(await headersIn())].map(([path, { titles }]) => [path, new Set(titles)]))

describe("page headings", () => {
  // verify pages reads each page's heading once, after network-idle: a page that shows one heading while it loads and another once it has read would pass or fail by timing. The pages keep one title in every state, rendered above the part that waits on data.
  test("keep one title in every state a page renders, loading and owner-only included", async () => {
    const headers = await headersIn()
    expect(headers.size).toBeGreaterThan(5)
    for (const [path, { count, titles }] of headers) {
      if (CHANGING.includes(path)) continue
      expect(titles, `${path}: every PageHeader leads with its title`).toHaveLength(count)
      expect(new Set(titles).size, path).toBe(1)
      expect(
        titles.filter((title) => /\?|&&|\|\|/.test(title)),
        `${path}: a conditional title`,
      ).toEqual([])
    }
  })

  test("name only files whose title still changes, so the list does not outlive its reason", async () => {
    const titles = await titlesIn()
    for (const path of CHANGING) expect(titles.get(path)?.size ?? 0, path).toBeGreaterThan(1)
  })
})
