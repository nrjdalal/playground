import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../../..")
const SCRIPT = join(ROOT, "packages/scripts/src/trace-count/ci.ts")

const LIST = JSON.stringify({
  companies: ["made-up-co"],
  handles: ["made-up-handle"],
  linearKeys: ["ZZQ"],
  names: ["madeupname"],
  slackIds: ["UMADEUP00"],
})
const ARCHIVE = "qzxowner/qzxarchive"

// The script's own temporary folder, so each run can show it left no scratch data folder behind.
const scratch = mkdtempSync(join(tmpdir(), "trace-count-ci-test-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A run with the TRACE_COUNT repository variable on, as a repo that holds the secrets sets it, unless the case gives its own value or "unset".
const run = (secrets: Record<string, string>, traceCount = "on") => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...secrets,
    TMPDIR: scratch,
    TRACE_COUNT: traceCount,
  }
  if (traceCount === "unset") delete env.TRACE_COUNT
  for (const key of ["FACTORY_ARCHIVE_REPO", "NO_PUBLIC_LEAK_LIST", "OWNER_NAMES"])
    if (!(key in secrets)) delete env[key]
  const child = Bun.spawnSync([process.execPath, SCRIPT], { env })
  expect(readdirSync(scratch)).toEqual([])
  return { code: child.exitCode, err: child.stderr.toString(), out: child.stdout.toString() }
}

describe("trace-count in CI is opt-in, so a fork without the secrets keeps green checks", () => {
  test.each(["unset", "", "off", "yes"])(
    "with TRACE_COUNT %p it prints one notice line and exits 0, though no secret is set",
    (value) => {
      const { code, err, out } = run({}, value)
      expect(code).toBe(0)
      expect(err).toBe("")
      expect(out.trimEnd().split("\n")).toEqual([
        "::notice title=Trace count::trace-count ci: off, since the repository variable TRACE_COUNT is not on; set it to on, with the secrets FACTORY_ARCHIVE_REPO, NO_PUBLIC_LEAK_LIST and OWNER_NAMES, to count",
      ])
    },
  )

  test("the Lint and Build job hands the step the repository variable", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/auto-check-build.yml"), "utf8")
    const step = workflow.slice(workflow.indexOf("- name: Trace count"))
    expect(step).toContain("TRACE_COUNT: ${{ vars.TRACE_COUNT }}")
  })
})

describe("trace-count in CI with TRACE_COUNT on (PG-112)", () => {
  test("with no secret set, it exits 2 and names each one, so CI never passes on a count of nothing", () => {
    const { code, err } = run({})
    expect(code).toBe(2)
    expect(err).toContain("FACTORY_ARCHIVE_REPO, NO_PUBLIC_LEAK_LIST and OWNER_NAMES")
  })

  test("with one secret empty, it exits 2 naming that one alone", () => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: ARCHIVE,
      NO_PUBLIC_LEAK_LIST: LIST,
      OWNER_NAMES: " ",
    })
    expect(code).toBe(2)
    expect(err).toContain("OWNER_NAMES is unset")
    expect(err).not.toContain("FACTORY_ARCHIVE_REPO")
  })

  test("an archive that is not owner/name exits 2, never echoing it, since its links would count nothing", () => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: "https://github.com/qzxowner/qzxarchive",
      NO_PUBLIC_LEAK_LIST: LIST,
      OWNER_NAMES: "qzxowner",
    })
    expect(code).toBe(2)
    expect(err).toContain("FACTORY_ARCHIVE_REPO is not")
    expect(err).not.toContain("qzxarchive")
  })

  test.each([
    ["separators alone", " , "],
    ["a name with a character no name holds", "qzx!owner"],
  ])("owner names of %s exit 2, never echoing them", (_, names) => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: ARCHIVE,
      NO_PUBLIC_LEAK_LIST: LIST,
      OWNER_NAMES: names,
    })
    expect(code).toBe(2)
    expect(err).toContain("OWNER_NAMES is not")
    expect(err).not.toContain("qzx")
  })

  test("a list with an empty key exits 2 naming the key, never echoing the rest", () => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: ARCHIVE,
      NO_PUBLIC_LEAK_LIST: JSON.stringify({ ...JSON.parse(LIST), slackIds: [] }),
      OWNER_NAMES: "qzxowner",
    })
    expect(code).toBe(2)
    expect(err).toContain("trace-count ci: NO_PUBLIC_LEAK_LIST holds no entry under slackIds")
    expect(err).not.toContain("madeupname")
  })

  test("a list that is not no-public-leak's shape exits 2, never echoing it", () => {
    const { code, err } = run({
      FACTORY_ARCHIVE_REPO: ARCHIVE,
      NO_PUBLIC_LEAK_LIST: '{"names":"madeupname"}',
      OWNER_NAMES: "qzxowner",
    })
    expect(code).toBe(2)
    expect(err).toContain("NO_PUBLIC_LEAK_LIST")
    expect(err).not.toContain("madeupname")
  })

  // The made-up values' own hits in this file decide whether the count passes its floor, so the test holds that the count runs, and the real secrets' run in CI holds the floor.
  test("with all three set, trace-count accepts the scratch data folder, counts every kind and removes the folder", () => {
    const { code, err, out } = run({
      FACTORY_ARCHIVE_REPO: ARCHIVE,
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
