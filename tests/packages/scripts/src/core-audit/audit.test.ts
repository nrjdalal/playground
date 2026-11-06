import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type Hit,
  leg1,
  leg2,
  line,
  orgTerms,
  type Terms,
} from "../../../../../packages/scripts/src/core-audit/audit"
import type { File } from "../../../../../packages/scripts/src/trace-count/count"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true })
})

// A data folder whose extensions hold the login's scope and one made-up org's, with the derived list and policy.json a render writes; list or policy, when given, replaces that file's text, and null leaves it out.
function linked(list?: string | null, policy?: string): Record<string, string> {
  const data = mkdtempSync(join(tmpdir(), "core-audit-"))
  roots.push(data)
  const ext = join(data, "extensions")
  for (const scope of ["acme", "me"]) mkdirSync(join(ext, scope, ".git"), { recursive: true })
  writeFileSync(join(ext, "login"), "me\n")
  mkdirSync(join(ext, "hooks"))
  if (list !== null)
    writeFileSync(
      join(ext, "hooks", "no-public-leak.json"),
      list ??
        JSON.stringify({
          companies: ["Widgetco"],
          handles: ["jdoe-made"],
          linearKeys: ["MADE"],
          names: ["Jane Madeup"],
          slackIds: ["C0MADE0001"],
        }),
    )
  writeFileSync(
    join(ext, "policy.json"),
    policy ??
      JSON.stringify({
        orgs: { acme: { "firefighting.start.prefixes": ["DUNE"] } },
        values: {
          "ext.links": { acme: ["acme-labs"], me: ["*"] },
          "ext.repos": { acme: "me/acme-vault" },
          "factory.publicRepo": "me/acme-site",
        },
      }),
  )
  return { HOME: data, PLAYGROUND_DATA_DIR: data }
}

const unlinked = (): Record<string, string> => {
  const data = mkdtempSync(join(tmpdir(), "core-audit-"))
  roots.push(data)
  return { HOME: data, PLAYGROUND_DATA_DIR: data }
}

const at = (hits: Hit[]) => hits.map((h) => `${h.path}:${h.line} ${h.kind}`)

describe("leg 1: a linked org's terms, read at run time", () => {
  test("reads no terms with no org linked", async () => {
    expect(await orgTerms(unlinked())).toBeUndefined()
  })

  test("refuses, naming the file, when an org is linked and its list is missing, malformed or holds an empty key", async () => {
    for (const list of [
      null,
      "{not json",
      JSON.stringify({ companies: [] }),
      JSON.stringify({
        companies: [],
        handles: ["a"],
        linearKeys: ["B"],
        names: ["c"],
        slackIds: ["d"],
      }),
    ]) {
      const read = await orgTerms(linked(list))
      expect(read && "refusal" in read && read.refusal).toContain("no-public-leak.json")
    }
  })

  test("refuses when an org is linked and its policy does not parse, or no login names whose scopes they are", async () => {
    const policy = await orgTerms(linked(undefined, "{not json"))
    expect(policy && "refusal" in policy && policy.refusal).toContain("policy.json")
    const env = linked()
    rmSync(join(env.PLAYGROUND_DATA_DIR!, "extensions", "login"))
    const login = await orgTerms(env)
    expect(login && "refusal" in login && login.refusal).toContain("no login")
  })

  test("reports a keyed and a bare tracker key, the org's name and its prefixes, each as file:line", async () => {
    const terms = (await orgTerms(linked())) as Terms
    const files: File[] = [
      { path: "src/a.ts", text: "ok\nsee MADE-12 here\n" },
      { path: "src/b.ts", text: "const dir = 'worker-made'\n" },
      { path: "tests/c.test.ts", text: "x\nDUNE 4\n" },
      { path: "docs/d.md", text: "run by Acme\n" },
      { path: "src/clean.ts", text: "madeup and acmes and redundant\n" },
    ]
    const hits = leg1(files, terms)
    expect(at(hits)).toEqual([
      "src/a.ts:2 linearKeys",
      "src/b.ts:1 bareKey",
      "tests/c.test.ts:2 bareKey",
      "docs/d.md:1 orgName",
    ])
    expect(hits.find((h) => h.path === "tests/c.test.ts")!.where).toBe("a made-up value in core")
    expect(hits.find((h) => h.path === "docs/d.md")!.where).toBe("the org's extension")
  })

  test("reports the org's GitHub orgs and repository, past the public repositories trace-count reads past", async () => {
    const terms = (await orgTerms(linked())) as Terms
    const files: File[] = [
      { path: "src/a.ts", text: "github.com/acme-labs/web\n" },
      { path: "src/b.ts", text: "ok\nclone me/acme-vault\n" },
      { path: "src/c.ts", text: "me/acme-site and me/acme-vaults\n" },
    ]
    expect(at(leg1(files, terms))).toEqual(["src/a.ts:1 githubName", "src/b.ts:2 githubName"])
  })

  test("prints the kind and place of a hit, never its text", async () => {
    const [hit] = leg1(
      [{ path: "src/a.ts", text: "MADE-12\n" }],
      (await orgTerms(linked())) as Terms,
    )
    expect(line(hit!)).toBe("src/a.ts:1\tleg 1\tlinearKeys\tthe org's extension")
  })
})

describe("leg 2: org-shaped values, with no list", () => {
  test("reports a hard-coded channel id and a person's home path outside tests", () => {
    const files: File[] = [
      { path: "src/x.ts", text: 'const channel = "C08QZ3XK2L"\n' },
      { path: "scripts/y.sh", text: "ok\ncd /Users/acme/work\n" },
      { path: "tests/z.test.ts", text: '"C08QZ3XK2L"\n' },
      { path: "docs/ok.md", text: '"D0EXAMPLE", "C0MADE1234", /Users/you/x and /home/runner/w\n' },
    ]
    const hits = leg2(files)
    expect(at(hits)).toEqual(["src/x.ts:1 slackId", "scripts/y.sh:2 homePath"])
    expect(hits.every((h) => h.where === "config with a sensible default")).toBe(true)
  })

  test("reports a tracker key outside tests, past the factory's own, the made-up ones and standards", () => {
    const files: File[] = [
      { path: "src/x.ts", text: "ok\n// see DUNE-44\n" },
      { path: "tests/z.test.ts", text: "DUNE-44\n" },
      { path: "docs/ok.md", text: "PG-12, ABC-123, ENG-262, UTF-8, SHA-256, ISO-8601, x-DUNE-4\n" },
    ]
    const hits = leg2(files)
    expect(at(hits)).toEqual(["src/x.ts:2 trackerKey"])
    expect(hits[0]!.where).toBe("a placeholder key such as PG-1")
  })
})

describe("a clean tree", () => {
  test("reports zero on both legs", async () => {
    const files: File[] = [
      { path: "src/app.ts", text: "export const answer = 42\n" },
      { path: "docs/page.md", text: "Use a placeholder key such as PG-1 in a doc.\n" },
    ]
    expect(leg1(files, (await orgTerms(linked())) as Terms)).toEqual([])
    expect(leg2(files)).toEqual([])
  })
})
