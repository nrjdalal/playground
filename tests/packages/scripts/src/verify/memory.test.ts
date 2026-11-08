import { describe, expect, test } from "bun:test"

import { EMPTY_LIST, UNSET_REPOS } from "../../../../../packages/scripts/src/trace-count/kinds"
import { indexHits, memoryHits } from "../../../../../packages/scripts/src/verify/memory"

// A made-up machine's memory notes, each name, company and key invented for the test.
const LIST = { ...EMPTY_LIST, companies: ["Quillco"], names: ["Pat Example"] }
const note = (text: string) => [{ path: "/m/.playground/memory/builder/note.md", text }]
const kinds = (text: string) => memoryHits(note(text), LIST, UNSET_REPOS).map((hit) => hit.kind)

describe("bun run verify memory names each private trace in a note (#1484)", () => {
  test.each([
    ["an Anthropic key", "the key is sk-ant-oat01-abcdefghijk", "anthropicKey"],
    ["a GitHub token", "push with ghp_abcdefghijklmnopqrstuvwxyz", "githubToken"],
    ["a Slack token", "post with xoxb-1234567890-abcdef", "slackToken"],
    ["an AWS key", "AKIAABCDEFGHIJKLMNOP reads the bucket", "awsKey"],
    ["a private key", "-----BEGIN OPENSSH PRIVATE KEY-----", "privateKey"],
    [
      "a database URL with a password",
      "postgres://app:hunter2@db.example.com/app",
      "databasePassword",
    ],
    ["a person's name", "Pat Example owns the deploy", "names"],
    ["a company's name", "Quillco's repo is read-only", "companies"],
    ["an email address", "mail ops@example.com for it", "emails"],
    ["a production host", "deploy reads db.prod.example.com", "prodHost"],
    ["a production host by its full word", "production.example.com went down", "prodHost"],
    ["a public address", "the box at 203.0.113.7 serves it", "publicAddress"],
  ])("%s", (_, text, kind) => {
    expect(kinds(text)).toContain(kind)
  })

  test("a verified rule with an issue number and a repo path is a fair note", () => {
    expect(
      kinds("run-slot queues a heavy run; #1484 records the trial, scripts/spawn.sh:71"),
    ).toEqual([])
  })

  test("a loopback, private, link-local, CGNAT, multicast or netmask address, a file name, a version and the words prod data are a fair note", () => {
    expect(
      kinds(
        "the API binds 127.0.0.1, the box 10.0.0.2, 192.168.1.4, 172.16.0.9 and 169.254.1.1; bun 1.4.4 reads prod data and prod-data",
      ),
    ).toEqual([])
    expect(
      kinds(
        "mask 255.255.255.0, group 239.1.2.3, CGNAT 100.64.0.1; .env.production.local, prod.ts and next.config.prod.js are files",
      ),
    ).toEqual([])
  })

  test("each hit names its file and line, never its text", () => {
    const [hit] = memoryHits(note("fine\nPat Example said so"), LIST, UNSET_REPOS)
    expect(hit).toEqual({ kind: "names", line: 2, path: "/m/.playground/memory/builder/note.md" })
  })
})

describe("bun run verify memory flags an index a start loads only in part (#1484)", () => {
  const index = (text: string) => [{ path: "/m/.playground/memory/ops/MEMORY.md", text }]

  test("200 lines and 18 KB pass", () => {
    expect(indexHits(index("- [a](a.md)\n".repeat(200)))).toEqual([])
    expect(indexHits(index("x".repeat(18 * 1024)))).toEqual([])
  })

  test("201 lines, or a byte past 18 KB, is a hit", () => {
    expect(indexHits(index("- [a](a.md)\n".repeat(201))).map((h) => h.kind)).toEqual([
      "index over 200 lines (201)",
    ])
    expect(indexHits(index("x".repeat(18 * 1024 + 1))).map((h) => h.kind)).toEqual([
      "index over 18 KB (18433 bytes)",
    ])
  })

  test("a detail file is not an index", () => {
    expect(
      indexHits([{ path: "/m/.playground/memory/ops/long.md", text: "x\n".repeat(500) }]),
    ).toEqual([])
  })
})
