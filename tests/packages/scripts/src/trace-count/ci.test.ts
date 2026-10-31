import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "../../../../../packages/scripts/src/trace-count/ci.ts")

const LIST = JSON.stringify({
  companies: ["made-up-co"],
  handles: ["made-up-handle"],
  linearKeys: ["ZZQ"],
  names: ["madeupname"],
  slackIds: ["UMADEUP00"],
})

const run = (secrets: Record<string, string>) => {
  const env: Record<string, string | undefined> = { ...process.env, ...secrets }
  for (const key of ["FACTORY_ARCHIVE_REPO", "NO_PUBLIC_LEAK_LIST", "OWNER_NAMES"])
    if (!(key in secrets)) delete env[key]
  const child = Bun.spawnSync([process.execPath, SCRIPT], { env })
  return { code: child.exitCode, err: child.stderr.toString(), out: child.stdout.toString() }
}

describe("trace-count in CI (PG-112)", () => {
  test("with no secret set, it exits 2 and names each one, so CI never passes on a count of nothing", () => {
    const { code, err } = run({})
    expect(code).toBe(2)
    expect(err).toContain("FACTORY_ARCHIVE_REPO, NO_PUBLIC_LEAK_LIST and OWNER_NAMES")
  })

  test("with one secret empty, it exits 2 naming that one alone", () => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: "qzxowner/qzxarchive",
      NO_PUBLIC_LEAK_LIST: LIST,
      OWNER_NAMES: " ",
    })
    expect(code).toBe(2)
    expect(err).toContain("OWNER_NAMES is unset")
    expect(err).not.toContain("FACTORY_ARCHIVE_REPO")
  })

  test("a list that is not no-public-leak's shape exits 2, never echoing it", () => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: "qzxowner/qzxarchive",
      NO_PUBLIC_LEAK_LIST: '{"names":"madeupname"}',
      OWNER_NAMES: "qzxowner",
    })
    expect(code).toBe(2)
    expect(err).toContain("NO_PUBLIC_LEAK_LIST")
    expect(err).not.toContain("madeupname")
  })

  // The made-up values' own hits in this file decide whether the count passes its floor, so the test holds that the count runs, and the real secrets' run in CI holds the floor.
  test("with all three set, trace-count accepts the scratch data folder and counts every kind", () => {
    const { code, err, out } = run({
      FACTORY_ARCHIVE_REPO: "qzxowner/qzxarchive",
      NO_PUBLIC_LEAK_LIST: LIST,
      OWNER_NAMES: "Qzxowner, qzxhandle",
    })
    expect(err).not.toContain("unset")
    expect(err).not.toContain("trace-count ci:")
    expect(code).not.toBe(2)
    for (const kind of ["archiveLinks", "names", "ownerName", "slackIds"])
      expect(out).toMatch(new RegExp(`^${kind}\\t\\d+\\t`, "m"))
  }, 60_000)
})
