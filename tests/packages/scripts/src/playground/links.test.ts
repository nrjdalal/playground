import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { linksInto } from "../../../../../packages/scripts/src/playground/links"

const scratch = mkdtempSync(join(tmpdir(), "playground-links-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const link = (target: string, path: string) => {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path)
}

test("linksInto finds every link link-skills.sh makes into the checkout, and no other", () => {
  const repo = join(scratch, "repo")
  const repoTwin = join(scratch, "repo-twin")
  const home = join(scratch, "home")
  const data = join(home, ".playground")
  const ours = [
    join(home, ".bun", "bin", "playground"),
    join(home, ".claude", "skills", "pr"),
    join(data, "brief-rush.md"),
    join(data, "handoffs", "new-worker.md"),
    join(data, "ops", "checks", "go.py"),
    join(data, "ops", "run-slot.sh"),
  ]
  for (const path of ours) link(join(repo, "x"), path)
  link(join(repoTwin, "skills", "pr"), join(home, ".claude", "skills", "twin"))
  link("/elsewhere/bun", join(home, ".bun", "bin", "bun"))
  link(join(repo, "x"), join(data, "sessions", "deep", "link"))
  link(repo, join(data, "repo-itself"))
  mkdirSync(join(data, "ops", "notes"), { recursive: true })

  expect(linksInto(repo, home, data).map((l) => l.path)).toEqual(
    [...ours, join(data, "repo-itself")].toSorted(),
  )
})

test("linksInto reads missing folders as holding no links", () => {
  expect(linksInto("/repo", join(scratch, "nobody"), join(scratch, "nobody", "data"))).toEqual([])
})
