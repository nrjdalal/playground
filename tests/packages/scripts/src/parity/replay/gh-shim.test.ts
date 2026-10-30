import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ghRecorded,
  normalise,
  type GhRecorded,
} from "../../../../../../packages/scripts/src/parity/replay/gh-shim"

const BIN = join(import.meta.dir, "../../../../../../packages/scripts/src/parity/replay/bin")
const scratch = mkdtempSync(join(tmpdir(), "gh-shim-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const RECORDING: GhRecorded[] = [
  { argv: ["search", "prs", "--owner", "<org>", "ACME-1"], stdout: '[{"number":12}]\n' },
  { argv: ["search", "prs", "--owner", "<org>", "ACME-1", "--review", "required"], stdout: "[]\n" },
  { argv: ["api", "repos/<org>/web/pulls/12"], stdout: '{"number":12}\n' },
]

describe("normalise", () => {
  test("writes every way of naming the org as <org>", () => {
    expect(normalise(["search", "prs", "--owner", "some-co", '"ACME-1"'])).toEqual([
      "search",
      "prs",
      "--owner",
      "<org>",
      "ACME-1",
    ])
    expect(normalise(["pr", "view", "12", "-R", "some-co/web"])).toEqual([
      "pr",
      "view",
      "12",
      "-R",
      "<org>/web",
    ])
    expect(normalise(["pr", "view", "--repo=some-co/web"])).toEqual([
      "pr",
      "view",
      "--repo=<org>/web",
    ])
    expect(normalise(["api", "repos/some-co/web/pulls/12"])).toEqual([
      "api",
      "repos/<org>/web/pulls/12",
    ])
    expect(
      normalise([
        "pr",
        "view",
        "https://github.example.test/some-co/web/pull/31",
        "--json",
        "state",
      ]),
    ).toEqual(["pr", "view", "31", "--json", "state"])
  })
})

describe("ghRecorded", () => {
  test("the longest recorded argv the call holds wins, whatever org the skill names", () => {
    const search = [
      "search",
      "prs",
      "--owner",
      "other-co",
      "ACME-1",
      "--state",
      "open",
      "--json",
      "number",
    ]
    expect(ghRecorded(RECORDING, search)?.stdout).toBe('[{"number":12}]\n')
    expect(ghRecorded(RECORDING, [...search, "--review", "required"])?.stdout).toBe("[]\n")
    expect(ghRecorded(RECORDING, ["api", "repos/x/web/pulls/12"])?.stdout).toBe('{"number":12}\n')
  })

  test("a call the recording does not hold is a miss", () => {
    expect(ghRecorded(RECORDING, ["search", "prs", "--owner", "x", "ACME-2"])).toBeUndefined()
    expect(ghRecorded(RECORDING, ["pr", "merge", "12"])).toBeUndefined()
  })
})

describe("bin/gh on PATH", () => {
  const gh = (args: string[]) => {
    const recording = join(scratch, "gh.json")
    const misses = join(scratch, "misses.jsonl")
    writeFileSync(recording, JSON.stringify(RECORDING))
    writeFileSync(misses, "")
    const run = Bun.spawnSync(["gh", ...args], {
      env: {
        ...process.env,
        PARITY_GH: recording,
        PARITY_MISSES: misses,
        PATH: `${BIN}:${process.env.PATH}`,
      },
    })
    return {
      code: run.exitCode,
      misses: readFileSync(misses, "utf8"),
      out: run.stdout.toString(),
      err: run.stderr.toString(),
    }
  }

  test("answers a recorded call from the recording", () => {
    const r = gh(["search", "prs", "--owner", "some-co", '"ACME-1"', "--state", "open"])
    expect(r).toMatchObject({ code: 0, misses: "", out: '[{"number":12}]\n' })
  })

  test("answers gh auth status as signed in, with no miss", () => {
    const r = gh(["auth", "status"])
    expect(r).toMatchObject({ code: 0, misses: "" })
    expect(r.out).toContain("Logged in to github.example.test")
  })

  test("refuses any other call, logging it as a miss", () => {
    const r = gh(["pr", "merge", "12"])
    expect(r.code).toBe(1)
    expect(r.err).toBe("gh: not in the recording: pr merge 12\n")
    expect(JSON.parse(r.misses)).toEqual({
      argv: ["pr", "merge", "12"],
      kind: "miss",
      server: "gh",
    })
  })
})
