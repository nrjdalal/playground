import { describe, expect, test } from "bun:test"

import {
  SPLIT_COOKIE,
  SPLIT_MIN,
  letGo,
  snapsToMiddle,
  splitCookie,
  storedSplit,
} from "../../../../../../web/next/src/components/dashboard/aside-split"

const source = (path: string) =>
  Bun.file(new URL(`../../../../../../web/next/src/${path}`, import.meta.url)).text()

// the value a cookie string sets, as the browser would send it back
const valueOf = (cookie: string) => cookie.split(";")[0]!.slice(`${SPLIT_COOKIE}=`.length)

describe("the split between a dashboard page and its aside", () => {
  test("snaps a let-go near the middle to it, and keeps any other", () => {
    expect([45.1, 47, 52, 54.9].every(snapsToMiddle)).toBe(true)
    expect([30, 45, 50, 55, 70].some(snapsToMiddle)).toBe(false)
    expect(letGo(53)).toBe(50)
    expect(letGo(65)).toBe(65)
  })

  test("reads a stored page width as the split, the aside taking the rest", () => {
    expect(storedSplit("65")).toEqual({ aside: 35, page: 65 })
    expect(storedSplit("41.25")).toEqual({ aside: 58.75, page: 41.25 })
  })

  test("reads nothing stored, a value off either half's floor, or anything odd as no split, so the halves open at 50/50", () => {
    for (const raw of [
      undefined,
      "",
      "abc",
      "-2",
      "29.9",
      "70.1",
      "100",
      "65; Path=/",
      " 65",
      "1e2",
      "65.123",
    ])
      expect(storedSplit(raw)).toBeNull()
    expect(storedSplit(String(SPLIT_MIN))).toEqual({ aside: 100 - SPLIT_MIN, page: SPLIT_MIN })
    expect(storedSplit(String(100 - SPLIT_MIN))).toEqual({
      aside: SPLIT_MIN,
      page: 100 - SPLIT_MIN,
    })
  })

  test("round-trips through the cookie the server reads, so a reload paints the owner's last split", () => {
    const cookie = splitCookie(65.4321)
    expect(cookie.startsWith(`${SPLIT_COOKIE}=`)).toBe(true)
    expect(cookie).toContain("Path=/dashboard")
    expect(cookie).toContain("SameSite=Lax")
    expect(storedSplit(valueOf(cookie))).toEqual({ aside: 34.57, page: 65.43 })
  })

  test("is read by the dashboard's layout on the server and handed to the aside, which opens its halves at it", async () => {
    const layout = await source("app/(protected)/dashboard/layout.tsx")
    expect(layout).toMatch(/cookies\(\)/)
    expect(layout).toMatch(/storedSplit\(/)
    expect(layout).toMatch(/<DashboardAside split=\{/)
    const aside = await source("components/dashboard/dashboard-aside.tsx")
    expect(aside).toMatch(/defaultLayout=\{split \?\? undefined\}/)
    expect(aside).toMatch(/minSize=\{`\$\{SPLIT_MIN\}%`\}/)
    expect(aside).not.toMatch(/minSize="30%"/)
  })

  test("is written on each let-go of the divider, after the snap, and never by a resize the owner did not make", async () => {
    const aside = await source("components/dashboard/dashboard-aside.tsx")
    expect(aside).toMatch(/if \(!isUserInteraction\) return/)
    expect(aside).toMatch(/const kept = letGo\(/)
    expect(aside).toMatch(/document\.cookie = splitCookie\(kept\)/)
  })
})
