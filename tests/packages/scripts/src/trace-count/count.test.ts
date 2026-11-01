import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  COUNTS,
  type Counts,
  count,
  type File,
  KEPT,
  type Kept,
  list,
  lowered,
  refusal,
  risen,
  stale,
  tree,
} from "../../../../../packages/scripts/src/trace-count/count"
import {
  EMPTY_LIST,
  reposOf,
  UNSET_REPOS,
} from "../../../../../packages/scripts/src/trace-count/kinds"
import { capital, OLD as OLD_NAME } from "../../../../old-names"

const root = join(import.meta.dir, "..", "..", "..", "..", "..")
// Built at run time, so this file's own text adds no trace to the tree's count.
const ref = (n: number) => `#${n}`
const KEY = ["LM", "7"].join("-")
const OLD = ["light", "kid"].join("")
const OLD_SKILL = ["light", "review"].join("")
// Made-up values, one per list key.
const LIST = {
  companies: ["Vantorix"],
  handles: ["qmarsh"],
  linearKeys: ["VX"],
  names: ["Quilla Marsh"],
  slackIds: ["C0FAKE1234"],
}

describe("the trace count", () => {
  test("counts each kind, its list-fed kinds from the list", () => {
    const text = [
      "Quilla Marsh and @qmarsh at Vantorix, in C0FAKE1234, on VX-12",
      `mail ${["quilla", "qwerty.io"].join("@")}, see ${KEY} and #123, as ${OLD_NAME.dispatcher} and ${OLD_NAME.builder} said`,
      "https://github.com/octo/vault/pull/4",
      `run ${OLD_SKILL} and ${OLD_SKILL}-scan, not playground-review`,
    ].join("\n")
    const repos = reposOf({
      schemaVersion: 1,
      values: { "factory.archiveRepo": "octo/vault", "owner.names": ["tobin"] },
    })
    expect(count([{ path: "a.md", text }], LIST, repos)).toEqual({
      archiveKeys: 1,
      archiveLinks: 1,
      companies: 1,
      companyName: 0,
      emails: 1,
      handles: 1,
      issueRefs: 1,
      lightWords: 0,
      linearKeys: 1,
      names: 1,
      oldNames: 2,
      oldSkillNames: 2,
      ownerName: 0,
      slackIds: 1,
    })
  })

  test("counts the owner's names the settings give and the archive's owner, past an address and an archive link", () => {
    const repos = reposOf({
      schemaVersion: 1,
      values: { "factory.archiveRepo": "qmarsh/vault", "owner.names": ["quilla"] },
    })
    const text = [
      "Quilla asked for it, QUILLA again, and @qmarsh said so at github.com/qmarsh",
      `mail ${["quilla", "vantorix.io"].join("@")}, see qmarsh/vault/pull/3, quillas and qmarshes`,
    ].join("\n")
    const counts = count([{ path: "a.md", text }], undefined, repos)
    expect(counts.ownerName).toBe(4)
    expect(counts.archiveLinks).toBe(1)
  })

  test("counts a quote set against the owner and anyone's dated quote, as a name is, and nothing with no names to read", () => {
    // Built at run time, so this file's own text holds no quote.
    const owner = ["the", "owner"].join(" ")
    const text = [
      `${owner}, 24 Oct: "ship it"`,
      `Test note (${["Corin", "23 Oct"].join(", ")}: "do it this way").`,
      `as ${owner} said, and ${owner} wrote it down`,
      `${owner}'s go through the Inbox, by 24 Oct: no quote`,
    ].join("\n")
    const repos = reposOf({ schemaVersion: 1, values: { "owner.names": ["tobin"] } })
    expect(count([{ path: "a.md", text }], undefined, repos).ownerName).toBe(4)
    expect(count([{ path: "a.md", text }]).ownerName).toBeUndefined()
  })

  test("counts the company's name in any spacing, and no longer word that holds it", () => {
    const company = ["light", "work"].join("")
    const product = ["new", "gen"].join("")
    const text = `${company}-blue, ${["Light", "Work"].join(" ")}, ${["light", "work"].join("-")}, ${product.toUpperCase()}; ${company}ers, ${product}eration`
    expect(count([{ path: "a.md", text }]).companyName).toBe(4)
  })

  test("counts a factory or old skill word glued into a longer one, which the old-name kinds read past", () => {
    const old = OLD_NAME.dispatcher
    const text = [
      `${old}Music, from${capital(old)}, the ${old}s, run ${["light", "quill"].join("")}`,
      `${old} alone, a highlight, lightfacts, the worker-light`,
    ].join("\n")
    const counts = count([{ path: "a.ts", text }])
    expect(counts.lightWords).toBe(4)
    expect(counts.oldNames).toBe(1)
  })

  test("a list kind is unmeasured with no list, not counted as gone", () => {
    const counts = count([{ path: "a.md", text: "Quilla Marsh" }], EMPTY_LIST)
    expect(counts.names).toBeUndefined()
    expect(counts.issueRefs).toBe(0)
  })

  test("reads past a lockfile, whose integrity hash can hold a list value by chance", () => {
    const hash = `"sha512-abc${LIST.slackIds[0]}xyz=="`
    const lock = count([{ path: "bun.lock", text: ` "x": ["x@1.0.0", "", {}, ${hash}],` }], LIST)
    expect(lock.slackIds).toBe(0)
    expect(count([{ path: "tests/a.ts", text: `"${LIST.slackIds[0]}"` }], LIST).slackIds).toBe(1)
  })

  test("reads past a live name the migration moves, the public repositories' names and the seed's left-out paths", () => {
    const counts = count([
      {
        path: "a.ts",
        text: `const db = "${OLD_NAME.dispatcher}-desk-db"\nsee ${UNSET_REPOS.public.join(" and ")}`,
      },
      { path: "packages/scripts/src/trace-count/counts.json", text: `#123 ${OLD_NAME.dispatcher}` },
      { path: "packages/scripts/src/trace-count/kept.json", text: "#456" },
    ])
    expect(counts.oldNames).toBe(0)
    expect(counts.issueRefs).toBe(0)
  })

  test("reads past the files that define the old names, and a fixture's made-up PR numbers and branch keys but not its other traces", () => {
    const counts = count([
      { path: "packages/scripts/src/rename/rules.ts", text: `${OLD} ${ref(123)}` },
      { path: "packages/scripts/src/trace-count/kinds.ts", text: `${OLD} ${ref(124)}` },
      {
        path: "api/hono/src/fixtures/dashboard.json",
        text: `"pr": "${ref(97)}", "branch": "${KEY}-row-wrap", "from": "${OLD}"`,
      },
      { path: "packages/scripts/src/parity/replay/fixtures/scan/slack.json", text: ref(28) },
    ])
    expect(counts.archiveKeys).toBe(0)
    expect(counts.issueRefs).toBe(0)
    expect(counts.oldNames).toBe(1)
  })

  test("reads past tests/ for issue numbers alone, so a test's other traces still count", () => {
    const counts = count([{ path: "tests/a.test.ts", text: `${ref(123)} ${KEY} ${OLD}` }])
    expect(counts.issueRefs).toBe(0)
    expect(counts.archiveKeys).toBe(1)
    expect(counts.oldNames).toBe(1)
  })

  test("reads past the leak guard's test for branch keys alone, since it holds the keys it detects", () => {
    const counts = count([
      { path: "tests/scripts/hooks/no-public-leak.test.ts", text: `${KEY} ${OLD}` },
    ])
    expect(counts.archiveKeys).toBe(0)
    expect(counts.oldNames).toBe(1)
  })

  test("reads a hex colour as no issue, since an issue number never starts with 0", () => {
    expect(count([{ path: "a.css", text: `0 0 #0000; #000 6px; see ${ref(120)}` }]).issueRefs).toBe(
      1,
    )
  })

  test("reads past a made-up address, an ssh remote's git user and a package's version, so only a real address is a trace", () => {
    const text = [
      "merritt@example.com ada@example.org pat@example.net own@shop.example.com",
      "robin@example.test x@nowhere.invalid dev@app.localhost agent@local.host",
      "git@github.com:acme/app.git next-themes@0.4.6.patch",
      ["real", "vantorix.io"].join("@"),
    ].join("\n")
    expect(count([{ path: "a.ts", text }]).emails).toBe(1)
  })
})

describe("the ratchet", () => {
  test("a rise or a kind with no count yet fails, a fall passes", () => {
    expect(risen({ emails: 2, issueRefs: 4 }, { emails: 3, issueRefs: 3 })).toEqual([
      "issueRefs: 4 in the tree, counts.json allows 3",
    ])
    expect(risen({ names: 1 }, {})).toHaveLength(1)
    expect(risen({ emails: 2 }, { emails: 3 })).toEqual([])
  })

  test("a risen issueRefs count names its fix, and another kind keeps the plain reason", () => {
    expect(refusal(risen({ emails: 2, issueRefs: 4 }, { emails: 3, issueRefs: 3 }))).toBe(
      "trace-count: a count rose; write the new text in plain words; describe the case in words; a doc cites no issue number:\nissueRefs: 4 in the tree, counts.json allows 3",
    )
    expect(refusal(risen({ emails: 4 }, { emails: 3 }))).toBe(
      "trace-count: a count rose; write the new text in plain words:\nemails: 4 in the tree, counts.json allows 3",
    )
  })

  test("writing lowers each measured kind and keeps one this run did not measure", () => {
    expect(lowered({ emails: 2, issueRefs: 3 }, { emails: 3, issueRefs: 3, names: 9 })).toEqual({
      emails: 2,
      issueRefs: 3,
      names: 9,
    })
  })

  test("no count in the tree, less the kept hits, is over counts.json", async () => {
    const baseline = (await Bun.file(COUNTS).json()) as Counts
    const kept = (await Bun.file(KEPT).json()) as Kept[]
    const over = risen(count(await tree(root), undefined, undefined, kept), baseline)
    expect(over.length ? refusal(over) : "").toBe("")
  })
})

describe("the kept hits", () => {
  const entry = (over: Partial<Kept> = {}): Kept => ({
    hits: 1,
    kind: "oldNames",
    line: `const role = "${OLD}"`,
    path: "a.ts",
    reason: "a made-up reason",
    ...over,
  })
  const file = { path: "a.ts", text: `const role = "${OLD}"\nsee ${OLD} again` }

  test("a kept line's hits come off its kind's count, and the file's other hits still count", () => {
    expect(count([file]).oldNames).toBe(2)
    expect(count([file], undefined, undefined, [entry()]).oldNames).toBe(1)
    expect(stale([file], [entry()])).toEqual([])
  })

  test("an entry with copies takes its hits off once for each identical line it names", () => {
    const two = { path: "a.ts", text: `const role = "${OLD}"\nconst role = "${OLD}"` }
    expect(count([two], undefined, undefined, [entry({ copies: 2 })]).oldNames).toBe(0)
    expect(stale([two], [entry({ copies: 2 })])).toEqual([])
  })

  test.each<[string, Kept, string, File?]>([
    ["its file is gone", entry({ path: "b.ts" }), "its file is gone"],
    [
      "its file is never counted",
      entry({ path: "packages/scripts/src/trace-count/counts.json" }),
      "its file is never counted",
      { path: "packages/scripts/src/trace-count/counts.json", text: `const role = "${OLD}"` },
    ],
    ["no line reads as its text", entry({ line: "const role = 1" }), "no line reads as its text"],
    [
      "two lines read as its text",
      entry(),
      "2 lines read as its text, not 1, so set its copies or give it a longer one",
      { path: "a.ts", text: `const role = "${OLD}"\nconst role = "${OLD}"` },
    ],
    [
      "one line reads as its text of copies 2",
      entry({ copies: 2 }),
      "1 line reads as its text, not 2, so set its copies or give it a longer one",
    ],
    [
      "three lines read as its text of copies 2",
      entry({ copies: 2 }),
      "3 lines read as its text, not 2, so set its copies or give it a longer one",
      { path: "a.ts", text: `const role = "${OLD}"\nconst role = "${OLD}"\nconst role = "${OLD}"` },
    ],
    ["its line lost its hit", entry({ hits: 2 }), "its line holds 1 oldNames, not 2"],
  ])("an entry is stale, named by path and text, when %s", (_, kept, says, tree = file) => {
    expect(stale([tree], [kept])).toEqual([`${kept.path}: "${kept.line}" (oldNames): ${says}`])
    expect(count([tree], undefined, undefined, [kept]).oldNames).toBe(count([tree]).oldNames)
  })

  test("every entry in kept.json stands in the tree, with a reason that holds no trace", async () => {
    const kept = (await Bun.file(KEPT).json()) as Kept[]
    expect(stale(await tree(root), kept)).toEqual([])
    const reasons = count([{ path: "reasons", text: kept.map((e) => e.reason).join("\n") }])
    expect(Object.values(reasons).every((n) => n === 0)).toBe(true)
    expect(kept.every((e) => e.reason.trim().length > 0 && e.hits > 0 && (e.copies ?? 2) > 1)).toBe(
      true,
    )
  })
})

describe("no-public-leak's list", () => {
  const scratch = mkdtempSync(join(tmpdir(), "trace-count-list-"))
  afterAll(() => rmSync(scratch, { force: true, recursive: true }))
  const at = (name: string, value?: unknown): string => {
    const path = join(scratch, name, "no-public-leak.json")
    mkdirSync(join(scratch, name), { recursive: true })
    if (value !== undefined) writeFileSync(path, JSON.stringify(value))
    return path
  }

  test("a list with an entry under every key is read", async () => {
    expect(await list(at("full", LIST))).toEqual({ list: LIST })
  })

  test.each([
    ["missing", undefined, "no "],
    ["not the list", { names: "Quilla" }, "is not no-public-leak's list"],
    ["with an empty key", { ...LIST, handles: [], slackIds: [] }, "has no handles, slackIds"],
  ])("a list file %s is refused, naming the fix", async (name, value, says) => {
    const path = at(name.replaceAll(" ", "-"), value)
    const read = await list(path)
    expect(read).toEqual({ refusal: expect.stringContaining(says) })
    expect((read as { refusal: string }).refusal).toContain("playground ext put")
  })

  test("a run with no owner.names or no archive exits 2 before it counts, naming each unset key", () => {
    const run = (values: Record<string, unknown>) => {
      const data = join(scratch, `policy-${Object.keys(values).length}`)
      mkdirSync(join(data, "extensions", "hooks"), { recursive: true })
      writeFileSync(join(data, "extensions", "hooks", "no-public-leak.json"), JSON.stringify(LIST))
      writeFileSync(join(data, "extensions", "login"), "made-up-me\n")
      writeFileSync(
        join(data, "extensions", "policy.json"),
        JSON.stringify({ orgs: {}, schemaVersion: 1, values }),
      )
      return Bun.spawnSync(
        [process.execPath, join(root, "packages/scripts/src/trace-count/cli.ts")],
        { env: { ...process.env, PLAYGROUND_DATA_DIR: data }, stderr: "pipe", stdout: "pipe" },
      )
    }
    const none = run({})
    expect(none.exitCode).toBe(2)
    expect(none.stdout.toString()).toBe("")
    expect(none.stderr.toString()).toContain("factory.archiveRepo and owner.names are unset")
    const named = run({ "factory.archiveRepo": "qmarsh/vault" })
    expect(named.exitCode).toBe(2)
    expect(named.stderr.toString()).toContain("owner.names is unset")
  })

  test("a run with no list file exits 2 before it counts", () => {
    const data = join(scratch, "no-data")
    mkdirSync(data, { recursive: true })
    const run = Bun.spawnSync(
      [process.execPath, join(root, "packages/scripts/src/trace-count/cli.ts")],
      { env: { ...process.env, PLAYGROUND_DATA_DIR: data }, stderr: "pipe", stdout: "pipe" },
    )
    expect(run.exitCode).toBe(2)
    expect(run.stdout.toString()).toBe("")
    expect(run.stderr.toString()).toContain(
      join(data, "extensions", "hooks", "no-public-leak.json"),
    )
  })
})
