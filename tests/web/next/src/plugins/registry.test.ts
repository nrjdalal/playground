import { describe, expect, test } from "bun:test"
import { join, relative } from "node:path"

import { Glob } from "bun"

const SRC = join(import.meta.dir, "../../../../../web/next/src")

// Every specifier a file reaches another module through: a static or re-exported `from`, a side-effect `import`, or a dynamic `import()`.
const specifiersOf = (text: string): string[] =>
  [...text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!)

// The specifier's path inside src: an @/ alias, or a relative walk from the importing file, so a relative import crosses no boundary unseen. A bare specifier names a package and crosses nothing.
const resolveOf = (file: string, spec: string): string | null => {
  if (spec.startsWith("@/")) return spec.slice(2)
  if (spec.startsWith(".")) return relative(SRC, join(SRC, file, "..", spec))
  return null
}

describe("the web plugin registry", () => {
  // The web side of the api's rule: core imports the registry and never a plugin's own, and a plugin imports another never. The changelog page mounts its plugin's view, as the api's entry mounts its routers.
  test("core imports no plugin but through the registry or the page mount, and no plugin imports another", async () => {
    const REGISTRY_USERS = new Set([
      "components/apps/app-pane.tsx",
      "components/dashboard/dashboard-aside.tsx",
      "components/dashboard/tab-dot.tsx",
    ])
    const MOUNTS: Record<string, string> = {
      "app/(protected)/dashboard/apps/changelog/page.tsx": "plugins/changelog/view",
    }
    const SHARED = new Set(["plugins/registry"])
    const faults: string[] = []
    for await (const path of new Glob("**/*.{ts,tsx}").scan(SRC)) {
      const file = relative(SRC, join(SRC, path))
      const text = await Bun.file(join(SRC, path)).text()
      for (const spec of specifiersOf(text)) {
        const target = resolveOf(file, spec)
        if (!target?.startsWith("plugins/")) continue
        const into = target.match(/^plugins\/([^/]+)\//)?.[1]
        const own = file.match(/^plugins\/([^/]+)\//)?.[1]
        if (!file.startsWith("plugins/")) {
          const sanctioned =
            (REGISTRY_USERS.has(file) && target === "plugins/registry") || MOUNTS[file] === target
          if (!sanctioned) faults.push(`${file} -> ${target}`)
        } else if (into && own && into !== own) faults.push(`${file} -> ${target}`)
        else if (!into && !SHARED.has(target)) faults.push(`${file} -> ${target}`)
      }
    }
    expect(faults).toEqual([])
  })
})
