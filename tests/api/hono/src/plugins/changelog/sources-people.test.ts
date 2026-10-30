import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// CHANGELOG_PEOPLE is read once at the module's load, so the list-set case runs in a clean process, the way the API runs; the empty default is covered in sources.test.ts.
const SOURCES = join(import.meta.dir, "../../../../../../api/hono/src/plugins/changelog/sources.ts")
const ROOT = join(import.meta.dir, "../../../../../../")
const COMMANDS = join(
  import.meta.dir,
  "../../../../../../api/hono/src/plugins/changelog/commands.ts",
)

const detailWith = (people: string): string | null => {
  const script = [
    `const { detailOf } = await import(${JSON.stringify(SOURCES)})`,
    `const body = ["## What changes", "", "- Approved by Niven Pandey, Soren Ahmad and Merritt Reyes.", "- The bubble wraps long words."].join("\\n")`,
    "console.log(JSON.stringify({ detail: detailOf(body) }))",
  ].join("; ")
  const run = Bun.spawnSync(["bun", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, CHANGELOG_PEOPLE: people },
    stderr: "pipe",
  })
  expect(run.exitCode).toBe(0)
  return (JSON.parse(run.stdout.toString()) as { detail: string | null }).detail
}

// Runs fn over the sources module in a clean process with the list set, and gives back what it returns.
const withList = <T>(people: string, fn: string): T => {
  const script = [
    `const sources = await import(${JSON.stringify(SOURCES)})`,
    `console.log(JSON.stringify(await (${fn})(sources)))`,
  ].join("; ")
  const run = Bun.spawnSync(["bun", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, CHANGELOG_PEOPLE: people },
    stderr: "pipe",
  })
  expect(run.exitCode).toBe(0)
  return JSON.parse(run.stdout.toString()) as T
}

const pullWith = (body: string | null, title = "feat: the bubble wraps long words") => ({
  baseRefName: "canary",
  body,
  mergeCommit: null,
  mergedAt: "2026-10-06T18:29:00Z",
  number: 248,
  title,
  url: "https://github.com/acme/app/pull/248",
})

// Each line as a merged PR's `Outcome:` line, read back as the entry's headline.
const headlinesWith = (people: string, lines: string[]): string[] =>
  withList(
    people,
    `({ entryFromPull }) => ${JSON.stringify(lines.map((line) => pullWith(`Outcome: ${line}`)))}.map((pull) => entryFromPull(pull).text)`,
  )

const headlineWith = (people: string, line: string): string =>
  headlinesWith(people, [line])[0] ?? ""

// A PR with no `Outcome:` line, its headline its title.
const titleWith = (people: string, title: string): string =>
  withList(
    people,
    `({ entryFromPull }) => entryFromPull(${JSON.stringify(pullWith(null, title))}).text`,
  )

// withTeammates itself, over each text.
const teammatesWith = (people: string, texts: string[]): string[] =>
  withList(people, `({ withTeammates }) => ${JSON.stringify(texts)}.map(withTeammates)`)

// The seed's lines as the seed writes them: its merges' (the one PR here), then its rules'.
const seededWith = (people: string, seed: object): string[] =>
  withList(
    people,
    `({ mergeEntries, ruleEntries }) => { const seed = ${JSON.stringify(seed)}; return [...mergeEntries(seed, [${JSON.stringify(pullWith("Outcome: The bubble wraps long words."))}]), ...ruleEntries(seed)].map((entry) => entry.text) }`,
  )

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length

describe("the configured people the changelog drops", () => {
  test("a bullet naming a listed person is dropped, by name or handle, its whole line with it", () => {
    expect(detailWith("Niven Pandey,Soren Ahmad")).toBe("- The bubble wraps long words.")
  })

  test("the same list twice changes nothing more, and an empty list keeps the names", () => {
    expect(detailWith("Niven Pandey,Soren Ahmad,Niven Pandey")).toBe(
      "- The bubble wraps long words.",
    )
    expect(detailWith("")).toBe(
      "- Approved by Niven Pandey, Soren Ahmad and Merritt Reyes.\n- The bubble wraps long words.",
    )
  })
})

describe("the configured people in a headline", () => {
  test("a listed name in a headline reads a teammate, by name and in the possessive", () => {
    expect(
      headlineWith(
        "Niven Pandey,Soren Ahmad",
        "Approved by Niven Pandey, Soren Ahmad and Merritt Reyes.",
      ),
    ).toBe("Approved by a teammate, a teammate and Merritt Reyes.")
    expect(
      headlineWith(
        "Soren Ahmad",
        "Sessions now start the same way on any Mac, Soren Ahmad's included.",
      ),
    ).toBe("Sessions now start the same way on any Mac, a teammate's included.")
    expect(headlineWith("Soren Ahmad", "Soren Ahmad asked for this fix first.")).toBe(
      "A teammate asked for this fix first.",
    )
  })

  test("a listed name matches in any case", () => {
    expect(
      headlineWith("Soren Ahmad", "Sessions start the same way for soren ahmad and SOREN AHMAD."),
    ).toBe("Sessions start the same way for a teammate and a teammate.")
  })

  test("a listed name matches only whole, so a longer word holding it stays", () => {
    expect(headlineWith("Soren", "The Waleeds and Alwaleed rows stay, and Soren's goes.")).toBe(
      "The Waleeds and Alwaleed rows stay, and a teammate's goes.",
    )
  })

  test("a PR with no Outcome line has its title read the same way", () => {
    expect(titleWith("Soren Ahmad", "fix(dashboard): the bubble wraps for Soren Ahmad")).toBe(
      "The bubble wraps for a teammate",
    )
  })

  test("a cut that meets a listed name leaves none of it, and the line holds the cap", () => {
    const [cut = "", grown = ""] = headlinesWith("Soren Ahmad,Merritt", [
      "One two three four five six seven eight nine ten eleven twelve thirteen fourteen Soren Ahmad fifteen sixteen.",
      "One two three four five six seven eight nine ten eleven twelve thirteen fourteen Merritt.",
    ])
    expect(cut).not.toMatch(/soren|ahmad/i)
    expect(words(cut)).toBeLessThanOrEqual(15)
    expect(grown).not.toMatch(/\bsam\b/i)
    expect(words(grown)).toBeLessThanOrEqual(15)
  })

  test("of two listed names, the longer is matched whole, whichever the list names first", () => {
    for (const people of ["Soren,Soren Ahmad", "Soren Ahmad,Soren"]) {
      expect(headlineWith(people, "Soren Ahmad asked first, and Soren agreed.")).toBe(
        "A teammate asked first, and a teammate agreed.",
      )
    }
  })

  test("a listed handle reads a teammate, its @ with it, and so does an email address naming one", () => {
    expect(
      headlinesWith("soren", [
        "Thanks to @soren for this fix.",
        "Write to soren@example.com for access.",
        "Write to merritt@example.com for access.",
      ]),
    ).toEqual([
      "Thanks to a teammate for this fix.",
      "Write to a teammate for access.",
      "Write to merritt@example.com for access.",
    ])
  })

  test("a letter of any script ends a word, so a listed Ana inside Anaïs stays", () => {
    expect(headlineWith("Ana", "Anaïs and Ana asked for this.")).toBe(
      "Anaïs and a teammate asked for this.",
    )
  })

  test("a teammate takes a capital where a sentence starts, past an opening quote or bracket, and nowhere else", () => {
    expect(
      teammatesWith("Soren Ahmad", [
        '"Soren Ahmad" asked first.',
        "(Soren Ahmad asked first.)",
        "It ships. Soren Ahmad asked first.",
        "It ships for Soren Ahmad.",
      ]),
    ).toEqual([
      '"A teammate" asked first.',
      "(A teammate asked first.)",
      "It ships. A teammate asked first.",
      "It ships for a teammate.",
    ])
  })

  test("a drafted seed line and a seed rule read a teammate too, held to the cap", () => {
    const seed = {
      merges: { from: 1, lines: { "248": { text: "Soren asked for this." } } },
      rules: {
        at: "2026-10-06T00:00:00.000Z",
        lines: [
          { key: "not-for", text: "Not for Soren." },
          {
            key: "long",
            text: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen Soren.",
          },
        ],
      },
    }
    const [drafted, rule, long = ""] = seededWith("Soren", seed)
    expect(drafted).toBe("A teammate asked for this.")
    expect(rule).toBe("Not for a teammate.")
    expect(long).not.toMatch(/soren/i)
    expect(words(long)).toBeLessThanOrEqual(15)
  })

  // `bun run changelog add` with the list set, its write handing back what it was given.
  const addedWith = (people: string, text: string): string[] =>
    withList(
      people,
      `async () => (await import(${JSON.stringify(COMMANDS)})).runCommand(["add", "--kind", "rule", "--text", ${JSON.stringify(text)}], { write: async (entries) => ({ added: entries, skipped: [], updated: 0 }) })`,
    )

  test("a curly quote opens a sentence, and so does a ? or ! ending the one before", () => {
    expect(
      teammatesWith("Soren Ahmad", [
        "“Soren Ahmad” asked first.",
        "Is it fixed? Soren Ahmad asked.",
        "It ships! Soren Ahmad asked.",
      ]),
    ).toEqual([
      "“A teammate” asked first.",
      "Is it fixed? A teammate asked.",
      "It ships! A teammate asked.",
    ])
  })

  test("a title cut where it meets a listed name leaves none of it", () => {
    const title = titleWith(
      "Soren Ahmad",
      "feat: one two three four five six seven eight nine ten eleven twelve thirteen fourteen Soren Ahmad fifteen sixteen",
    )
    expect(title).not.toMatch(/soren|ahmad/i)
    expect(words(title)).toBeLessThanOrEqual(15)
  })

  test("an address holding a listed name only inside a longer word stays as written", () => {
    expect(
      headlinesWith("Soren,Ana", [
        "Mail ofwaleed@example.com for access.",
        "Mail banana@example.com for access.",
      ]),
    ).toEqual(["Mail ofwaleed@example.com for access.", "Mail banana@example.com for access."])
  })

  test("empty entries in the list match nothing", () => {
    expect(
      headlinesWith("Soren,, ,", ["The bubble wraps for Merritt.", "Soren asked for this first."]),
    ).toEqual(["The bubble wraps for Merritt.", "A teammate asked for this first."])
  })

  test("a line added by hand keeps a listed name as typed, since no refresh reaches it", () => {
    expect(addedWith("Soren", "Not for Soren.")).toEqual(["added rule: Not for Soren."])
  })

  test("a listed name inside a URL leaves the URL whole", () => {
    expect(headlineWith("soren", "Docs live at https://example.com/soren/page now.")).toBe(
      "Docs live at https://example.com/soren/page now.",
    )
  })

  test("a listed name in bold or italics at a sentence start takes the capital", () => {
    expect(teammatesWith("Soren", ["**Soren** asked first.", "It ships. _Soren_ asked."])).toEqual([
      "**A teammate** asked first.",
      "It ships. _A teammate_ asked.",
    ])
  })

  test("a listed name written lowercase after a sentence's end stays lowercase, so the line keeps its sentences", () => {
    expect(headlineWith("soren", "Fixed it. soren said so.")).toBe("Fixed it. a teammate said so.")
  })

  test("a combining mark continues a word, so a listed Ana before an accent stays", () => {
    expect(headlineWith("Ana", "Aná and Ana asked for this.")).toBe(
      "Aná and a teammate asked for this.",
    )
  })

  test("a digit continues a word, so a listed Soren inside Waleed2 stays", () => {
    expect(headlineWith("Soren", "Waleed2 asked and Soren agreed.")).toBe(
      "Waleed2 asked and a teammate agreed.",
    )
  })

  test("a listed name written lowercase at the line's very start takes the capital", () => {
    expect(teammatesWith("Soren", ["soren said so."])).toEqual(["A teammate said so."])
  })

  test("an address with no dot in its host is read whole too", () => {
    expect(
      headlinesWith("soren", [
        "Write to soren@buildbox for access.",
        "Write to merritt@buildbox for access.",
      ]),
    ).toEqual(["Write to a teammate for access.", "Write to merritt@buildbox for access."])
  })

  test("with an empty list a headline keeps the names", () => {
    expect(headlineWith("", "Approved by Niven Pandey, Soren Ahmad and Merritt Reyes.")).toBe(
      "Approved by Niven Pandey, Soren Ahmad and Merritt Reyes.",
    )
  })
})
