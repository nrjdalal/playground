import { describe, expect, test } from "bun:test"

import type { Browser, Target } from "../../../../../packages/scripts/src/verify/checks"
import { rail, railResult } from "../../../../../packages/scripts/src/verify/rail"

describe("railResult", () => {
  test("passes when each click and each Cmd+B turns the sidebar over", () => {
    const result = railResult(
      ["expanded", "collapsed", "expanded", "collapsed", "expanded"],
      "/dashboard",
    )
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("rail click collapsed")
  })

  test("names the rail click that left the sidebar open (#1303)", () => {
    const result = railResult(
      ["expanded", "expanded", "collapsed", "expanded", "collapsed"],
      "/docs",
    )
    expect(result).toEqual({
      check: "rail /docs",
      detail: "after rail click the sidebar reads expanded, not collapsed",
      ok: false,
    })
  })

  test("names a sidebar it could not read", () => {
    const result = railResult(["expanded", "collapsed", "expanded", null], "/dashboard")
    expect(result.ok).toBe(false)
    expect(result.detail).toBe("after Cmd+B the sidebar reads nothing, not collapsed")
  })
})

// A sidebar as a loaded machine draws it: every call to the browser is one tick, a toggle's state lands `late` ticks after its click or Cmd+B, and the rail then slides for `slide` ticks, read at a midpoint (130) until it rests at 256 open or 4 collapsed.
const loadedBrowser = ({ late, slide }: { late: number; slide: number }) => {
  let state = "expanded"
  let pending: { left: number; to: string } | null = null
  let sliding = 0
  let mouse = 0
  const railX = () => (sliding > 0 ? 130 : state === "expanded" ? 256 : 4)
  const tick = () => {
    if (pending && --pending.left <= 0) {
      state = pending.to
      pending = null
      sliding = slide
    } else if (!pending && sliding > 0) sliding--
  }
  const toggle = () => {
    pending = { left: late, to: state === "expanded" ? "collapsed" : "expanded" }
  }
  const run = async (...args: string[]): Promise<Record<string, unknown>> => {
    tick()
    if (args[0] === "mouse" && args[1] === "move") mouse = Number(args[2])
    if (args[0] === "mouse" && args[1] === "up" && mouse === railX()) toggle()
    if (args[0] === "press" && args[1] === "Meta+b") toggle()
    return {}
  }
  const evaluate = async (script: string): Promise<unknown> => {
    tick()
    if (script.includes('data-sidebar="rail"')) return [railX(), 400]
    if (script.includes("getAnimations")) return { moving: sliding > 0, state }
    return state
  }
  return {
    eval: evaluate,
    run,
    viewport: async () => {},
    visit: async () => {},
  } as unknown as Browser
}

const target: Target = { api: "http://api.test", web: "http://web.test" }

describe("rail on a loaded machine (#1521)", () => {
  test("reads each step once its state has landed", async () => {
    const result = await rail(loadedBrowser({ late: 3, slide: 0 }), target, "/dashboard")
    expect(result.detail).toBe(
      "on load expanded, rail click collapsed, second rail click expanded, Cmd+B collapsed, second Cmd+B expanded",
    )
    expect(result.ok).toBe(true)
  })

  test("clicks the collapsed rail where it rests, not where it slid through", async () => {
    const result = await rail(loadedBrowser({ late: 1, slide: 4 }), target, "/docs")
    expect(result.detail).toContain("second rail click expanded")
    expect(result.ok).toBe(true)
  })

  test("names the state it last read when the sidebar never turns over", async () => {
    const result = await rail(loadedBrowser({ late: Infinity, slide: 0 }), target, "/docs")
    expect(result).toEqual({
      check: "rail /docs",
      detail: "after rail click the sidebar reads expanded, not collapsed",
      ok: false,
    })
  })

  test("names a rail still sliding when the wait runs out", async () => {
    const result = await rail(loadedBrowser({ late: 1, slide: Infinity }), target, "/docs")
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(
      /^after rail click the sidebar reads collapsed but its rail still slides after \d+ms$/,
    )
  })
})
