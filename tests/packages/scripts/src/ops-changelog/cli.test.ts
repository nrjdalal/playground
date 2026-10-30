import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { dataDirOf } from "../../../../../packages/env/src/data-dir"
import { BEATS } from "../../../../../packages/scripts/src/ops-changelog/cli"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const fake = (ps: string) => {
  const ran: string[][] = []
  const ctx: Context = {
    now: new Date(),
    ops: "",
    repo: "/dashboard",
    run: async (argv) => {
      ran.push(argv)
      if (argv[0] === "sysctl") return { code: 0, out: "{ 1.00 2.00 3.00 }\n1\n" }
      if (argv[0] === "ps") return { code: 0, out: ps }
      return { code: 0, out: "ran changelog\n" }
    },
    send: async () => true,
  }
  return { ctx, ran }
}

describe("the changelog beat", () => {
  test("runs at 4-59/5 * * * * in the dashboard's checkout and appends to its log", async () => {
    expect(BEATS.map((b) => [b.name, b.cron])).toEqual([["changelog", "4-59/5 * * * *"]])
    const { ctx, ran } = fake("COMMAND\n")
    await BEATS[0]!.run(ctx)
    expect(ran.at(-1)).toEqual([
      process.execPath,
      "run",
      "--cwd",
      "/dashboard",
      ...["changelog", "sync"],
    ])
    expect(readFileSync(join(dataDirOf(process.env), "dashboard-changelog.log"), "utf8")).toContain(
      "ran changelog\n",
    )
  })

  test("holds quietly while a seed runs", async () => {
    const { ctx, ran } = fake("COMMAND\nbun api/hono/src/plugins/changelog/cli.ts seed\n")
    await BEATS[0]!.run(ctx)
    expect(ran.some((argv) => argv[0] === process.execPath)).toBe(false)
  })
})
