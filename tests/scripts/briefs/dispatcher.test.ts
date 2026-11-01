import { expect, test } from "bun:test"
import { join } from "node:path"

test("the dispatcher's brief template loads the playbook and carries the signal rule", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/dispatcher.md")).text()
  expect(text).toContain("Load the playbook skill")
  expect(text).toContain("**signal**: signal only processes you started")
})

test("the dispatcher starts the Optimizer at its own start, so ops-tick's retro beats reach a running session", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/dispatcher.md")).text()
  expect(text).toContain("start the Optimizer with `playground optimizer`")
})

test("the dispatcher reads the Dashboard by /api/health and the Inbox by bun run ask at its start, and reports each by that result (PG-280)", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/dispatcher.md")).text()
  const step = text.match(/^2\. .*$/m)?.[0] ?? ""
  expect(step).toContain(
    '`R="${PLAYGROUND_REPO:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}"`',
  )
  expect(step).toContain("a session the Dashboard hosts gets no `PLAYGROUND_REPO`")
  expect(step).toContain(
    '`curl -sS "$(cd "$R/.claude/worktrees/desk" && bunx portless get api.playground)/api/health"`',
  )
  expect(step).toContain('`bun run --cwd "$R" ask open`')
  expect(step).toContain("When `$R/.claude/worktrees/desk` is missing")
  expect(step).toContain("Report each by that command's output alone")
  expect(step).toContain("Done when your first report quotes each command's result")
})
