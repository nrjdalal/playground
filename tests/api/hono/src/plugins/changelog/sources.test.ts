import { describe, expect, test } from "bun:test"

import seedFile from "../../../../../../api/hono/src/plugins/changelog/seed.json"
import {
  commitDetail,
  detailOf,
  entryFromPull,
  entryFromRelease,
  fitLine,
  outcomeLine,
  imageRefs,
  isBookkeeping,
  kindOfTitle,
  leadLine,
  MAX_DETAIL_LINES,
  MAX_WORDS,
  mergeEntries,
  OWNER,
  plainTitle,
  pullsIn,
  ruleEntries,
  seedSchema,
  SINS,
  staleKeys,
  wordCount,
  type Pull,
} from "../../../../../../api/hono/src/plugins/changelog/sources"
import terms from "../../../../../../extensions/core/lists/playground-terms.json"
import { site } from "../../../../../../packages/config/src/site"
import { OLD_NAMES } from "../../../../../session-names"

const pull = (over: Partial<Pull> = {}): Pull => ({
  baseRefName: "canary",
  body: null,
  mergedAt: "2026-10-07T05:51:00Z",
  number: 130,
  title: "feat(pg-116): the apps group as square icons that wrap, with corner counts",
  url: "https://github.com/acme/archive/pull/130",
  ...over,
})

const LONG =
  "The Apps group becomes one row of square icon buttons, one per app, with its name on hover and its count as a corner badge."

describe("a PR's line", () => {
  test("is its Outcome: line, plain, bold or in a list item", () => {
    expect(outcomeLine("Intro\n\nOutcome: Apps show as squares.")).toBe("Apps show as squares.")
    expect(outcomeLine("**Outcome:** apps show as squares.")).toBe("Apps show as squares.")
    expect(outcomeLine("- Outcome: apps show as squares")).toBe("Apps show as squares")
    expect(outcomeLine("Outcomes vary")).toBeNull()
    expect(outcomeLine("Outcome's ask, I moved it.\n\nOutcome: The real line.")).toBe(
      "The real line.",
    )
    expect(outcomeLine(null)).toBeNull()
    expect(entryFromPull(pull({ body: "Outcome: Apps show as squares." })).text).toBe(
      "Apps show as squares.",
    )
  })

  test("falls back to the title without its type, as a sentence", () => {
    expect(entryFromPull(pull()).text).toBe(
      "The apps group as square icons that wrap, with corner counts",
    )
    expect(plainTitle("fix: keep the line")).toBe("Keep the line")
    for (const scope of ["PG-1", "pg-1"])
      expect(plainTitle(`fix(${scope}): keep the line`)).toBe("Keep the line")
  })

  // a real PR's body as merged: a Outcome line whose first sentence runs past the cap, then "Closes #<n>" on its own.
  const MERGE_TRAIN = [
    "Outcome: Finished pull requests now merge together in one batch, checked once, instead of one at a time. Until now, each merge made every other finished PR start its checks again, which caused most of today's waiting. If the batch fails, it finds the one PR that broke it, merges the rest and sends that one back to fix.",
    "",
    "Closes #177",
    "",
    "## What changes",
    "",
    "- Finished pull requests now merge together in a batch, checked once, instead of waiting in a single line.",
    "- A pull request that is not ready never holds up the ones behind it.",
  ].join("\n")

  test("keeps a long Outcome line, as its leading clauses, rather than the title", () => {
    const entry = entryFromPull(
      pull({
        body: MERGE_TRAIN,
        title: "feat(pg-177): merge train, and gates carry only over merges git reproduces",
      }),
    )
    expect(entry.text).toBe("Finished pull requests now merge together in one batch, checked once.")
    expect(leadLine("Short and plain. Then more.")).toBe("Short and plain.")
    // real PRs' real lines: a plain comma closes a dependent clause or sits in a list, so neither is cut there
    const sent = leadLine(
      "When you send a message, it now sits at the very top of the chat and the reply fills in below it.",
    )
    expect(sent).not.toBe("When you send a message.")
    expect(sent).toStartWith("When you send a message, it now sits")
    expect(sent.endsWith("…")).toBe(true)
    const icons = leadLine(
      "A check now stops any other icon set, hand-drawn icon or emoji from reaching the dashboard.",
    )
    expect(icons).not.toBe("A check now stops any other icon set.")
    expect(icons).toStartWith("A check now stops any other icon set, hand-drawn icon or emoji")
    expect(
      leadLine(
        "The list now loads in one quick pass; the old slow scroll and its spinner are gone for good.",
      ),
    ).toBe("The list now loads in one quick pass.")
    expect(wordCount(leadLine(`${"word ".repeat(20)}end.`))).toBe(MAX_WORDS)
  })

  test("describes it from the Outcome paragraph and its list, never the issue it closes", () => {
    const detail = detailOf(MERGE_TRAIN) ?? ""
    // its line was shortened, so its whole first sentence leads
    expect(detail).toStartWith(
      "Finished pull requests now merge together in one batch, checked once, instead of one at a time. Until now,",
    )
    expect(detail).toContain(
      "- A pull request that is not ready never holds up the ones behind it.",
    )
    expect(detail).not.toMatch(/closes|part of|fixes/i)
    expect(detailOf("Outcome: A line.\n\nPart of #250. Fixes #12.\n\nCloses #1")).toBeNull()
  })

  // a real PR's body as merged: its first sentence runs past the cap, so the line drops "is stuck" and the detail has to carry it.
  test("a shortened line's whole sentence leads the detail, so no word of it is lost", () => {
    const body =
      "Outcome: A merge can now go ahead when a different secret scan passes and the usual one is stuck. Before, a stuck scan blocked merging.\n\n## What changes\n\n- The scan stands in for the stuck one."
    const entry = entryFromPull(pull({ body }))
    expect(entry.text.endsWith("…")).toBe(true)
    expect(entry.detail).toBe(
      [
        "A merge can now go ahead when a different secret scan passes and the usual one is stuck. Before, a stuck scan blocked merging.",
        "",
        "- The scan stands in for the stuck one.",
      ].join("\n"),
    )
  })

  test("a shortened line's sentence takes a slot of its own, capitalised, and loses none after it", () => {
    expect(detailOf(MERGE_TRAIN)).toContain("If the batch fails, it finds the one PR that broke it")
    expect(
      detailOf(
        "Outcome: the linear app gets a filter bar with search, a status facet, a project facet and a refresh button. It loads fast.",
      ),
    ).toBe(
      "The linear app gets a filter bar with search, a status facet, a project facet and a refresh button. It loads fast.",
    )
  })

  test("the detail holds only what the line lacks, past a second sentence opening on code or a quote", () => {
    const body = "Outcome: The draft stays now. `Esc` clears it. The box keeps its height."
    expect(entryFromPull(pull({ body })).text).toBe("The draft stays now. `Esc` clears it.")
    expect(detailOf(body)).toBe("The box keeps its height.")
    expect(detailOf('Outcome: The draft stays now. "Clear" empties it.')).toBeNull()
  })

  test("a lead never ends inside a code span or link text", () => {
    expect(
      leadLine(
        "The board reads the `old; new` setting and the [first; second](https://x.y) link before anything else on every page.",
      ),
    ).not.toMatch(/`old\.|\[first\./)
  })

  test("a lead ends only at a whole clause: never inside a word or an open bracket", () => {
    expect(
      leadLine(
        "The list loads at once, so-called lazy rows are gone and the slow spinner went with them all.",
      ),
    ).not.toBe("The list loads at once.")
    expect(
      leadLine(
        "The board now shows each lane (old; new) side by side with its owner, queue and every finished item.",
      ),
    ).not.toContain("(old.")
  })

  test("takes the kind from the title's type", () => {
    expect(kindOfTitle("feat(dashboard): x")).toBe("feature")
    expect(kindOfTitle("fix(pg-1)!: x")).toBe("fix")
    expect(kindOfTitle("fix(PG-1)!: x")).toBe("fix")
    expect(kindOfTitle("docs(skills): x")).toBe("ops")
    expect(kindOfTitle("no type at all")).toBe("ops")
  })

  test(`holds every line to ${MAX_WORDS} words: a first sentence, else the title, else cut`, () => {
    expect(fitLine("Short and plain. Then a second sentence.", "Title")).toBe("Short and plain.")
    expect(fitLine("Fix e.g. the sidebar so it never jumps.", "t")).toBe(
      "Fix e.g. the sidebar so it never jumps.",
    )
    expect(fitLine(LONG, "The apps group as square icons")).toBe("The apps group as square icons")
    const cut = fitLine(LONG, LONG)
    expect(wordCount(cut)).toBe(MAX_WORDS)
    expect(cut.endsWith("…")).toBe(true)
    const entry = entryFromPull(pull({ body: `Outcome: ${LONG}`, title: `feat: ${LONG}` }))
    expect(wordCount(entry.text)).toBeLessThanOrEqual(MAX_WORDS)
  })

  test("a cut never leaves a bracket open", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ")
    expect(fitLine(`${words(12)} (one two three four five six) end`)).toBe(`${words(12)}…`)
    expect(fitLine(`${words(8)} (a (b) c d e f g h i) end`)).toBe(`${words(8)}…`)
    expect(fitLine(`(${words(20)})`)).toBe(`${words(15)}…`)
    const tail = Array.from({ length: 15 }, (_, i) => `v${i}`)
    expect(fitLine(`${words(5)} \`f(x\` ${tail.join(" ")}`)).toBe(
      `${words(5)} \`f(x\` ${tail.slice(0, 9).join(" ")}…`,
    )
  })

  test("is keyed by its repository and number, linked and timed by its merge", () => {
    const entry = entryFromPull(pull())
    expect(entry.sourceKey).toBe("pr:acme/archive#130")
    expect(entry.link).toBe("https://github.com/acme/archive/pull/130")
    expect(entry.at.toISOString()).toBe("2026-10-07T05:51:00.000Z")
  })

  test("is refused for a PR not merged, or merged anywhere but canary", () => {
    expect(() => entryFromPull(pull({ mergedAt: null }))).toThrow("not merged")
    expect(() => entryFromPull(pull({ baseRefName: "main" }))).toThrow("not canary")
  })
})

describe("the publish step's bookkeeping", () => {
  test("a ci(changelog), ci(version) or ci(release) PR is no change of its own", () => {
    const pulls = [
      pull({ number: 291, title: "ci(changelog): update changelog and bump version" }),
      pull({ number: 292, title: "ci(version): bump to v0.0.11" }),
      pull({ number: 293, title: "ci(release): 🚀 merge canary into main" }),
      pull({ number: 294, title: "fix(ci): the checks wait for the lock" }),
      pull({ number: 295, title: "ci(pg-88): the workflow runs on canary" }),
    ]
    const seed = seedSchema.parse(seedFile)
    expect(mergeEntries(seed, pulls).map((e) => e.sourceKey)).toEqual([
      "pr:acme/archive#294",
      "pr:acme/archive#295",
    ])
    expect(isBookkeeping(pulls[3]!)).toBe(false)
  })

  // a PR merged after this read listed its PRs: a row a sync added mid-refresh stays
  test("a refresh removes only rows within the numbers it read, and of the repository it read", () => {
    const read = [pull({ number: 260 }), pull({ number: 291 }), pull({ number: 300 })]
    const kept = new Set(["pr:acme/archive#300"])
    expect(
      staleKeys(
        [
          "pr:acme/archive#100",
          "pr:acme/archive#243",
          "pr:acme/archive#260",
          "pr:acme/archive#291",
          "pr:acme/archive#300",
          "pr:acme/archive#301",
          "pr:other/repo#291",
        ],
        read,
        kept,
      ),
    ).toEqual(["pr:acme/archive#260", "pr:acme/archive#291"])
  })
})

describe("a version's line", () => {
  const release = {
    body: "- a ([#67](https://github.com/acme/archive/pull/67))\n- b ([#68](https://github.com/acme/archive/pull/68)) ([#67](https://github.com/acme/archive/pull/67))",
    createdAt: "2026-10-06T08:50:20Z",
    tagName: "v0.0.3",
    url: "https://github.com/acme/archive/releases/tag/v0.0.3",
  }

  test("counts the PRs its notes link, once each, at the tag's time", () => {
    expect(pullsIn(release.body)).toEqual([67, 68])
    const entry = entryFromRelease(release)
    expect(entry).toMatchObject({ kind: "release", sourceKey: "release:v0.0.3" })
    expect(entry.text).toBe("Version v0.0.3 is out, with 2 changes.")
    expect(entry.at.toISOString()).toBe("2026-10-06T08:50:20.000Z")
    expect(entryFromRelease({ ...release, body: null }).text).toBe("Version v0.0.3 is out.")
  })
})

describe("the seed", () => {
  const seed = seedSchema.parse(seedFile)

  test("holds every drafted line and rule to one line within the cap", () => {
    const lines = [...Object.values(seed.merges.lines), ...seed.rules.lines]
    for (const { text } of lines) expect(wordCount(text)).toBeLessThanOrEqual(MAX_WORDS)
    expect(() =>
      seedSchema.parse({
        ...seed,
        rules: { ...seed.rules, lines: [{ key: "long", text: LONG }] },
      }),
    ).toThrow(`at most ${MAX_WORDS} words`)
  })

  test("gives every rule its own key", () => {
    const keys = ruleEntries(seed).map((entry) => entry.sourceKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toMatch(/^rule:/)
  })

  test("adds merges into canary from its floor on, its drafted line replacing the PR's own", () => {
    const merges = mergeEntries(seed, [
      pull({ number: seed.merges.from - 1, url: "https://github.com/acme/archive/pull/1" }),
      pull({ baseRefName: "main" }),
      pull({ body: "Outcome: The apps group becomes a row of squares." }),
      pull({ number: 50, title: "docs(skills): name sins", url: "https://github.com/o/r/pull/50" }),
    ])
    expect(merges.map((entry) => [entry.sourceKey, entry.kind, entry.text])).toEqual([
      ["pr:acme/archive#130", "feature", seed.merges.lines["130"]!.text],
      ["pr:o/r#50", "rule", seed.merges.lines["50"]!.text],
    ])
  })
})

const ASSET = "https://github.com/user-attachments/assets/d3f9fa81-293d-4719-bf33-e0a426fdb90d"
const ASSET2 = "https://github.com/user-attachments/assets/fd669369-1bc0-4544-936c-fb974d0454df"

// The internal names the detail never shows, taken from the config the app spells them with, so no name is written here.
const DISPATCHER = site.name.toLowerCase()
const MANAGER = Object.keys(OLD_NAMES).find(
  (name) => OLD_NAMES[name as keyof typeof OLD_NAMES] === "builder",
)!

// a real PR's body as merged, trimmed to its first lines and its What changed section: a real PR the detail comes from.
const REAL_BODY = [
  "Closes #220",
  "",
  `Outcome: with the feed dropped, the chat says it is reconnecting, not that ${site.name} is down.`,
  "",
  "## Source",
  "",
  "> Instead of big tickets, let's focus on small tickets for now.",
  "",
  "## What changed",
  "",
  "- `/dashboard` with no chat to open now follows the feed's state, `liveState()` from `lib/dashboard.ts`, the same state the sidebar's health mark reads. While the socket is down the board is its last read.",
  '- A stale empty board while reconnecting no longer reads as "No Claude Code sessions yet": that setup line now shows only with the feed live.',
  `- The lost case was already fixed by #157, as ${DISPATCHER}'s ${MANAGER} found.`,
  "- `noChat()` in `dashboard-view.tsx` is the pure choice of the copy, tested in `tests/web/next/src/components/dashboard/dashboard-view.test.ts`.",
  "  - a nested note that stays out",
  "",
  "Reuse: the `Empty` block already on the page.",
  "",
  "## Evidence",
  "",
  "- Before and after shots are in a comment below.",
].join("\n")

describe("detailOf", () => {
  test("a real PR body gives a short Markdown list of what changed, with no internal path or name", () => {
    const detail = detailOf(REAL_BODY)
    expect(detail).toBe(
      [
        "- `/dashboard` with no chat to open now follows the feed's state, `liveState()`, the same state the sidebar's health mark reads.",
        '- A stale empty board while reconnecting no longer reads as "No Claude Code sessions yet": that setup line now shows only with the feed live.',
      ].join("\n"),
    )
    expect(detail).not.toMatch(/\.tsx?\b|lib\/|tests\//)
    expect(detail?.toLowerCase()).not.toContain(DISPATCHER)
    expect(detail?.toLowerCase()).not.toContain(MANAGER)
    expect(detail?.split("\n").length).toBeLessThanOrEqual(MAX_DETAIL_LINES)
  })

  test("leads with the paragraph after the Outcome line, keeping its Markdown, then the What changes bullets", () => {
    const body = [
      "Outcome: Tables are denser.",
      "",
      "Every table is **denser** now, see [the docs](https://example.com/docs).",
      "Rows are shorter. The icons sit inline. A fourth sentence.",
      "",
      "## What changes",
      "",
      "- **The kind icon sits inside the What cell now.** (`plugins/changelog/columns.tsx`)",
      "- Dates are narrow",
      "and right-aligned.",
    ].join("\n")
    expect(detailOf(body)).toBe(
      [
        "Every table is **denser** now, see [the docs](https://example.com/docs). Rows are shorter.",
        "",
        "- **The kind icon sits inside the What cell now.**",
        "- Dates are narrow and right-aligned.",
      ].join("\n"),
    )
  })

  test("prefers another Outcome paragraph, four sentences at most with no bullets", () => {
    const detail = (label: string) =>
      [
        "Outcome: One line.",
        "",
        "The paragraph after it.",
        "",
        `**${label}:** One. Two. Three. Four. Five.`,
        "Six.",
      ].join("\r\n")
    expect(detailOf(detail("Outcome"))).toBe("One. Two. Three. Four.")
    expect(detailOf("## Outcome\n\nIt works now. [Internal](.agents/adr/0001-x.md) notes.")).toBe(
      "It works now. Internal notes.",
    )
  })

  test("reads an Outcome: line as the entry's own, leading with what follows it", () => {
    const body = [
      "Outcome: Tables are denser.",
      "",
      "Every table is **denser** now. Rows are shorter.",
      "",
      "## What changes",
      "",
      "- Dates are narrow.",
    ].join("\n")
    expect(detailOf(body)).toBe(
      ["Every table is **denser** now. Rows are shorter.", "", "- Dates are narrow."].join("\n"),
    )
    expect(detailOf("Outcome: One. Two. Three.")).toBe("Two. Three.")
  })

  test("reads the PR template's body: its TL;DR's first sentence is the line, the rest of it the detail, the other sections nothing", () => {
    const body = [
      "## TL;DR",
      "",
      "Tables are denser. Rows are shorter, and the icons sit inline.",
      "",
      "## Summary",
      "",
      "The kind icon moves into the What cell.",
      "",
      "```diff",
      "# web/next/src/components/changelog/table.tsx",
      " <ChangelogTable>",
      "+  <KindIcon />",
      "```",
      "",
      "## Evidence",
      "",
      "- **Before:** `tests/web/next/src/components/changelog/table.test.ts` fails on the old rows.",
      "  **After:** it passes.",
      "",
      "## Merge Danger",
      "",
      "**Door:** two-way",
      "",
      "**Blast Radius:** changelog",
      "",
      "## Links",
      "",
      "- Closes #1906",
    ].join("\n")
    expect(outcomeLine(body)).toBe("Tables are denser.")
    expect(entryFromPull(pull({ body })).text).toBe("Tables are denser.")
    expect(detailOf(body)).toBe("Rows are shorter, and the icons sit inline.")
    const bridged = body.replace("Tables are denser.", "Outcome: Tables are denser.")
    expect(entryFromPull(pull({ body: bridged })).text).toBe("Tables are denser.")
    expect(detailOf(bridged)).toBe("Rows are shorter, and the icons sit inline.")
    expect(detailOf("## Summary\n\nOne thing.\n\n## Evidence\n\n- **Before:** red.")).toBeNull()
  })

  test("reads a TL;DR of bullets: its first bullet is the line, the other bullets the detail", () => {
    const body = [
      "## TL;DR",
      "",
      "- Tables are denser",
      "- Rows are shorter, and the icons sit inline.",
      "- Dates are narrow.",
      "",
      "## Summary",
      "",
      "- The kind icon moves into the What cell.",
      "",
      "## Evidence",
      "",
      "## Merge Danger",
      "",
      "## Links",
      "",
      "- Closes #1906",
    ].join("\n")
    expect(outcomeLine(body)).toBe("Tables are denser")
    expect(entryFromPull(pull({ body })).text).toBe("Tables are denser")
    expect(detailOf(body)).toBe(
      ["- Rows are shorter, and the icons sit inline.", "- Dates are narrow."].join("\n"),
    )
    const bare = body.replace("## TL;DR\n\n", "## TL;DR\n\nOutcome:\n")
    expect(entryFromPull(pull({ body: bare })).text).toBe("Tables are denser")
    expect(detailOf(bare)).toBe(detailOf(body))
    const sample = `For the template:\n\n\`\`\`markdown\n## TL;DR\n\n- A sample line\n\`\`\`\n`
    expect(outcomeLine(sample)).toBeNull()
    const bridged = body.replace(
      "## TL;DR\n\n",
      "## TL;DR\n\nOutcome: Tables now fit more rows.\n\n",
    )
    expect(entryFromPull(pull({ body: bridged })).text).toBe("Tables now fit more rows.")
    expect(detailOf(bridged)).toBe(
      [
        "- Tables are denser",
        "- Rows are shorter, and the icons sit inline.",
        "- Dates are narrow.",
      ].join("\n"),
    )
  })

  test("keeps at most six lines, cutting a long bullet to its first sentence and a word cap", () => {
    const bullets = Array.from({ length: 9 }, (_, i) => `- Item ${i}. Its second sentence.`)
    const long = `- ${Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")}`
    const detail = detailOf(["## What changed", "", long, ...bullets].join("\n")) ?? ""
    const lines = detail.split("\n")
    expect(lines).toHaveLength(MAX_DETAIL_LINES)
    expect(lines[0]?.endsWith("…")).toBe(true)
    expect(lines[1]).toBe("- Item 0.")
  })

  test("is null when the body holds no paragraph or list to show", () => {
    expect(detailOf(null)).toBeNull()
    expect(detailOf("Just a body.\n\nMore words.")).toBeNull()
    expect(detailOf("Outcome: One line.\n\n## Source\n\nWords.")).toBeNull()
    expect(detailOf("Outcome: One line.\n- a list")).toBeNull()
    expect(detailOf(`Outcome: One line.\n\n${site.name} runs it now.`)).toBeNull()
  })

  test("a squash commit's body stands in when the PR body has nothing, its own bullets included", () => {
    const message = [
      "fix(pg-1): wrap long lines (#9)",
      "",
      "Long lines wrap inside their bubble.",
      "",
      "* fix: wrap at the bubble's edge",
      "* test: a 400-character line",
    ].join("\n")
    expect(commitDetail(message)).toBe(
      [
        "Long lines wrap inside their bubble.",
        "",
        "- fix: wrap at the bubble's edge",
        "- test: a 400-character line",
      ].join("\n"),
    )
    expect(commitDetail("fix: only a title")).toBeNull()
  })

  test("drops a line naming an agent by mention or sin, but keeps one linking this repository", () => {
    const [sin = ""] = terms.sessions.sins
    const named = (bullet: string) =>
      detailOf(`## What changes\n\n${bullet}\n- The bubble wraps long words.`)
    expect(named("- The sidebar rows read `@Greed` now.")).toBe("- The bubble wraps long words.")
    expect(named(`- ${sin[0]!.toUpperCase()}${sin.slice(1)} fixed the bubble.`)).toBe(
      "- The bubble wraps long words.",
    )
    expect(named("- k3m9px-worker fixed the bubble.")).toBe("- The bubble wraps long words.")
    expect(
      detailOf(
        `## What changes\n\n- Long words wrap, as [#97](https://github.com/acme/${DISPATCHER}/pull/97) asked.`,
      ),
    ).toBe(`- Long words wrap, as [#97](https://github.com/acme/${DISPATCHER}/pull/97) asked.`)
  })

  test("with no people configured, a bullet naming a person who is no agent keeps the name", () => {
    expect(
      detailOf(
        "## What changes\n\n- Approved by Priya Nair and Merritt Reyes.\n- The bubble wraps long words.",
      ),
    ).toBe("- Approved by Priya Nair and Merritt Reyes.\n- The bubble wraps long words.")
  })

  // Real bullets from four PRs, where a path is a word of the sentence: cutting it would leave a hole, so the line goes.
  test("drops a line where a path is a word of it, and cuts only a path aside", () => {
    const bullets = (...items: string[]) =>
      detailOf(`## What changes\n\n${items.map((item) => `- ${item}`).join("\n")}`)
    expect(
      bullets(
        "**Page**: the demo-only `DEMO_DETAILS` and `public/changelog-demo/` are gone (never committed).",
        "Tab moves through the squares in `apps.ts` order.",
        "System page: the ops jobs `ops/jobs.json` pauses as a muted Paused table.",
      ),
    ).toBeNull()
    expect(
      bullets(
        "One sentence on the re-list beside the guard's refusals. `AGENTS.md`'s wording stays.",
      ),
    ).toBe("- One sentence on the re-list beside the guard's refusals.")
    expect(detailOf("Outcome: x.\n\nThe rows wrap. `AGENTS.md`'s wording stays.")).toBe(
      "The rows wrap.",
    )
    expect(
      bullets("`AppsRow` (in `components/apps/sidebar.tsx`) draws the sidebar apps as squares."),
    ).toBe("- `AppsRow` draws the sidebar apps as squares.")
    expect(bullets("The rows wrap, as set in `lib/dashboard.ts`.")).toBe("- The rows wrap, as set.")
  })

  // a real PR's squash message and another PR's bullet, as merged: the path is a word of the sentence, so it goes whole.
  test("drops a squash message's sentence and a bullet whose path is a word of them", () => {
    expect(
      commitDetail(
        [
          "ci(changelog): update changelog and bump version (#163)",
          "",
          "The changelog section for v0.0.6 and the version bump to 0.0.6, after",
          "canary 8fcd180 shipped to main as 08db78d (#161) with the tag at",
          "8fcd180. GitHub Actions is off, so this is the commit auto-ship.yml",
          "would have pushed to canary after the merge.",
        ].join("\n"),
      ),
    ).toBe(
      "The changelog section for v0.0.6 and the version bump to 0.0.6, after canary 8fcd180 shipped to main as 08db78d (#161) with the tag at 8fcd180.",
    )
    expect(
      detailOf(
        "## What changes\n\n- **Board tab** on the Plan page (`?view=board`), beside Report and Plan, in its own folder with one entry point, `plan/components/board/plan-board.tsx` (`PlanBoard`), plus `board-card.tsx`, so it can move onto the app registry later.\n- The bubble wraps long words.",
      ),
    ).toBe("- The bubble wraps long words.")
  })

  // a real PR's squash message as merged: it opens on its source's words, quoted after a name, with no "verbatim".
  test("a speaker's quote is a source quote, and a sentence left half-quoted goes", () => {
    const message = [
      "feat(apps): previews page (#119)",
      "",
      `${OWNER}: "Frames are showing nothing. You cannot show the image as of`,
      'right now. You have to build that capability."',
      "",
      "Outcome: a Previews page under Apps shows the images agents make.",
    ].join("\n")
    expect(commitDetail(message)).toBeNull()
    expect(detailOf('Outcome: x.\n\nThe page loads. It reads "fast now.')).toBe("The page loads.")
    expect(detailOf('Outcome: x.\n\nBefore: "Show N idle" sat low. Now it sits on top.')).toBe(
      'Before: "Show N idle" sat low. Now it sits on top.',
    )
  })

  test("reads a long hyphenated or @ token in linear time", () => {
    const started = performance.now()
    for (const token of ["a-".repeat(25_000), "a@".repeat(25_000)])
      detailOf(`## What changes\n\n- The ${token} rows wrap here.`)
    expect(performance.now() - started).toBeLessThan(250)
  })

  // a real PR's bullets as merged: a path label, then a bold label of its own.
  test("a path label before a bold label leaves that label whole", () => {
    expect(
      detailOf(
        [
          "## What",
          "",
          "- `SESSIONS.md`, **Spawn**: a session opens as a full-height column.",
          "- `SESSIONS.md`, **Rename**, **Check a session** and **Answer a picker**: every read names the surface.",
          "- `SKILL.md`, **Lifecycle** and the sweep's Down line: sessions share a workspace.",
        ].join("\n"),
      ),
    ).toBe(
      [
        "- **Spawn**: a session opens as a full-height column.",
        "- **Rename**, **Check a session** and **Answer a picker**: every read names the surface.",
        "- **Lifecycle** and the sweep's Down line: sessions share a workspace.",
      ].join("\n"),
    )
  })

  // a real PR's bullet as merged: what its path label heads means nothing without the path.
  test("a short line under a path label goes with the label", () => {
    expect(
      detailOf(
        "## What\n\n- `components/dashboard/composer.tsx`: built on it. It still sends as before.\n- The box grows as you type.",
      ),
    ).toBe("- The box grows as you type.")
  })

  test("a path as a bold label leaves no debris", () => {
    expect(detailOf("## What changes\n\n- **AGENTS.md:** the rule names the owner role.")).toBe(
      "- The rule names the owner role.",
    )
    expect(
      detailOf(
        "## What changes\n\n- **Fix, `system-home.tsx`**: the roster's note no longer shifts.",
      ),
    ).toBe("- **Fix**: the roster's note no longer shifts.")
  })

  // a real PR's squash message as merged: its Outcome line hard-wrapped, then a source quote and the issues it closes.
  const WRAPPED = [
    "fix(pg-240): a sent message takes the very top (#253)",
    "",
    "Closes #240. Research: #242.",
    "",
    'The owner, verbatim: "why my message is not at top and I see last agent',
    'text cutoff on my send".',
    "",
    "Outcome: your sent message now takes the very top; the reply fills",
    "below, as in langsdk.",
    "",
    "## The reference",
    "",
    "Words.",
  ].join("\n")

  test("a hard-wrapped Outcome line is its own paragraph, never the detail's lead", () => {
    expect(detailOf(WRAPPED.split("\n").slice(2).join("\n"))).toBeNull()
    expect(commitDetail(WRAPPED)).toBeNull()
    expect(
      commitDetail(
        `${WRAPPED.split("\n").slice(0, 9).join("\n")}\n\nThe reply now fills the space below your\nmessage.\n\n## The reference`,
      ),
    ).toBe("The reply now fills the space below your message.")
  })

  test("a squash commit's trailers never become its detail", () => {
    expect(
      commitDetail("t\n\n* the bubble wraps\n\nCo-authored-by: Claude Opus <noreply@example.com>"),
    ).toBe("- the bubble wraps")
    expect(commitDetail("t\n\nSigned-off-by: Some Person <p@example.com>")).toBeNull()
  })

  test("its sins are the leak hook's, plus their Latin forms", () => {
    expect(SINS).toEqual(expect.arrayContaining(terms.sessions.sins))
  })

  // a real PR's body as merged, trimmed: its Outcome paragraph says what changed past its first sentence, under "## What it does".
  test("leads with the Outcome paragraph past its first sentence, then the What it does bullets", () => {
    const body = [
      "Closes #266",
      "",
      "Outcome: ops alerts never type into a session's pane; a test now holds it. Nothing you see changes. A test now fails if any code or doc types into a pane in your name, so it cannot creep back.",
      "",
      "## What it does",
      "",
      "- **The answer to scope 1 is no, so the relay stays** ([ADR 0010](.agents/adr/0010-x.md)).",
      "- **Pane typing is pinned**: a test fails on any text holding a send command.",
      "- **Docs**: the factory gains the voice rule.",
    ].join("\n")
    expect(detailOf(body)).toBe(
      [
        "Nothing you see changes. A test now fails if any code or doc types into a pane in your name, so it cannot creep back.",
        "",
        "- **The answer to scope 1 is no, so the relay stays** (ADR 0010).",
        "- **Pane typing is pinned**: a test fails on any text holding a send command.",
      ].join("\n"),
    )
  })

  // real PRs' bullets as merged: a bold label of three words or more showed alone.
  test("a bold-label bullet keeps its label and what it says", () => {
    expect(
      detailOf(
        [
          "## What changes",
          "",
          "- **System page agents table:** the Agent icon, the Doing title and the `#n` link take the same colour. The `#n` link says the state.",
          "- **Denser table** (`columns.tsx`). The kind's icon sits inline. Rows are short.",
        ].join("\n"),
      ),
    ).toBe(
      [
        "- **System page agents table:** the Agent icon, the Doing title and the `#n` link take the same colour.",
        "- **Denser table**. The kind's icon sits inline.",
      ].join("\n"),
    )
  })

  test("a bold label of three words or more still stands for a bullet whose words are refused", () => {
    expect(
      detailOf(
        [
          "## What changes",
          "",
          "- **The aside renders through Markdown** (moved out of `view.tsx` so a test can render it). No image loads.",
          "- **New sidebar rows:**",
          "  - a nested item",
          "- **Two words:**",
          "  - a nested item",
          "- **The new_flag setting**. It turns rows on.",
          "- **Approvals are written**: each lands in `~/.claude/x/<team>-<UTC date>.json` for the day.",
        ].join("\n"),
      ),
    ).toBe(
      [
        "- The aside renders through Markdown",
        "- New sidebar rows",
        "- **The new_flag setting**. It turns rows on.",
        "- Approvals are written",
      ].join("\n"),
    )
  })

  test("an attribution line is never the detail", () => {
    expect(
      detailOf(
        "Outcome: A line.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      ),
    ).toBeNull()
    expect(
      detailOf(
        "Outcome: A line.\n\nThe rows wrap.\nCo-Authored-By: Claude Opus\n\nGenerated with a tool",
      ),
    ).toBe("The rows wrap.")
  })

  // real PRs' bullets as merged: a quoted source, and long lines a cut would leave open.
  test("drops a quoted source bullet, and cuts a long one before a bracket or quote it would leave open", () => {
    const detail = detailOf(
      [
        "## What changes",
        "",
        "- Only your own PRs run on this machine.",
        '- "I don\'t like this numbering thing. It should just be named Brave Otter."',
        '- "everything you work on should be done with Yagni principles" and "Whatever you choose should be light"',
        '- While that gate is met, the ci gate leaves out a check that is queued, in progress, pending or missing, and says so ("stood in for by the scan").',
        "- API: the route adds detail, images and the viewer's mark; the count, and the mark (marks read up to the newest arrival shown, never back and never past now).",
      ].join("\n"),
    )
    expect(detail).toBe(
      [
        "- Only your own PRs run on this machine.",
        "- While that gate is met, the ci gate leaves out a check that is queued, in progress, pending or missing, and says so…",
        "- API: the route adds detail, images and the viewer's mark; the count, and the mark…",
      ].join("\n"),
    )
  })

  test("a merged PR's entry carries it", () => {
    expect(entryFromPull(pull({ body: "Outcome: A line.\n\nWhat it does." })).detail).toBe(
      "What it does.",
    )
  })
})

describe("imageRefs", () => {
  test("takes GitHub-hosted before and after images from the body, then the first comment holding any", () => {
    const refs = imageRefs(`![Before: the bubble](${ASSET})`, [
      "no images",
      `![After](${ASSET2})\n![Readings](${ASSET})\n![Rail before](${ASSET})`,
      `![After](https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000000)`,
    ])
    expect(refs).toEqual([
      { alt: "Before: the bubble", url: ASSET },
      { alt: "After", url: ASSET2 },
    ])
  })

  test("never takes an image from another host, and holds to six", () => {
    expect(imageRefs("![Before](https://evil.example/x.png)", [])).toEqual([])
    expect(imageRefs(`![Before](${ASSET}?token=1)`, [])).toEqual([])
    const many = Array.from(
      { length: 8 },
      (_, i) =>
        `![After ${i}](https://github.com/user-attachments/assets/00000000-0000-4000-8000-00000000000${i})`,
    ).join("\n")
    expect(imageRefs(many, [])).toHaveLength(6)
  })
})
