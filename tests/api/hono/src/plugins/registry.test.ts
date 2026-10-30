import { describe, expect, test } from "bun:test"
import { join, relative } from "node:path"

import { Glob } from "bun"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "plugins-test-secret-not-for-use-anywhere"
const { appsRouter } = await import("../../../../../api/hono/src/routers/apps")
const { requirePlugin } = await import("../../../../../api/hono/src/plugins/switch")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")

const SRC = join(import.meta.dir, "../../../../../api/hono/src")

// Every specifier a file reaches another module through: a static or re-exported `from`, a side-effect `import`, or a dynamic `import()`.
const specifiersOf = (text: string): string[] =>
  [...text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!)

// The specifier's path inside src: an @/ alias, or a relative walk from the importing file, so a relative import crosses no boundary unseen. A bare specifier names a package and crosses nothing.
const resolveOf = (file: string, spec: string): string | null => {
  if (spec.startsWith("@/")) return spec.slice(2)
  if (spec.startsWith(".")) return relative(SRC, join(SRC, file, "..", spec))
  return null
}

describe("the plugin registry", () => {
  test("mounts each plugin under the apps router, behind its session check", async () => {
    expect((await appsRouter.request("http://127.0.0.1/changelog")).status).toBe(401)
  })

  test("a plugin's write is refused from any origin but the dashboard's own", async () => {
    const res = await appsRouter.request("http://127.0.0.1/changelog", {
      headers: { origin: "http://evil.localhost" },
      method: "POST",
    })
    expect(res.status).toBe(403)
  })

  test("a plugin whose switch is off answers 404, and one that is on reaches its routes", async () => {
    const app = (on: boolean) =>
      new Hono()
        .use(
          "/changelog/*",
          requirePlugin("changelog", () => on),
        )
        .get("/changelog", (c) => c.text("ok"))
        .get("/changelog/x", (c) => c.text("ok"))
    for (const path of ["/changelog", "/changelog/x"]) {
      expect((await app(false).request(`http://127.0.0.1${path}`)).status).toBe(404)
      expect((await app(true).request(`http://127.0.0.1${path}`)).status).toBe(200)
    }
  })

  // Deleting a plugin's folder and its registry line removes it: core reaches a plugin only through the registry, and no plugin imports another.
  test("core imports no plugin but through the registry, and no plugin imports another", async () => {
    const REGISTRY_USERS = new Set(["index.ts", "routers/apps.ts"])
    const SHARED = new Set(["plugins/registry", "plugins/switch"])
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
          if (!(REGISTRY_USERS.has(file) && target === "plugins/registry"))
            faults.push(`${file} -> ${target}`)
        } else if (into && own && into !== own) faults.push(`${file} -> ${target}`)
        else if (!into && !SHARED.has(target)) faults.push(`${file} -> ${target}`)
      }
    }
    expect(faults).toEqual([])
  })

  // Core reaches an app's lib only through the two files that mount or serve the apps: the roster's ticket pattern once reached it from lib/dashboard, where the plugin test above could not see it.
  test("core imports no app's lib but through the apps router and the entry", async () => {
    const APP_BOUNDARY = new Set(["index.ts", "routers/apps.ts"])
    const faults: string[] = []
    for await (const path of new Glob("**/*.{ts,tsx}").scan(SRC)) {
      const file = relative(SRC, join(SRC, path))
      if (file.startsWith("lib/apps/")) continue
      const text = await Bun.file(join(SRC, path)).text()
      for (const spec of specifiersOf(text)) {
        const target = resolveOf(file, spec)
        if (!target?.startsWith("lib/apps/")) continue
        if (!APP_BOUNDARY.has(file)) faults.push(`${file} -> ${target}`)
      }
    }
    expect(faults).toEqual([])
  })
})
