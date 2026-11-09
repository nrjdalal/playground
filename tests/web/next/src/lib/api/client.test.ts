import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { TYPING_LAG_SCRIPT } from "../../../../../../packages/scripts/src/verify/typing-lag"
import { apiClient } from "../../../../../../web/next/src/lib/api/client"

// #1482: a verify check that keeps the dashboard's socket by its URL holds no frame when the path it names is one the web never opens.
describe("each verify check's socket path", () => {
  const web = new URL(apiClient.v1.ws.$url()).pathname
  const dir = join(import.meta.dir, "../../../../../../packages/scripts/src/verify")

  test("typing-lag keeps the socket the web opens", () => {
    expect(web).toBe("/api/v1/ws")
    expect(TYPING_LAG_SCRIPT).toContain(`String(args[0]).includes("${web}")`)
  })

  test("names only the path the web's socket opens", async () => {
    const named: string[] = []
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .sort()) {
      const text = await Bun.file(join(dir, file)).text()
      for (const [path] of text.matchAll(/(?:\/[\w-]+)+\/ws(?![\w/-])/g))
        if (path !== web) named.push(`${file}: ${path}`)
    }
    expect(named).toEqual([])
  })
})
