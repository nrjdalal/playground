import { expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

const HISTORY = "dated history"
const ALIAS = "the one-ship alias of the sessions read's old codes, which #1447 drops"
const GUARD = "a guard, or a proof, against the cmux app, live while cmux.app is installed"

// Every line outside tests/ that names cmux (#414), counted per file: each count holds one class or more, and a file not listed names it nowhere.
const ALLOWED: Record<string, [number, string]> = {
  ".agents/adr/0010-ops-alerts-go-through-a-relay.md": [2, HISTORY],
  ".agents/dashboard/herdr.md": [1, GUARD],
  ".agents/dashboard/messages.md": [2, GUARD],
  ".agents/dashboard/stack.md": [1, GUARD],
  "AGENTS.md": [1, GUARD],
  "api/hono/src/lib/claude-binary.ts": [2, GUARD],
  "api/hono/src/lib/dashboard/inbox.ts": [2, ALIAS],
  "api/hono/src/plugins/changelog/seed.json": [2, HISTORY],
  "docs/playground/playbook.md": [2, HISTORY],
  "extensions/core/skills/code-review-loop/SKILL.md": [1, HISTORY],
  "extensions/core/skills/playbook/SESSIONS.md": [2, `${HISTORY}; ${GUARD}`],
  "packages/scripts/src/ops-herdr/cli.ts": [1, GUARD],
  "packages/scripts/src/ops-herdr/herdr.ts": [1, GUARD],
  "packages/scripts/src/parity/replay/run.ts": [1, GUARD],
  "scripts/README.md": [4, `${HISTORY}; ${GUARD}`],
  "scripts/hooks/bundled/no-raw-spawn.js": [10, GUARD],
  "scripts/hooks/no-raw-spawn.ts": [17, GUARD],
  "scripts/ops/README.md": [2, GUARD],
}

test("no line outside tests/ names cmux but dated history, the alias and the guards against the installed app (#414)", () => {
  const out = Bun.spawnSync(["git", "-C", ROOT, "grep", "-c", "-i", "cmux", "--", ".", ":!tests"], {
    stdout: "pipe",
  })
  const counts = Object.fromEntries(
    out.stdout
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.lastIndexOf(":")
        return [line.slice(0, at), Number(line.slice(at + 1))]
      }),
  )
  expect(counts).toEqual(
    Object.fromEntries(Object.entries(ALLOWED).map(([file, [count]]) => [file, count])),
  )
})
