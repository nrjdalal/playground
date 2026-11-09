import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const SESSIONS = join(import.meta.dir, "../../../../../extensions/core/skills/playbook/SESSIONS.md")
// SESSIONS.md's Spawn step 2 points to SPAWN.md for the launch line
const SPAWN = join(import.meta.dir, "../../../../../extensions/core/skills/playbook/SPAWN.md")

describe("SESSIONS.md", () => {
  test("spawns every session with the factory settings", async () => {
    expect(await Bun.file(SPAWN).text()).toContain(
      "--settings $HOME/.playground/factory-settings-400k.json",
    )
  })

  test("has an --in worker's brief name capabilities, its own ToolSearch finding the tools", async () => {
    expect(await Bun.file(SESSIONS).text()).toContain(
      "A worker started `--in` another repository takes that folder's MCP tools, so its brief names the capability it needs (search Slack, read Datadog logs) and has the worker find the tool with its own `ToolSearch`",
    )
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

  test("has a worker's brief put the lifecycle table in a long-lived connection's Evidence before round 1", async () => {
    const text = await Bun.file(SESSIONS).text()
    const line = text.split("\n").find((l) => l.includes("lifecycle table")) ?? ""
    expect(line).toContain(
      "a long-lived connection (a socket, a pub/sub subscriber, a retrying client)",
    )
    expect(line).toContain("in its Evidence before round 1")
  })

  test("has a guard's loosening name its one class and put the refusal table in its Evidence before round 1 (PG-439)", async () => {
    const lines = (await Bun.file(SESSIONS).text()).split("\n")
    const brief = lines.find((l) => l.includes("refusal table")) ?? ""
    expect(brief).toContain("a PR loosening a guard puts code-review-loop's refusal table")
    expect(brief).toContain("in its Evidence before round 1")
    expect(brief).toContain(
      "a `canary | head` row for each row it adds to `tests/scripts/hooks/fixtures/refused-forms/` or names in a source file's `allowed` list",
    )
    expect(brief).toContain(
      "the refused-forms test's pass count at canary and at the head for the rest",
    )
    const loosening = lines.find((l) => l.includes("A loosening's plan and brief")) ?? ""
    expect(loosening).toContain("name the one class of forms it lets run")
    expect(loosening).toContain("every other form keeps canary's verdict")
  })
})
