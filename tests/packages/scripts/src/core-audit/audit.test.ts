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
} from "../../../../../packages/scripts/src/core-audit/audit"
import type { File } from "../../../../../packages/scripts/src/trace-count/count"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true })
})

// A data folder whose extensions hold the login's scope and one made-up org's, with the derived list and policy.json a render writes.
function linked(): Record<string, string> {
  const data = mkdtempSync(join(tmpdir(), "core-audit-"))
  roots.push(data)
  const ext = join(data, "extensions")
  for (const scope of ["acme", "me"]) mkdirSync(join(ext, scope, ".git"), { recursive: true })
  writeFileSync(join(ext, "login"), "me\n")
  mkdirSync(join(ext, "hooks"))
  writeFileSync(
    join(ext, "hooks", "no-public-leak.json"),
    JSON.stringify({ companies: [], handles: [], linearKeys: ["MADE"], names: [], slackIds: [] }),
  )
  writeFileSync(
    join(ext, "policy.json"),
    JSON.stringify({ orgs: { acme: { "firefighting.start.prefixes": ["DUNE"] } }, values: {} }),
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
  test("reads no terms with no org linked", () => {
    expect(orgTerms(unlinked())).toBeUndefined()
  })

  test("reports a keyed and a bare tracker key, the org's name and its prefixes, each as file:line", () => {
    const terms = orgTerms(linked())!
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

  test("prints the kind and place of a hit, never its text", () => {
    const [hit] = leg1([{ path: "src/a.ts", text: "MADE-12\n" }], orgTerms(linked())!)
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
})

describe("a clean tree", () => {
  test("reports zero on both legs", () => {
    const files: File[] = [
      { path: "src/app.ts", text: "export const answer = 42\n" },
      { path: "docs/page.md", text: "Use a placeholder key such as PG-1 in a doc.\n" },
    ]
    expect(leg1(files, orgTerms(linked())!)).toEqual([])
    expect(leg2(files)).toEqual([])
  })
})
