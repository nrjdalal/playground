import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const dir = join(import.meta.dir, "../../../../../extensions/core/skills/playbook")
const read = (name: string) => Bun.file(join(dir, name)).text()

describe("VERCEL.md", () => {
  test("playbook points at it before any vercel command", async () => {
    const lines = (await read("SKILL.md")).split("\n")
    const at = lines.findIndex((l) => l.startsWith("- [VERCEL.md](VERCEL.md)"))
    expect(at).toBeGreaterThan(lines.indexOf("## Where the rest lives"))
    expect(lines[at + 1]).toContain("Read it before you run any `vercel` command")
  })

  test("keeps the integration's env off disk with --no-env-pull, and drops .env.local right after vercel link alone", async () => {
    const lines = (await read("VERCEL.md")).split("\n")
    const flag =
      lines.find((l) => l.includes("`vercel integration add <name> --no-env-pull`")) ?? ""
    expect(flag).toContain("development env")
    expect(flag).toContain("vercel 65.8.0")
    const drop = lines.find((l) => l.includes("`rm -f .env.local`")) ?? ""
    expect(drop).toContain("right after `vercel link`,")
    expect(drop).not.toContain("vercel integration add")
    expect(drop).toContain("65.8.0")
  })

  test("reads vercel api through its JSON alone", async () => {
    const step =
      (await read("VERCEL.md")).split("\n").find((l) => l.includes("`vercel api --raw")) ?? ""
    expect(step).toContain("| grep -o '{.*' | jq")
    expect(step).toContain("Invalid numeric literal")
  })

  test("reads an empty vercel logs as unknown, names the hang's cause, and probes one difference a preview", async () => {
    const lines = (await read("VERCEL.md")).split("\n")
    const logs = lines.find((l) => l.includes("empty `vercel logs`")) ?? ""
    expect(logs).toContain("0 records")
    expect(logs).toContain("already called `listen()`")
    const probe = lines.find((l) => l.includes("Hono probe")) ?? ""
    expect(probe).toContain(
      "one difference a preview (an import, the export's shape, a runtime setting)",
    )
    const exported = lines.find((l) => l.includes("`createAdaptorServer`")) ?? ""
    expect(exported).toContain("export it unlistened")
    expect(exported).toContain("never `serve()`, which calls `listen()` and hangs on Vercel")
    expect(exported).toContain("62 s")
    const done = lines.findIndex((l) =>
      l.includes("Done when the first preview that hangs names that difference"),
    )
    expect(done).toBeGreaterThan(lines.indexOf(exported))
  })

  test("dates only what a record dates: the opening says measured, and the hang step cites its probes' day", async () => {
    const lines = (await read("VERCEL.md")).split("\n")
    expect(lines.find((l) => l.startsWith("Three traps"))).toBe(
      "Three traps one CLI deploy met (measured), each a step at the command it follows.",
    )
    expect(lines.find((l) => l.includes("`createAdaptorServer`"))).toContain("measured, 31 Oct")
  })
})
