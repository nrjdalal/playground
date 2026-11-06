import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/pr-merge/freeze-cli.ts")

const run = async (path: string, ...args: string[]) => {
  const child = Bun.spawn(["bun", "--no-env-file", CLI, ...args], {
    env: { ...process.env, PLAYGROUND_HELD_PRS: path },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, err, out }
}

// the ship flow runs it at the candidate's pin and again at the tag, so canary holds still between them
test('ship:freeze <version> writes the "*" line beside the PRs\' own, and --end removes it', async () => {
  const path = join(mkdtempSync(join(tmpdir(), "freeze-")), "held-prs.json")
  writeFileSync(path, JSON.stringify({ held: { "acme/archive#9": "own" } }))
  const frozen = await run(path, "v0.0.38")
  expect(frozen).toMatchObject({ code: 0, out: expect.stringContaining("every PR is held") })
  const file = JSON.parse(readFileSync(path, "utf8"))
  expect(file.held).toEqual({
    "*": "v0.0.38 ships: canary is frozen until its tag lands",
    "acme/archive#9": "own",
  })
  expect(Date.parse(file.since["*"])).toBeGreaterThan(Date.now() - 60_000)
  expect(await run(path, "--end")).toMatchObject({
    code: 0,
    out: expect.stringContaining("removed"),
  })
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ held: { "acme/archive#9": "own" } })
})

test("ship:freeze with no version, a version beside --end, or a mistyped flag prints its usage and changes nothing", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "freeze-")), "held-prs.json")
  for (const args of [[], ["--end", "v0.0.38"], ["--ends"]]) {
    const result = await run(path, ...args)
    expect(result.code).toBe(1)
    expect(result.out).toContain("Usage: bun run ship:freeze")
  }
  expect(await Bun.file(path).exists()).toBe(false)
})

// 5 Nov: `freeze-cli.ts status`, run to read the freeze, wrote "status ships: ..." as the "*" line and held every PR
test("ship:freeze status and a word that is not a version write nothing, and the word prints the usage", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "freeze-")), "held-prs.json")
  const before = JSON.stringify({ held: { "acme/archive#9": "own" } })
  writeFileSync(path, before)
  const status = await run(path, "status")
  expect(status).toMatchObject({ code: 0, out: expect.stringContaining('no "*" line is set') })
  const word = await run(path, "foo")
  expect(word.code).toBe(1)
  expect(word.out).toContain("Usage: bun run ship:freeze")
  expect(word.err).toContain("foo is not a version")
  expect(readFileSync(path, "utf8")).toBe(before)
})

test('ship:freeze status prints the "*" line and its since, and says when it has lapsed', async () => {
  const line = "v0.0.38 ships: canary is frozen until its tag lands"
  // an hour old holds every PR, and five hours old is past the 4-hour lapse, so it holds none
  for (const [hours, lapsed] of [
    [1, false],
    [5, true],
  ] as const) {
    const path = join(mkdtempSync(join(tmpdir(), "freeze-")), "held-prs.json")
    const since = new Date(Date.now() - hours * 3_600_000).toISOString()
    const before = JSON.stringify({ held: { "*": line }, since: { "*": since } })
    writeFileSync(path, before)
    const status = await run(path, "status")
    expect(status.code).toBe(0)
    expect(status.out).toContain(`${line} (since ${since})`)
    expect(status.out.includes("lapsed: it holds no PR")).toBe(lapsed)
    expect(readFileSync(path, "utf8")).toBe(before)
  }
})

test("ship:freeze status prints focus's line with its until, and says when it has lapsed", async () => {
  const line = "worker-a has focus: every merge waits until focus ends"
  // focus lapses at its until, so an hour ahead holds every PR and an hour ago holds none
  for (const [hours, lapsed] of [
    [1, false],
    [-1, true],
  ] as const) {
    const path = join(mkdtempSync(join(tmpdir(), "freeze-")), "held-prs.json")
    const until = new Date(Date.now() + hours * 3_600_000).toISOString()
    const before = JSON.stringify({ held: { "*": line }, until: { "*": until } })
    writeFileSync(path, before)
    const status = await run(path, "status")
    expect(status.code).toBe(0)
    expect(status.out).toContain(`${line} (until ${until})`)
    expect(status.out.includes("lapsed: it holds no PR")).toBe(lapsed)
    expect(readFileSync(path, "utf8")).toBe(before)
  }
})
