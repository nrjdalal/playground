import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run } from "../../../../../packages/scripts/src/ops-job/job"
import { readPrs } from "../../../../../packages/scripts/src/ops-tick/nightly-clean"
import { fakeRun, ghErrors } from "./fake-run"

// A package whose scripts are named as their commands, so bun run's "$ <command>" line reads the same from the fake.
const pkg = mkdtempSync(join(tmpdir(), "fake-run-"))
writeFileSync(
  join(pkg, "package.json"),
  JSON.stringify({ scripts: { echo: "echo", false: "false" } }),
)
afterAll(() => rmSync(pkg, { force: true, recursive: true }))

test("a command writing to both streams answers the same out from the fake as from the real run", async () => {
  const argv = ["sh", "-c", "printf a; printf b >&2; printf c"]
  const real = await run(argv)
  expect(real).toEqual({ code: 0, out: "acb" })
  expect(await fakeRun({ "sh -c": { err: "b", out: "ac" } }).run(argv)).toEqual(real)
})

test("bun run's own lines read the same from the fake as from the real run, none with --silent", async () => {
  const cases: [string[], Parameters<typeof fakeRun>[0]][] = [
    [["bun", "run", "--cwd", pkg, "echo", "hi"], { echo: "hi\n" }],
    [["bun", "run", "--cwd", pkg, "false"], { false: { code: 1 } }],
    [["bun", "run", "--silent", "--cwd", pkg, "false"], { false: { code: 1 } }],
  ]
  for (const [argv, answers] of cases)
    expect(await fakeRun(answers).run(argv)).toEqual(await run(argv))
})

test("gh's errors answer joins its gh: line straight after the body's closing brace, and its PRs still read", async () => {
  const { out, code } = await fakeRun({
    graphql: ghErrors({ n0: null, n1: { headRefOid: "h1", state: "MERGED" } }, [
      "Could not resolve to a PullRequest with the number of 999.",
    ]),
  }).run(["gh", "api", "graphql", "-f", "query=..."])
  expect(code).toBe(1)
  expect(out).toContain("}gh: Could not resolve to a PullRequest with the number of 999.\n")
  const prs = { byBranch: new Map(), byNumber: new Map() }
  expect(readPrs(out, [], [999, 12], prs)).toBe(true)
  expect([...prs.byNumber]).toEqual([[12, { headRefOid: "h1", state: "MERGED" }]])
})
