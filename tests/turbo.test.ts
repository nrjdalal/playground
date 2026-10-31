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

  // check-types writes and reads .next/types while next build deletes and rewrites it, so CI's `turbo run check-types build` fails on a missing ./routes.js when the two run side by side.
  test("web's build waits for web's check-types, so the two never share .next/types at once", () => {
    const dry = Bun.spawnSync(
      ["bunx", "turbo", "run", "check-types", "build", "--filter=@web/next", "--dry=json"],
      { cwd: ROOT, env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" } },
    )
    expect(dry.exitCode).toBe(0)
    const { tasks } = JSON.parse(dry.stdout.toString()) as {
      tasks: { dependencies: string[]; taskId: string }[]
    }
    expect(tasks.find((task) => task.taskId === "@web/next#build")?.dependencies).toContain(
      "@web/next#check-types",
    )
  }, 60_000)
})
