import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const SESSIONS = join(import.meta.dir, "../../../../../extensions/core/skills/playbook/SESSIONS.md")

describe("SESSIONS.md", () => {
  test("spawns every session with the factory settings", async () => {
    expect(await Bun.file(SESSIONS).text()).toContain(
      "--settings $HOME/.playground/factory-settings-400k.json",
    )
  })

  test("has an --in worker's brief name capabilities, its own ToolSearch finding the tools", async () => {
    expect(await Bun.file(SESSIONS).text()).toContain(
      "A worker started `--in` another repository takes that folder's MCP tools, so its brief names the capability it needs (search Slack, read Datadog logs) and has the worker find the tool with its own `ToolSearch`",
    )
  })

  test("closes a session that still runs with --force", async () => {
    const closes = (await Bun.file(SESSIONS).text()).match(
      /cmux (?:close-surface|workspace close) [^`\n]*/g,
    )
    expect(closes?.length).toBeGreaterThanOrEqual(2)
    for (const close of closes ?? []) expect(close).toEndWith(" --force")
  })

  test("holds the brief templates' fill rule (#1664)", async () => {
    const text = await Bun.file(SESSIONS).text()
    expect(text).toContain("a fill replaces those tokens alone")
    expect(text).toContain("every other angle-bracket word stays as written for the reader")
    expect(text).toContain("spells it in words (two underscores, NAME, two underscores)")
  })

  test("has a worker's brief open its draft before waiting on CI, and cite a run by its id or link", async () => {
    const text = await Bun.file(SESSIONS).text()
    const line =
      text.split("\n").find((l) => l.includes("opens its draft PR before it waits on CI")) ?? ""
    expect(line).toContain(
      "A worker's brief says that CI starts only on a pull request into `canary`",
    )
    expect(line).toContain("cites a run by its run id or link")
  })

  test("has a worker's brief keep a merge of canary plain, each edit after it a commit of its own", async () => {
    const text = await Bun.file(SESSIONS).text()
    const line =
      text.split("\n").find((l) => l.includes("keeps the merge commit a plain merge")) ?? ""
    expect(line).toContain("merges `canary` or its stack's parent into its PR")
    expect(line).toContain("each edit after it as a commit of its own")
    expect(line).toContain("an edit inside a merge as blocking")
  })
})
