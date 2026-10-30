import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Glob } from "bun"

import { TOOLTIP_DELAY_MS } from "../../../../web/next/src/lib/tooltip"

const SRC = join(import.meta.dir, "../../../../web/next/src")

// Every hover is a tooltip, never a native one: a hover is shadcn's Tooltip (Hint in components/hint.tsx, or SidebarMenuButton's tooltip), never the browser's title box.

// Where a title on an element must stay, by file under web/next/src and tag, with why.
const ELEMENT_TITLES: Record<string, string> = {
  // a frame's title is its accessible name (WCAG 4.1.2), and its sandbox runs no script, so it cannot take a Tooltip
  "app/(protected)/dashboard/apps/previews/components/previews-view.tsx iframe":
    "the frame's accessible name",
  "components/dashboard/preview-pane.tsx iframe": "the frame's accessible name",
}

// Components whose title prop is their own heading or label text, drawn as words and never set as an attribute.
const HEADING_PROPS = new Set([
  "ConfirmDialog",
  "DataTableFacetedFilter",
  "FacetedFilter",
  "NoChat",
  "OwnerOnly",
  "PageHeader",
  "Problems",
  "RouteNotFound",
  "Section",
  "Step",
])

// Comments go and string literals stay whole, so an apostrophe in a comment opens no string.
const stripComments = (text: string) =>
  text.replace(
    /("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm,
    (_, literal?: string, lead?: string) => literal ?? lead ?? "",
  )

// The tag a ` title=` sits in: back from it to the `<` that opens its element at the same brace depth.
const tagOf = (code: string, at: number): string | null => {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = code[i]
    if (c === "}" || c === ")") depth++
    else if (c === "{" || c === "(") depth--
    else if (c === "<" && depth === 0 && /[A-Za-z]/.test(code[i + 1] ?? ""))
      return /^<([\w.]+)/.exec(code.slice(i))?.[1] ?? null
    if (depth < 0) return null
  }
  return null
}

// Every JSX title attribute in the app, as "<file> <tag>".
const titles = async (): Promise<string[]> => {
  const found: string[] = []
  for await (const file of new Glob("**/*.tsx").scan(SRC)) {
    const code = stripComments(await Bun.file(join(SRC, file)).text())
    for (const match of code.matchAll(/\stitle=/g)) {
      const tag = tagOf(code, match.index)
      if (tag) found.push(`${file} ${tag}`)
    }
  }
  return found
}

// Every object spread onto an element whose declaration in its file sets a title key, as "<file> {...<name>}": canary's inbox once spread `{ ..., title: PAUSED_WHY }` as `{...hold}`.
const spreadTitles = (file: string, code: string): string[] =>
  [...code.matchAll(/\{\.\.\.(\w+)\}/g)]
    .filter((match) => tagOf(code, match.index))
    .filter(([, name]) =>
      /\btitle:/.test(
        new RegExp(`(?:const|let|var)\\s+${name}\\b[^=\\n]*=([^\\n]*(?:\\n[ \\t]+[^\\n]*)*)`).exec(
          code,
        )?.[1] ?? "",
      ),
    )
    .map(([, name]) => `${file} {...${name}}`)

describe("no native title box", () => {
  test("no element carries a title but those listed with why", async () => {
    const elements = (await titles()).filter((at) => /^[a-z]/.test(at.split(" ").at(-1) ?? ""))
    expect(elements.filter((at) => !(at in ELEMENT_TITLES))).toEqual([])
  })

  test("no object spread onto an element carries a title", async () => {
    const found: string[] = []
    for await (const file of new Glob("**/*.tsx").scan(SRC))
      found.push(...spreadTitles(file, stripComments(await Bun.file(join(SRC, file)).text())))
    expect(found).toEqual([])
  })

  test("a component's title prop is one that draws it as its own words", async () => {
    const components = (await titles())
      .map((at) => at.split(" ").at(-1) ?? "")
      .filter((tag) => /^[A-Z]/.test(tag))
    expect(components.filter((tag) => !HEADING_PROPS.has(tag))).toEqual([])
  })

  test("no <title> or <abbr> draws a hover of its own", async () => {
    const found: string[] = []
    for await (const file of new Glob("**/*.tsx").scan(SRC)) {
      if (file.startsWith("app/og/")) continue
      const code = stripComments(await Bun.file(join(SRC, file)).text())
      if (/<(?:title|abbr)[\s>]/.test(code)) found.push(file)
    }
    expect(found).toEqual([])
  })

  // A native tooltip waits too long, so one shared delay serves every tooltip.
  test("every tooltip opens on the one shared delay, which no component sets for itself", async () => {
    expect(TOOLTIP_DELAY_MS).toBe(1000)
    const providers = await Bun.file(join(SRC, "app/providers.tsx")).text()
    // a neighbour waits its own delay too, so a sweep down the sidebar opens nothing
    expect(providers).toContain("<TooltipProvider delay={TOOLTIP_DELAY_MS} timeout={0}>")
    const own: string[] = []
    for await (const file of new Glob("**/*.tsx").scan(SRC)) {
      if (file === "app/providers.tsx" || file === "components/ui/tooltip.tsx") continue
      const code = stripComments(await Bun.file(join(SRC, file)).text())
      if (/\s(?:closeDelay|delay)=/.test(code)) own.push(file)
    }
    expect(own).toEqual([])
  })

  test("the check reads a title in each shape it is written", async () => {
    const code = stripComments(
      `<span title="a" />\n<a\n  // it's a comment\n  href={x}\n  title={b}\n/>`,
    )
    const tags = [...code.matchAll(/\stitle=/g)].map((m) => tagOf(code, m.index))
    expect(tags).toEqual(["span", "a"])
    const spread = `const hold = paused\n    ? { focusableWhenDisabled: true, title: PAUSED_WHY }\n    : {}\nconst rest = { tone }\nreturn <Button {...hold} {...rest} />`
    expect(spreadTitles("inbox.tsx", spread)).toEqual(["inbox.tsx {...hold}"])
  })
})
