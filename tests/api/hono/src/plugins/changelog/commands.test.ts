import { describe, expect, test } from "bun:test"

import {
  runCommand,
  UsageError,
  type Deps,
} from "../../../../../../api/hono/src/plugins/changelog/commands"
import type { GitHub } from "../../../../../../api/hono/src/plugins/changelog/github"
import type {
  NewEntry,
  Pull,
  Release,
} from "../../../../../../api/hono/src/plugins/changelog/sources"

const PULLS: Pull[] = [
  {
    baseRefName: "canary",
    body: "Outcome: A merge never re-runs checks that already passed.",
    mergedAt: "2026-10-07T05:25:00Z",
    number: 141,
    title: "feat(pg-143): pr:merge takes the merge lock",
    url: "https://github.com/acme/archive/pull/141",
  },
]

// A merge whose body is empty, so its detail comes from its squash commit.
const BODILESS: Pull = {
  baseRefName: "canary",
  body: null,
  mergeCommit: { oid: "a".repeat(40) },
  mergedAt: "2026-10-07T04:00:00Z",
  number: 140,
  title: "fix(pg-1): wrap long lines",
  url: "https://github.com/acme/archive/pull/140",
}

const RELEASES: Record<string, Release> = {
  "v0.0.4": {
    body: "[#88](https://github.com/acme/archive/pull/88)",
    createdAt: "2026-10-06T11:41:47Z",
    tagName: "v0.0.4",
    url: "https://github.com/acme/archive/releases/tag/v0.0.4",
  },
}

const ASSET = (n: number) =>
  `https://github.com/user-attachments/assets/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

// A changelog in memory, keyed as the table is: a row whose source key is there already is skipped, gaining only the screenshots it lacked.
function harness(comments: string[] = []) {
  const rows: (NewEntry & { actor: string })[] = []
  const reads: string[] = []
  const stored: string[] = []
  const github: GitHub = {
    comments: async (pull) => {
      reads.push(`comments ${pull.number}`)
      return comments
    },
    commitMessage: async (pull) => {
      reads.push(`commit ${pull.number}`)
      return "fix(pg-1): wrap long lines (#140)\n\nLong lines wrap inside their bubble."
    },
    download: async (url) => {
      reads.push(`download ${url.slice(-2)}`)
      if (url.endsWith("99")) throw new Error("404")
      return new TextEncoder().encode(url.endsWith("98") ? "not an image" : url)
    },
    merged: async (limit) => {
      reads.push(`merged ${limit}`)
      return PULLS
    },
    release: async (tag) => {
      reads.push(`release ${tag}`)
      return RELEASES[tag]!
    },
    releaseTags: async () => Object.keys(RELEASES),
  }
  const deps: Deps = {
    drop: async (keys) => {
      const before = rows.length
      for (const key of keys) {
        const at = rows.findIndex((r) => r.sourceKey === key)
        if (at !== -1) rows.splice(at, 1)
      }
      return before - rows.length
    },
    github,
    known: async (keys) =>
      new Set(
        rows.flatMap((r) => (r.sourceKey && keys.includes(r.sourceKey) ? [r.sourceKey] : [])),
      ),
    store: async (bytes) => {
      const text = new TextDecoder().decode(bytes)
      if (!text.startsWith("https://")) return null
      stored.push(text)
      return `id-${stored.length}.png`
    },
    withImages: async (keys) =>
      new Set(
        rows.flatMap((r) =>
          r.sourceKey && keys.includes(r.sourceKey) && r.images?.length ? [r.sourceKey] : [],
        ),
      ),
    pullKeys: async () =>
      rows.flatMap((r) => (r.sourceKey?.startsWith("pr:") ? [r.sourceKey] : [])),
    seed: {
      merges: { from: 45, lines: {} },
      rules: {
        at: "2026-10-06T18:29:00Z",
        lines: [{ key: "classified", text: "Playground is classified." }],
      },
    },
    write: async (entries, actor, options) => {
      const added: NewEntry[] = []
      const skipped: NewEntry[] = []
      let updated = 0
      for (const entry of entries) {
        const row = rows.find((r) => entry.sourceKey && r.sourceKey === entry.sourceKey)
        if (row) {
          if (!row.images?.length) row.images = entry.images ?? []
          if (options?.refreshDetail && (row.detail ?? null) !== (entry.detail ?? null)) {
            row.detail = entry.detail ?? null
            updated += 1
          }
          skipped.push(entry)
        } else {
          rows.push({ ...entry, actor })
          added.push(entry)
        }
      }
      return { added, skipped, updated }
    },
  }
  return { deps, reads, rows, stored }
}

describe("changelog", () => {
  test("sync adds new merges and versions as ops-dashboard, and a second run adds nothing", async () => {
    const { deps, reads, rows } = harness()
    expect(await runCommand(["sync"], deps)).toEqual(["sync: added 2, already there 0"])
    expect(rows.map((r) => [r.kind, r.text, r.actor])).toEqual([
      ["feature", "A merge never re-runs checks that already passed.", "ops-dashboard"],
      ["release", "Version v0.0.4 is out, with 1 change.", "ops-dashboard"],
    ])
    expect(await runCommand(["sync"], deps)).toEqual(["sync: added 0, already there 1"])
    expect(reads).toEqual(["merged 100", "release v0.0.4", "comments 141", "merged 100"])
  })

  test("the seed adds the rules too, as seed, and run twice adds nothing", async () => {
    const { deps, reads, rows } = harness()
    expect(await runCommand(["seed"], deps)).toEqual(["seed: added 3, already there 0"])
    expect(rows.map((r) => r.actor)).toEqual(["seed", "seed", "seed"])
    expect(rows.at(-1)).toMatchObject({ kind: "rule", link: null, sourceKey: "rule:classified" })
    expect(await runCommand(["seed"], deps)).toEqual(["seed: added 0, already there 2"])
    expect(reads[0]).toBe("merged 1000")
  })

  test("sync copies a new merge's before and after screenshots once, from the first comment that holds them", async () => {
    const { deps, reads, rows } = harness([
      "Round 1 fixes, no images.",
      `Evidence:\n\n![Before](${ASSET(1)})\n\n![After: the bubble](${ASSET(2)})\n\n![Readings](${ASSET(3)})`,
      `Tester:\n\n![After](${ASSET(4)})`,
    ])
    expect(await runCommand(["sync"], deps)).toEqual([
      "sync: added 2, already there 0, screenshots copied 2",
    ])
    expect(rows[0]?.images).toEqual([
      { alt: "Before", id: "id-1.png" },
      { alt: "After: the bubble", id: "id-2.png" },
    ])
    expect(rows[0]?.detail).toBeNull()
    await runCommand(["sync"], deps)
    expect(reads.filter((r) => r.startsWith("comments"))).toEqual(["comments 141"])
  })

  test("the seed backfills screenshots for a merge already there without any, and names an image it could not copy", async () => {
    const { deps, rows } = harness([
      `![Before](${ASSET(99)}) ![After](${ASSET(98)}) ![After, wide](${ASSET(1)})`,
    ])
    deps.github.download = async () => {
      throw new Error("offline")
    }
    await runCommand(["sync"], deps)
    expect(rows[0]?.images).toEqual([])
    deps.github.download = harness().deps.github.download
    const out = await runCommand(["seed"], deps)
    expect(out[0]).toBe("seed: added 1, already there 1, screenshots copied 1")
    expect(rows[0]?.images).toEqual([{ alt: "After, wide", id: "id-1.png" }])
    expect(out.slice(1)).toEqual([
      `problem: #141: ${ASSET(99)} not copied (404)`,
      `problem: #141: ${ASSET(98)} is not a PNG, JPEG, GIF or WebP`,
    ])
  })

  test("the seed copies nothing for a merge that has its screenshots", async () => {
    const { deps, reads, rows } = harness([`![Before](${ASSET(1)})`])
    await runCommand(["sync"], deps)
    expect(rows[0]?.images).toHaveLength(1)
    await runCommand(["seed"], deps)
    expect(reads.filter((r) => r.startsWith("download"))).toEqual(["download 01"])
  })

  test("add writes one line by hand, keyless, as the actor named", async () => {
    const { deps, rows } = harness()
    const out = await runCommand(
      [
        "add",
        "--kind",
        "rule",
        "--text",
        "Managers run no background processes.",
        "--actor",
        "dispatcher",
      ],
      deps,
    )
    expect(out).toEqual(["added rule: Managers run no background processes."])
    expect(rows[0]).toMatchObject({ actor: "dispatcher", link: null, sourceKey: null })
  })

  test("add refuses a kind GitHub owns, a long line, a second line or a link that is not http", async () => {
    const { deps, rows } = harness()
    const refused = (args: string[]) =>
      expect(runCommand(["add", ...args], deps)).rejects.toThrow(UsageError)
    await refused(["--kind", "feature", "--text", "A thing."])
    await refused(["--kind", "rule", "--text", Array.from({ length: 16 }, () => "word").join(" ")])
    await refused(["--kind", "rule", "--text", "One\nTwo"])
    await refused(["--kind", "ops", "--text", "A thing.", "--link", "javascript:alert(1)"])
    await refused(["--kind", "ops", "--text", "A thing.", "--actor", " "])
    expect(rows).toEqual([])
  })

  test("anything else prints the usage", async () => {
    const { deps } = harness()
    await expect(runCommand([], deps)).rejects.toThrow("usage:")
    await expect(runCommand(["from-merge", "130"], deps)).rejects.toThrow("usage:")
    await expect(runCommand(["sync", "extra"], deps)).rejects.toThrow("usage:")
  })

  test("a merge with no detail in its body takes its squash commit's, read once when it is new", async () => {
    const { deps, reads, rows } = harness()
    deps.github.merged = async () => [BODILESS]
    await runCommand(["sync"], deps)
    expect(rows[0]?.detail).toBe("Long lines wrap inside their bubble.")
    await runCommand(["sync"], deps)
    expect(reads.filter((r) => r.startsWith("commit"))).toEqual(["commit 140"])
  })

  test("seed --refresh-detail rewrites every merge's detail by today's rule, and a second run changes nothing", async () => {
    const { deps, reads, rows } = harness()
    deps.github.merged = async () => [
      {
        ...PULLS[0]!,
        body: "Outcome: A line.\n\n## What changes\n\n- The merge lock is taken first.",
      },
      BODILESS,
    ]
    await runCommand(["sync"], deps)
    for (const row of rows) if (row.kind !== "release") row.detail = "Old plain words."
    expect(await runCommand(["seed", "--refresh-detail"], deps)).toEqual([
      "seed: added 1, already there 2, updated 2",
    ])
    expect(rows.map((r) => r.detail)).toEqual([
      "- The merge lock is taken first.",
      "Long lines wrap inside their bubble.",
      undefined,
      undefined,
    ])
    expect(await runCommand(["seed", "--refresh-detail"], deps)).toEqual([
      "seed: added 0, already there 3",
    ])
    expect(reads.filter((r) => r.startsWith("commit"))).toEqual([
      "commit 140",
      "commit 140",
      "commit 140",
    ])
    await expect(runCommand(["sync", "--refresh-detail"], deps)).rejects.toThrow(UsageError)
  })

  test("a refresh keeps the detail of a merge whose commit it could not read", async () => {
    const { deps, rows } = harness()
    deps.github.merged = async () => [BODILESS]
    await runCommand(["sync"], deps)
    deps.github.commitMessage = async () => {
      throw new Error("gh 502")
    }
    expect(await runCommand(["seed", "--refresh-detail"], deps)).toEqual([
      "seed: added 1, already there 1",
      "problem: #140: merge commit not read (gh 502)",
    ])
    expect(rows[0]?.detail).toBe("Long lines wrap inside their bubble.")
  })

  test("the publish step's bookkeeping PRs are no change: sync skips them and a refresh removes the rows they left", async () => {
    const { deps, rows } = harness()
    const bookkeeping = {
      ...PULLS[0]!,
      body: "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      number: 291,
      title: "ci(changelog): update changelog and bump version",
      url: "https://github.com/acme/archive/pull/291",
    }
    deps.github.merged = async () => [PULLS[0]!, bookkeeping]
    await runCommand(["sync"], deps)
    expect(rows.map((r) => r.sourceKey)).not.toContain("pr:acme/archive#291")
    rows.push({ ...rows[0]!, sourceKey: "pr:acme/archive#291", text: "Changelog bump." })
    rows.push({ ...rows[0]!, sourceKey: "pr:acme/archive#260", text: "Merge into main." })
    rows.push({ ...rows[0]!, sourceKey: "pr:acme/archive#99", text: "Older than this read." })
    expect(await runCommand(["seed", "--refresh-detail"], deps)).toEqual([
      "seed: added 1, already there 1, removed 2",
    ])
    expect(rows.map((r) => r.sourceKey)).toEqual([
      "pr:acme/archive#141",
      "release:v0.0.4",
      "pr:acme/archive#99",
      "rule:classified",
    ])
  })
})
