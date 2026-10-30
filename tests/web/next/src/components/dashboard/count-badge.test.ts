import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  CountBadge,
  cornerMarks,
  countLabel,
} from "../../../../../../web/next/src/components/dashboard/count-badge"

// React resolves from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

const render = (count?: number) => renderToStaticMarkup(createElement(CountBadge, { count }))
const classes = (html: string) => html.split('class="')[1]!.split('"')[0]!.split(" ")
const source = (path: string) => readFileSync(join(web, "src", path), "utf8")

describe("CountBadge", () => {
  test("caps a count past 99, where the corner dot stops reading cleanly", () => {
    expect(countLabel(0)).toBe("0")
    expect(countLabel(99)).toBe("99")
    expect(countLabel(100)).toBe("99+")
    expect(render(140)).toContain(">99+<")
  })

  // Red dots alone, and a count always sits inside the dot, on the right.
  test("is a red dot holding its count, white on red, whatever the count", () => {
    const html = render(3)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('data-slot="count-badge"')
    expect(html).toContain(">3<")
    for (const name of ["bg-destructive", "text-white", "rounded-full", "h-3.5", "min-w-3.5"])
      expect(classes(html)).toContain(name)
    for (const name of ["bg-sidebar", "text-muted-foreground", "border"])
      expect(classes(html)).not.toContain(name)
  })

  test("with no count is the plain red dot, holding nothing", () => {
    for (const html of [render(), render(0)]) {
      expect(html).toContain('data-slot="count-badge"')
      expect(html).toMatch(/><\/span>$/)
      for (const name of ["bg-destructive", "rounded-full", "size-2"])
        expect(classes(html)).toContain(name)
    }
  })

  test("sits at the square's top right outside the flow, a count growing leftward from a fixed right edge", () => {
    for (const html of [render(3), render(140), render()]) {
      for (const name of ["absolute", "pointer-events-none"]) expect(classes(html)).toContain(name)
      expect(classes(html).some((name) => name.startsWith("-right-"))).toBe(true)
      expect(classes(html).some((name) => name.includes("left-"))).toBe(false)
    }
    expect(classes(render(3))).toEqual(expect.arrayContaining(["-top-1", "-right-1"]))
    // the plain dot and a one-digit count share one centre, 3px in from the top and the right
    expect(classes(render())).toEqual(expect.arrayContaining(["-top-px", "-right-px"]))
  })

  // the aside's count bubble matches the sidebar apps' numbered one
  test("is the one mark every square in the aside's tab bar draws, the app squares included", () => {
    for (const path of ["components/dashboard/dashboard-aside.tsx"]) {
      expect(source(path)).toContain("<CountBadge count=")
      expect(source(path)).not.toContain("rounded-full")
      expect(source(path)).not.toContain("NewDot")
    }
  })

  test("a square wears one mark: its count while it has one, else the dot while something is new", () => {
    expect(cornerMarks(6, true)).toEqual({ count: true, dot: false })
    expect(cornerMarks(6, false)).toEqual({ count: true, dot: false })
    expect(cornerMarks(0, true)).toEqual({ count: false, dot: true })
    expect(cornerMarks(0, false)).toEqual({ count: false, dot: false })
  })
})
