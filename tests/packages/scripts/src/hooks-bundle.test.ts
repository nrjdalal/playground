import { describe, expect, test } from "bun:test"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import { isBuiltin } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BUNDLED,
  entries,
  FIX,
  HOOKS,
  ROOT,
  stale,
} from "../../../../packages/scripts/src/hooks-bundle"

test("every bundle in scripts/hooks/bundled is what a fresh build of its source writes", async () => {
  const drift = await stale(ROOT)
  expect(drift, `stale: ${drift.join(", ")}; ${FIX}`).toEqual([])
})

test("scripts/hooks/bundled holds one bundle per PreToolUse guard and per worker, and nothing else", async () => {
  const names = (await entries(ROOT)).map((name) => `${name}.js`).sort()
  expect(readdirSync(join(ROOT, BUNDLED)).sort()).toEqual(names)
})

// A guard that imports another guard keeps that guard's main block live when both are entry points of one build, and the imported block then reads stdin first and judges the call by its own rules.
test("each guard bundle runs one main block, its own, and the worker bundle none", async () => {
  for (const name of await entries(ROOT)) {
    const text = readFileSync(join(ROOT, BUNDLED, `${name}.js`), "utf8")
    const blocks = text.match(/\bif \(import\.meta\.main\)/g)?.length ?? 0
    expect({ blocks, name }).toEqual({ blocks: name.endsWith("-worker") ? 0 : 1, name })
  }
})

// Each call goes in as stdin to the bundle as its wrapper runs it and to its source, which judge it as data; the forms are this test's own, none from the refused-forms fixture.
describe("a bundle run as its wrapper runs it gives its source's verdict", () => {
  const worktree = join(ROOT, ".claude", "worktrees", "a")
  const call = (cwd: string, command: string) =>
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      tool_input: { command },
      tool_name: "Bash",
    })
  test.each([
    [
      "no-ours-merge",
      call(ROOT, "git merge -s ours origin/canary"),
      2,
      "no-ours-merge hook refuses",
    ],
    ["no-ours-merge", call(ROOT, "git stash"), 0, ""],
    [
      "no-unslotted-run",
      call(worktree, `bun run --cwd ${worktree} test`),
      2,
      "no-unslotted-run hook refuses",
    ],
  ])("%s on %s", async (name, raw, code, says) => {
    for (const file of [join(BUNDLED, `${name}.js`), join(HOOKS, `${name}.ts`)]) {
      const proc = Bun.spawn(["bun", "--no-env-file", file], {
        cwd: ROOT,
        env: { ...process.env, PLAYGROUND_ROLE: "worker" },
        stderr: "pipe",
        stdin: new Blob([raw]),
        stdout: "pipe",
      })
      const exit = await proc.exited
      const stderr = await new Response(proc.stderr).text()
      expect({ code: exit, file, refusal: stderr.includes(says) }).toEqual({
        code,
        file,
        refusal: true,
      })
      if (!says) expect(stderr).toBe("")
    }
  })
})

// A bundle that imports only Bun's and Node's own modules reaches no node_modules, so a missing or damaged install cannot crash it.
test("every bundle imports nothing but Bun's and Node's own modules", () => {
  for (const file of readdirSync(join(ROOT, BUNDLED))) {
    const text = readFileSync(join(ROOT, BUNDLED, file), "utf8")
    const specifiers = [
      ...text.matchAll(/^\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/gm),
      ...text.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
      ...text.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]!)
    expect(
      specifiers.filter((s) => !isBuiltin(s) && !s.startsWith("bun:") && s !== "bun"),
      file,
    ).toEqual([])
  }
})

// Each bundle copied to a folder with no node_modules above it, as a damaged install leaves the checkout, starts and allows an empty call; the scratch folder stays for the system to clear, since a test removes no tree.
test("every bundled guard runs on {} with no node_modules reachable and exits 0", async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "hooks-bundle-")))
  const bundled = join(scratch, BUNDLED)
  mkdirSync(bundled, { recursive: true })
  for (const file of readdirSync(join(ROOT, BUNDLED)))
    copyFileSync(join(ROOT, BUNDLED, file), join(bundled, file))
  expect(() => Bun.resolveSync("zod", bundled)).toThrow()
  for (const name of await entries(ROOT)) {
    if (name.endsWith("-worker")) continue
    const proc = Bun.spawn(["bun", "--no-env-file", join(bundled, `${name}.js`)], {
      cwd: scratch,
      env: { ...process.env, PLAYGROUND_ROLE: "" },
      stderr: "pipe",
      stdin: new Blob(["{}"]),
      stdout: "pipe",
    })
    const code = await proc.exited
    expect({ code, name, stderr: await new Response(proc.stderr).text() }).toEqual({
      code: 0,
      name,
      stderr: "",
    })
  }
}, 60_000)
