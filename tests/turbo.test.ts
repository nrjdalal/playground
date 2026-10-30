import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

type Turbo = { tasks: Record<string, { outputs?: string[] }> }

// next dev keeps its Turbopack cache in .next/dev, so a build output that takes in .next/** stores it in every snapshot, and a cache hit restores another state's dev cache over the checkout's.
describe("turbo.json", () => {
  test("every outputs list that takes in .next leaves out next dev's cache", async () => {
    const turbo = Bun.JSONC.parse(await Bun.file(join(ROOT, "turbo.json")).text()) as Turbo
    const web = Object.entries(turbo.tasks).filter(([, task]) => task.outputs?.includes(".next/**"))
    expect(web.map(([name]) => name).sort()).toEqual(["@web/next#build", "build", "build:vercel"])
    expect(web.filter(([, task]) => !task.outputs?.includes("!.next/dev/**"))).toEqual([])
  })
})
