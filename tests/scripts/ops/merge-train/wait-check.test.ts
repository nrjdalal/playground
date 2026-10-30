import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "ops",
  "merge-train",
  "wait-check.py",
)
const scratch = mkdtempSync(join(tmpdir(), "ops-wait-check-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The script reads the train's heartbeat and keeps wait-since.json in the state folder under HOME, so a scratch HOME holds both
const run = (home: string) => {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawnSync(["python3", "-I", script], { env })
  expect(child.exitCode).toBe(0)
  return child.stdout.toString()
}

const setup = (name: string, detail: string, since?: number) => {
  const home = join(scratch, name)
  const folder = join(home, ".playground", "ops", "merge-train")
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "..", "ops-merge-train.json"), JSON.stringify({ detail }))
  if (since !== undefined) writeFileSync(join(folder, "wait-since.json"), JSON.stringify({ since }))
  return home
}

test("a wait for the run slot past 15 minutes alerts once", () => {
  const home = setup("long", "waiting for the run slot", Date.now() / 1000 - 901)
  expect(run(home)).toStartWith("ALERT train has waited 15 minutes for a run slot")
  expect(run(home)).toBe("")
})

test("a shorter wait, or none, prints nothing", () => {
  expect(run(setup("short", "waiting for the run slot", Date.now() / 1000 - 60))).toBe("")
  expect(run(setup("none", "checking step 1", Date.now() / 1000 - 901))).toBe("")
})
