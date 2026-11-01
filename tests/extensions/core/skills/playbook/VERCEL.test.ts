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

  test("reads an empty vercel logs as unknown and probes a preview instead", async () => {
    const text = await read("VERCEL.md")
    const step = text.split("\n").find((l) => l.includes("empty `vercel logs`")) ?? ""
    expect(step).toContain("0 records")
    expect(text).toContain("Hono probe")
  })
})
