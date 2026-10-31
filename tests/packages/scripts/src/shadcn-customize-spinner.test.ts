import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  loader4,
  RESTORE,
  SMALL_TEXT,
  smallText,
} from "../../../../packages/scripts/src/shadcn-customize"
import { CenterSpinner, PulseDot, Spinner } from "../../../../web/next/src/components/ui/spinner"

// React and Remix Icon resolve from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
const web = join(import.meta.dir, "../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown) => Node
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}
const { RiCheckboxBlankCircleFill, RiLoader4Line } = (await import(
  Bun.resolveSync("@remixicon/react", web)
)) as { RiCheckboxBlankCircleFill: unknown; RiLoader4Line: unknown }

const pathOf = (markup: string) => /<path d="([^"]+)"/.exec(markup)?.[1]

describe("Spinner", () => {
  const markup = renderToStaticMarkup(createElement(Spinner))

  test('is Remix\'s loader, turning only where motion is welcome (the owner: "instead of dot loader for chat and aside, show a spinner")', () => {
    expect(pathOf(markup)).toBe(pathOf(renderToStaticMarkup(createElement(RiLoader4Line))))
    expect(markup).toContain("motion-safe:animate-spin")
    expect(markup).not.toContain("animate-pulse")
    expect(markup).toContain('fill="currentColor"')
  })

  test("still announces itself and takes a caller's size", () => {
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-label="Loading"')
    const large = renderToStaticMarkup(createElement(Spinner, { className: "size-5" }))
    expect(large).toContain("size-5")
    expect(large).not.toContain("size-4")
  })
})

describe("loader icon", () => {
  test('is RiLoader4Line app wide, so a shadcn sync that scaffolds RiLoaderLine back fails here (the owner: "user loader4 instead of loader app wide")', async () => {
    const stray: string[] = []
    for await (const file of new Bun.Glob("src/**/*.{ts,tsx}").scan(web)) {
      if ((await Bun.file(join(web, file)).text()).includes("RiLoaderLine")) stray.push(file)
    }
    expect(stray).toEqual([])
  })
})

describe("CenterSpinner", () => {
  test('holds the Spinner in the middle of its pane, both ways (the owner: "and in xy center")', () => {
    const markup = renderToStaticMarkup(createElement(CenterSpinner))
    expect(markup).toMatch(/^<div class="[^"]*absolute inset-0 grid place-items-center/)
    expect(markup).toContain("motion-safe:animate-spin")
  })
})

describe("PulseDot", () => {
  test('is the pulsing dot for a session at work in the chat (the owner: "in chat it should be the dots")', () => {
    const markup = renderToStaticMarkup(createElement(PulseDot))
    expect(pathOf(markup)).toBe(
      pathOf(renderToStaticMarkup(createElement(RiCheckboxBlankCircleFill))),
    )
    expect(markup).toContain("motion-safe:animate-pulse")
    expect(markup).not.toContain("animate-spin")
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-label="Working"')
    expect(markup).toContain('data-slot="pulse-dot"')
  })
})

describe("shadcn-customize", () => {
  test("restores the spinner from HEAD, since the whole file is ours", () => {
    expect(RESTORE).toContain("web/next/src/components/ui/spinner.tsx")
  })

  test('swaps the toast\'s loader for RiLoader4Line, once, and fails loudly when it has none (the owner: "user loader4 instead of loader app wide")', () => {
    const stock =
      'import { RiLoaderLine } from "@remixicon/react"\nicon = <RiLoaderLine className="animate-spin" />'
    const patched = loader4(stock)
    expect(patched).not.toContain("RiLoaderLine")
    expect(patched.match(/RiLoader4Line/g)).toHaveLength(2)
    expect(loader4(patched)).toBe(patched)
    expect(() => loader4("icon = <RiCloseLine />")).toThrow("no loader icon")
  })

  test("moves shadcn's 12.8px small text onto the type scale, once", () => {
    const stock = 'sm: "h-7 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5",'
    const patched = smallText(stock, "button.tsx")
    expect(patched).toBe('sm: "h-7 px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5",')
    expect(smallText(patched, "button.tsx")).toBe(patched)
  })

  test("fails loudly when shadcn moves the size off 0.8rem, even beside a text-xs", () => {
    const drifted = 'xs: "h-6 px-2 text-xs",\nsm: "h-7 px-2.5 text-[0.78rem]",'
    expect(() => smallText(drifted, "button.tsx")).toThrow("text-[0.78rem] in button.tsx")
  })

  test("leaves no off-scale text in the primitives it patches", async () => {
    for (const file of SMALL_TEXT) {
      const text = await Bun.file(join(import.meta.dir, "../../../..", file)).text()
      expect(text).not.toMatch(/text-\[[\d.]+(?:rem|px)\]/)
    }
  })
})
