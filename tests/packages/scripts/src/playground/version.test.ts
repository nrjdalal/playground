import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  renderedSet,
  version,
  versionLines,
} from "../../../../../packages/scripts/src/playground/version"
import { writeTree } from "../../../../../packages/settings/src/folder"

const scratch = mkdtempSync(join(tmpdir(), "playground-version-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

describe("versionLines", () => {
  test("names the checkout's tag and sha, the store's last commit and Claude Code's version", () => {
    expect(
      versionLines({
        claude: "2.1.230",
        describe: "v0.0.141-3-gabc1234",
        rendered: "9f2c",
        sha: "abc1234def",
      }),
    ).toEqual([
      "playground v0.0.141-3-gabc1234 (abc1234def)",
      "store      9f2c",
      "claude     2.1.230",
    ])
  })

  test("says what is not there", () => {
    expect(versionLines({ claude: null, describe: null, rendered: null, sha: "abc" })).toEqual([
      "playground untagged (abc)",
      "store      none rendered",
      "claude     not found",
    ])
  })
})

describe("renderedSet", () => {
  test("is the login scope's last commit, short", () => {
    const data = join(scratch, "data")
    mkdirSync(join(data, "extensions"), { recursive: true })
    writeFileSync(join(data, "extensions", "login"), "tester\n")
    const sha = writeTree(data, "tester", new Map([["rules/a.md", "a"]]), {
      author: "t",
      reason: "seed",
    })
    expect(sha).toStartWith(renderedSet(data)!)
  })

  test("is null with no extensions yet", () => {
    expect(renderedSet(join(scratch, "none"))).toBeNull()
  })
})

test("version reads the tag and sha from the checkout itself", () => {
  const repo = join(scratch, "repo")
  mkdirSync(repo)
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, env })
  git("init", "-q")
  git("commit", "-q", "--allow-empty", "-m", "seed")
  git("tag", "v0.0.1")
  const sha = git("rev-parse", "HEAD").stdout.toString().trim()
  // a run inside a git hook would otherwise send version's own git to the hook's repo
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key]
  const [checkout, store] = version(repo, join(scratch, "none"))
  expect(checkout).toBe(`playground v0.0.1 (${sha})`)
  expect(store).toBe("store      none rendered")
})
