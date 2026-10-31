import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import { hostedPagesOnly, localPagesOnly } from "../../../../../web/next/src/lib/local-pages"

const layout = "web/next/src/app/(protected)/layout.tsx"
const SRC = resolve("web/next/src")
const YARD = join(SRC, "app/(yard)")

const notFoundOf = (call: () => void) => {
  try {
    call()
  } catch (error) {
    return (error as { digest?: string }).digest ?? null
  }
  return null
}

// a .ts file parsed as tsx reads an arrow generic as JSX, so each takes its own loader
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
}
const resolveFile = (base: string) =>
  [base, ...[".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext)].find(
    (file) => existsSync(file) && statSync(file).isFile(),
  )

// Every web file the given ones reach through runtime imports (type-only ones are erased).
const reach = (entries: string[]) => {
  const files = new Set<string>()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    const transpiler = transpilers[file.endsWith(".tsx") ? "tsx" : "ts"]
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      const local = path.startsWith("@/")
        ? join(SRC, path.slice(2))
        : path.startsWith(".")
          ? resolve(dirname(file), path)
          : null
      const found = local && resolveFile(local)
      if (found && /\.tsx?$/.test(found)) queue.push(found)
    }
  }
  return [...files].map((file) => relative(SRC, file))
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  )

describe("the dashboard's local pages on the hosted build", () => {
  test("a hosted build answers them with the app's 404", () => {
    expect(notFoundOf(() => localPagesOnly(true))).toStartWith("NEXT_HTTP_ERROR_FALLBACK;404")
  })

  test("a local stack serves them", () => {
    expect(() => localPagesOnly(false)).not.toThrow()
  })

  test("their layout refuses before it reads anything", async () => {
    const source = await Bun.file(layout).text()
    const body = source.slice(source.indexOf("export default async function Layout"))
    expect(body.split("\n")[1]?.trim()).toBe("localPagesOnly(config.hosted)")
  })
})

describe("Yard's pages, hosted alone", () => {
  test("a local stack answers them with the app's 404, and the hosted build serves them", () => {
    expect(notFoundOf(() => hostedPagesOnly(false))).toStartWith("NEXT_HTTP_ERROR_FALLBACK;404")
    expect(notFoundOf(() => hostedPagesOnly(true))).toBeNull()
  })

  test("their layout refuses before anything else", async () => {
    const source = await Bun.file(join(YARD, "yard/layout.tsx")).text()
    const body = source.slice(source.indexOf("export default function YardLayout"))
    expect(body.split("\n")[1]?.trim()).toBe("hostedPagesOnly(config.hosted)")
  })

  test("the hosted web renders no Inbox aside, so no Preview row", () => {
    const reached = reach(filesUnder(YARD))
    expect(reached).toContain("components/yard/yard-groups.tsx")
    expect(reached.filter((file) => /dashboard-aside|preview-pane/.test(file))).toEqual([])
  })

  test("the dashboard's own pages do reach the aside, so the walk sees what it checks", () => {
    expect(reach([join(SRC, "app/(protected)/dashboard/layout.tsx")])).toContain(
      "components/dashboard/dashboard-aside.tsx",
    )
  })
})
