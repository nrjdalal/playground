import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = join(import.meta.dir, "../../../../../..")
const HERE = join(REPO, "packages/scripts/src/parity/replay")

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  )

// Every made-up file the harness ships: the schema snapshots; a scope's own recordings sit with its replays.
const MADE_UP = files(join(HERE, "schemas"))
const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => [k, ...strings(v)])
        : []

// The leak hook's own terms, which name the factory and its sessions.
const TERMS = (() => {
  const list = JSON.parse(
    readFileSync(join(REPO, "extensions/core/lists/playground-terms.json"), "utf8"),
  )
  return [...list.names, ...list.aliases, ...list.paths, ...list.sessions.roles].map((t: string) =>
    t.toLowerCase(),
  )
})()

describe("the harness's schema snapshots are made up", () => {
  for (const file of MADE_UP) {
    const name = relative(HERE, file)
    const text = readFileSync(file, "utf8")
    const values = strings(JSON.parse(text))

    test(`${name}: every email, link, ticket key and repo is a made-up one`, () => {
      expect(
        values
          .flatMap((v) => v.match(/[\w.+-]+@[\w.-]+/g) ?? [])
          .filter((e) => !e.endsWith("@example.test")),
      ).toEqual([])
      expect(
        values
          .flatMap((v) => v.match(/https?:\/\/[^/\s"]+/g) ?? [])
          .filter((u) => !u.endsWith(".example.test")),
      ).toEqual([])
      expect(
        values
          .flatMap((v) => v.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])
          .filter((k) => !/^(ACME|OPS)-\d+$/.test(k)),
      ).toEqual([])
      expect(
        values
          .flatMap((v) => v.match(/\b[\w-]+\/web\b/g) ?? [])
          .filter((r) => !["acme/web", "<org>/web"].includes(r)),
      ).toEqual([])
    })

    test(`${name}: names none of the factory's terms`, () => {
      const lower = text.toLowerCase()
      expect(TERMS.filter((t) => lower.includes(t))).toEqual([])
    })
  }
})
