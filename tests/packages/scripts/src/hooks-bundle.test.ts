import { expect, test } from "bun:test"
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

import { BUNDLED, entries, FIX, ROOT, stale } from "../../../../packages/scripts/src/hooks-bundle"

test("every bundle in scripts/hooks/bundle is what a fresh build of its source writes", async () => {
  const drift = await stale(ROOT)
  expect(drift, `stale: ${drift.join(", ")}; ${FIX}`).toEqual([])
})

test("scripts/hooks/bundled holds one bundle per PreToolUse guard and per worker, and nothing else", async () => {
  const names = (await entries(ROOT)).map((name) => `${name}.js`).sort()
  expect(readdirSync(join(ROOT, BUNDLED)).sort()).toEqual(names)
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
