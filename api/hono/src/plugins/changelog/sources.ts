import { getSessionNames, ID_NAME_SOURCE, type SessionNames } from "@packages/config/kinds"
import { site } from "@packages/config/site"
import { env } from "@packages/env/api-hono"
import { z } from "zod"

import type { ChangelogImage, ChangelogKind } from "@/plugins/changelog/types"

// Turns a merged PR, a release and the seed file into changelog rows, with no model and no I/O: the CLI reads GitHub and the database, these decide what each row says.

export const KINDS = [
  "feature",
  "fix",
  "ops",
  "release",
  "rule",
  "setting",
] as const satisfies readonly ChangelogKind[]

// What `add` may write by hand; feature, fix and release come only from GitHub.
export const HAND_KINDS = ["ops", "rule", "setting"] as const

// detail and images are a merged PR's alone; every other row leaves them out.
export type NewEntry = {
  at: Date
  detail?: string | null
  images?: ChangelogImage[]
  kind: ChangelogKind
  link: string | null
  sourceKey: string | null
  text: string
}

export const pullSchema = z.object({
  baseRefName: z.string(),
  body: z.string().nullable(),
  mergeCommit: z.object({ oid: z.string().regex(/^[0-9a-f]{40}$/) }).nullish(),
  mergedAt: z.string().nullable(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
})

export type Pull = z.infer<typeof pullSchema>

// createdAt is the tag's time, when main took the version, which the page groups merges by.
export const releaseSchema = z.object({
  body: z.string().nullable(),
  createdAt: z.string(),
  tagName: z.string().min(1),
  url: z.url(),
})

export type Release = z.infer<typeof releaseSchema>

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

// Every entry is one line the owner reads at a glance: at most this many words.
export const MAX_WORDS = 15

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length

// A sentence ends where the next starts with a capital, so an abbreviation (e.g.) does not end it.
const firstSentence = (text: string): string => text.split(/(?<=[.!?])\s+(?=[A-Z])/)[0] ?? text

// The first candidate that fits the cap, its first sentence tried first; when none fits, the last one cut to the cap.
export function fitLine(...candidates: (string | null)[]): string {
  const lines = candidates.filter((c): c is string => Boolean(c?.trim())).map((c) => c.trim())
  for (const line of lines) {
    const short = firstSentence(line)
    if (wordCount(short) <= MAX_WORDS) return short
  }
  const last = lines.at(-1) ?? ""
  return `${cutClosed(last.split(/\s+/).slice(0, MAX_WORDS).join(" ")).replace(/[\s,;:.]+$/, "")}…`
}

// A PR's own line (outcomeLine) held to the cap without losing it for the PR's title: its first sentence when that fits, else its longest lead that ends where a clause stands whole (after a `;`, or before ", and", ", but", ", instead of", ", rather than" or ", so"), else cut. A plain comma is never a cut, since it may close a dependent clause ("When you send a message,") or sit in a list.
const CLAUSE_END = /;\s+|,\s+(?=(?:and|but|instead of|rather than|so)\s)/g

export function leadLine(line: string): string {
  const sentence = firstSentence(line.trim())
  if (wordCount(sentence) <= MAX_WORDS) return sentence
  const leads = [...sentence.matchAll(CLAUSE_END)].map((end) => sentence.slice(0, end.index))
  // a lead that leaves a bracket or quote open ("(old; new)") is no whole clause
  const lead = leads
    .filter((text) => wordCount(text) <= MAX_WORDS && cutClosed(text) === text)
    .at(-1)
  return lead && wordCount(lead) >= 4 ? `${lead}.` : fitLine(sentence)
}

// One line by hand (the seed's, or `add --text`): no newline, and within the cap.
export const oneLine = z
  .string()
  .trim()
  .min(1)
  .refine((text) => !/[\r\n]/.test(text), "one line, with no line break")
  .refine((text) => wordCount(text) <= MAX_WORDS, `at most ${MAX_WORDS} words`)

export const seedSchema = z.strictObject({
  merges: z.strictObject({
    from: z.number().int().positive(),
    lines: z.record(
      z.string().regex(/^\d+$/),
      z.strictObject({ kind: z.enum(KINDS).optional(), text: oneLine }),
    ),
  }),
  rules: z.strictObject({
    at: z.iso.datetime(),
    lines: z.array(z.strictObject({ key: z.string().regex(/^[a-z0-9-]+$/), text: oneLine })),
  }),
})

export type Seed = z.infer<typeof seedSchema>

// A PR body's line label, bold or in a list item included; the colon is required, so a sentence that starts "Outcomes vary" is not one.
const labelNamed = (name: string) =>
  new RegExp(
    `^[ \\t]*(?:[-*][ \\t]+)?(?:\\*\\*|__)?${name}(?::(?:\\*\\*|__)?|(?:\\*\\*|__):)[ \\t]*`,
    "im",
  )

const OUTCOME_LABEL = labelNamed("Outcome")

const lineWith = (body: string | null, label: RegExp): string | null => {
  const match = body?.match(new RegExp(`${label.source}(.+)$`, "im"))
  const line = match?.[1]?.replace(/(?:\*\*|__)\s*$/, "").trim()
  return line ? sentence(line) : null
}

// The PR body's own line: its `Outcome:` line (a TL;DR may open with one), else its `## TL;DR`'s first bullet, or a prose TL;DR's first sentence, else null.
export function outcomeLine(body: string | null): string | null {
  const labelled = lineWith(body, OUTCOME_LABEL)
  if (labelled) return labelled
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n")
  const [first] = tldrBullets(lines)
  if (first) return sentence(first)
  const tldr = tldrProse(lines)
  return tldr ? sentence(firstSentence(tldr)) : null
}

// The detail is a few short lines of Markdown: a lead paragraph and the bullets of what changed, this many lines at most.
export const MAX_DETAIL_LINES = 6

// A bullet is its first sentence, cut to this many words.
const MAX_BULLET_WORDS = 25

// The person the PR bodies write to, as they name the owner, whose quoted words open a source quote.
export const OWNER = "the owner"

// The words agents are named by, alone or in a session's name: the seven sins, as the leak hook's terms list names them for the leak hook (a test holds the two together), and their Latin forms.
export const SINS = [
  "acedia",
  "avaritia",
  "envy",
  "gluttony",
  "greed",
  "gula",
  "invidia",
  "ira",
  "lust",
  "luxuria",
  "pride",
  "sloth",
  "superbia",
  "wrath",
] as const

// Names the app's own pages never show: the agents that built a change (the product's name, the managers' set names that are no role word, old ones included (`getSessionNames`), a sin, a `worker-x` or `<id>-<kind>` session, an `@Name` mention), how they are run, and the people configured out (`CHANGELOG_PEOPLE`), each matched whole with `-` and `_` as edges.
const escapeRegExp = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// A role word (builder, ops) stays readable, so only a name set apart from its kind's is hidden.
const managerNames = ({ aliases, names }: SessionNames): string[] => [
  ...Object.keys(aliases),
  ...Object.entries(names).flatMap(([kind, name]) => (name === kind ? [] : [name])),
]
const internalOf = (names: SessionNames): RegExp =>
  new RegExp(
    `(?<![a-z0-9])(?:${[site.name, ...managerNames(names), ...SINS]
      .map((name) => name.toLowerCase())
      .concat(env.CHANGELOG_PEOPLE.map(escapeRegExp))
      .join(
        "|",
      )}|factory|${ID_NAME_SOURCE}|(?:probe|reviewer|runner|tester|worker)-[a-z0-9]+)(?![a-z0-9])|(?<![\\w.@])@[a-z][\\w-]*`,
    "i",
  )

let INTERNAL: { names: SessionNames; pattern: RegExp } | undefined

// Whether a line names something internal, read by the words it shows: a link's URL is not read, so a link to this repository keeps its line.
const internal = (text: string): boolean => {
  const names = getSessionNames()
  if (INTERNAL?.names !== names) INTERNAL = { names, pattern: internalOf(names) }
  return INTERNAL.pattern.test(plainWords(text))
}

// A listed person in a headline reads "a teammate" in their place, matched whole as the detail drops them, so the line itself stays; an empty list leaves a line as it is. A word ends at anything but a letter, combining mark or digit of any script, so a listed Ana inside Anaïs, or before a combining accent, stays. The longest name is tried first, so a full name is taken whole before a shorter one listed inside it.
const NAMES = `(?:${env.CHANGELOG_PEOPLE.toSorted((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|")})`
const WORD = "[\\p{L}\\p{M}\\p{N}]"
const PERSON = new RegExp(`(?<!${WORD})${NAMES}(?!${WORD})`, "iu")

// A handle's `@` goes with its name, as the detail reads an `@Name` mention as one; an email address (any `user@host`, a host with no dot included) is read whole, so one naming a listed person reads "a teammate" entire, as the detail drops its line, and any other stays as written.
const EMAIL = "[\\p{L}\\p{N}_.%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*"
// A link is read whole and kept as written, so a listed name in its path never breaks it, and a listed name inside a link still shows.
const LINK = "https?://[^\\s<>()]+"
const PEOPLE = new RegExp(`${LINK}|${EMAIL}|(?<!${WORD})@?${NAMES}(?!${WORD})`, "giu")

// Where a sentence starts: the line's start or a sentence's end, then any opening quote, bracket or bold or italic mark. Past the line's start, a name written lowercase keeps a lowercase "a teammate", so the line's sentences stay where its writer put them.
const SENTENCE_START = /(?:^|[.!?]\s+)[\p{Ps}\p{Pi}"'*_]*$/u

export const withTeammates = (text: string): string =>
  env.CHANGELOG_PEOPLE.length
    ? text.replace(PEOPLE, (match: string, at: number) => {
        if (/^https?:\/\//i.test(match)) return match
        if (/^[^@]+@/.test(match) && !PERSON.test(match)) return match
        const capital = at === 0 || !/^@?\p{Ll}/u.test(match)
        return SENTENCE_START.test(text.slice(0, at)) && capital ? "A teammate" : "a teammate"
      })
    : text

// A commit trailer naming a person and an email (`Co-authored-by: A Name <a@b.c>`), never a line of the detail.
const TRAILER = /^[A-Za-z-]+:[^\n]*<[^>\s]*@[^>\s]*>\s*$/gm

// An attribution line, never a line of the detail: the generator's footer and a co-author, with or without an email.
const ATTRIBUTION = /^[^\S\n]*(?:\S+[^\S\n]+)?Generated with\b.*$|^[^\S\n]*Co-Authored-By:.*$/gim

// A repository path, not a route. In code it is a span opening on `~/`, `./` or `../`, spaces and all (`~/.claude/<team> date.json`), or any span with no space that holds a `/` after its first character (`packages/db`) or ends in a file's extension (`view.tsx`); in prose, where `canary/tree` is two words, a file name with its extension, a dot folder's path or one two folders deep.
const EXTENSION = String.raw`\.(?:css|json|jsx?|mdx?|mjs|py|sh|sql|toml|tsx?|txt|ya?ml)`
const PATH = String.raw`(?:[\w./@~-]*[\w-]${EXTENSION}|\.[\w-]+\/[\w./@~-]*|[\w@~-]+\/[\w@~-]+\/[\w./@~-]*)`
const CODE_PATH = String.raw`\x60(?:(?:~|\.{1,2})\/[^\x60]*|[^\x60\s/][^\x60\s]*\/[^\x60\s]*|[^\x60\s]+${EXTENSION})\x60`
const ANY_PATH = String.raw`(?:${CODE_PATH}|(?<![\w/\x60(\[.:@~-])${PATH}(?![\w/\x60]))`
const PREPOSITION = String.raw`(?:at|beside|by|for|from|in|into|of|on|see|through|to|under|via|with)`

// The only paths cut out, since what is left still reads: a parenthetical of paths alone, `(in \`lib/x.ts\`)`, a path closing its clause after a preposition, `, in \`lib/x.ts\`.`, and one closing a bold label, `**Fix, \`x.tsx\`**:`.
const PATH_ASIDE = new RegExp(
  String.raw`\s*\(\s*(?:${PREPOSITION}\s+)?${ANY_PATH}(?:\s*[,;]\s*(?:and\s+)?${ANY_PATH})*\s*\)|\s+${PREPOSITION}\s+${ANY_PATH}(?:\s*(?:,|and)\s*${ANY_PATH})*(?=\s*(?:[,.;:!?)]|\*\*|__|$))|\s*[,;]\s*${ANY_PATH}(?=\s*(?:\*\*|__))`,
  "g",
)

// A path left in a sentence after the cuts is a word of it (`\`x.ts\` draws the rows`), so the sentence or bullet is dropped rather than read with a hole.
const HAS_PATH = new RegExp(ANY_PATH)

// A bullet that opens on paths alone, as a label (`**\`lib/x.ts\`**:`, `**AGENTS.md:**`) or as its subject.
const PATH_LABEL = new RegExp(
  String.raw`^(?:\*\*|__)?\s*(?:${CODE_PATH}|${PATH})(?:\s*,\s*(?:${CODE_PATH}|${PATH}))*\s*(?:\*\*|__)?\s*`,
)

// Markdown with its path asides cut out: links keep their text, only an http or https one keeps its URL, and an image or comment goes.
const withoutPaths = (text: string): string =>
  text
    .replace(/<img\b[^>]*>|<!--[\s\S]*?-->/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\((?!https?:)[^)]*\)/g, "$1")
    .replace(PATH_ASIDE, "")
    .replace(/(^|\s)\(\s*[,;]?\s*\)/g, "$1")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/,([.;:])/g, "$1")
    .replace(/(\*\*|__)[,;:]?\1/g, "")
    .replace(/\s+/g, " ")
    .trim()

const sentencesOf = (text: string): string[] =>
  text.split(/(?<=[.!?])\s+(?=[A-Z`*"])/).filter((sentence) => sentence.trim())

// A PR body's boilerplate rather than what changed: the issue it closes and the generator's footer, and a paragraph that quotes its source.
const BOILERPLATE =
  /^(?:closes|fixes|part of|resolves)\s+#\d+|^[\w ]+:\s*#\d+(?:,?\s*#\d+)*\.?$|generated with/i
// A source quote: a paragraph saying verbatim, a blockquote, or one opening on the owner's quoted words (`<OWNER>: "…`); a label such as `Before: "…` is not one.
const QUOTED = new RegExp(String.raw`\bverbatim\b|^\s*>|^\s*${OWNER}:\s*["\u201c]`, "i")

// A sentence a cut left with an unbalanced quote mark, the tail of a quote rather than words of its own.
const halfQuoted = (sentence: string): boolean =>
  (sentence.match(/["\u201c\u201d]/g)?.length ?? 0) % 2 === 1

// The sentences of a paragraph that name nothing internal and are not boilerplate, at most `max`; none from a paragraph quoting its source.
const leadOf = (paragraph: string, max: number): string | null =>
  QUOTED.test(paragraph)
    ? null
    : sentencesOf(withoutPaths(paragraph))
        .filter(
          (sentence) =>
            !internal(sentence) &&
            !HAS_PATH.test(sentence) &&
            !BOILERPLATE.test(sentence) &&
            !halfQuoted(sentence),
        )
        .slice(0, max)
        .join(" ") || null

const capitalized = (text: string): string =>
  text.replace(
    /^((?:\*\*|__)?)([a-z])/,
    (_, mark: string, first: string) => mark + first.toUpperCase(),
  )

// A bullet as one short line: its first sentence, and the next with it when the first is its bold label alone, else its bold label of three words or more when those words are refused. A path as its label goes; a path as its subject drops it.
function bulletOf(item: string): string | null {
  let text = item.trim()
  const label = text.match(PATH_LABEL)?.[0]
  if (label) {
    const rest = text.slice(label.length)
    if (!/^[:,;-]/.test(rest)) return null
    // a label opened in bold closes after its colon (`**AGENTS.md:** the rule`); otherwise what follows may open a bold label of its own (`` `x.md`, **Spawn**: ``)
    const open = /^(?:\*\*|__)/.test(label) && !/(?:\*\*|__)\s*$/.test(label)
    text = capitalized(rest.replace(open ? /^[:,;-]\s*(?:\*\*|__)?\s*/ : /^[:,;-]\s*/, ""))
    // what a path label heads may lean on it (`` `composer.tsx`: built on it. ``), so a short one goes with it
    if (wordCount(plainWords(sentencesOf(text)[0] ?? "")) < 4) return null
  }
  const [first = "", next] = sentencesOf(withoutPaths(text))
  const labelOnly = /^(\*\*|__)(?:(?!\1).)+\1[.:]?$/.test(first)
  const line = shownLine(withoutPaths(labelOnly && next ? `${first} ${next}` : first))
  const bold = text
    .match(/^(?:\*\*|__)(.+?)(?:\*\*|__)/)?.[1]
    ?.replace(/:$/, "")
    .trim()
  return line ?? (bold && wordCount(bold) >= 3 ? shownLine(withoutPaths(bold)) : null)
}

// A bullet's line as shown, cut to MAX_BULLET_WORDS, or null when it is too short, ends on a colon, holds a path, names something internal, is the docs' own bullet, or opens on a quote.
function shownLine(text: string): string | null {
  const line = text.replace(/^[\s:,;-]+/, "")
  if (wordCount(line) < 2 || /:(?:\*\*|__)?$/.test(line)) return null
  if (internal(line) || HAS_PATH.test(line) || /^(?:\*\*|__)?docs\b/i.test(line)) return null
  // a bullet that opens on a quote is the PR's source, not what changed
  if (/^["\u201C]/.test(line) || halfQuoted(line)) return null
  if (wordCount(line) <= MAX_BULLET_WORDS) return line
  return `${cutClosed(plainWords(line).split(/\s+/).slice(0, MAX_BULLET_WORDS).join(" ")).replace(
    /[\s,;:.]+$/,
    "",
  )}…`
}

// Words cut at the cap, backed off to before a bracket, link text, quote or code span they would leave open.
function cutClosed(text: string): string {
  let code = -1
  const open: number[] = []
  let quote = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "`") code = code === -1 ? i : -1
    else if (code !== -1) continue
    else if (text[i] === "(" || text[i] === "[") open.push(i)
    else if (text[i] === ")" || text[i] === "]") open.pop()
    else if (text[i] === "\u201C" && quote === -1) quote = i
    else if (text[i] === "\u201D") quote = -1
    else if (text[i] === '"') quote = quote === -1 ? i : -1
  }
  const cut = Math.min(...[open[0] ?? -1, quote, code].filter((at) => at !== -1))
  // one left open at the very start would leave nothing, so that mark goes instead
  if (cut === 0) return cutClosed(text.slice(1))
  return Number.isFinite(cut) ? text.slice(0, cut) : text
}

// Markdown as the plain words it shows, for a bullet cut mid-way, whose link or code would otherwise be left open.
const plainWords = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim()

// A paragraph of prose, not a heading, list, quote, table, code fence or image.
const isProse = (line: string): boolean => !/^\s*(?:#|[-*+]\s|\d+[.)]\s|>|\||```|!\[|<)/.test(line)

const HEADING = /^\s{0,3}#{1,6}\s/
const TOP_ITEM = /^\s?(?:[-*+]|\d+[.)])\s+/

// The lines from `from` to the next blank line.
const paragraphAt = (lines: string[], from: number): string[] => {
  const end = lines.findIndex((line, i) => i >= from && !line.trim())
  return lines.slice(from, end === -1 ? undefined : end)
}

// The lead from the first prose paragraph at or after `from`, before the next heading, that gives one; the paragraph holding the `Outcome:` line label, the entry's own line, is passed over.
function leadFrom(lines: string[], from: number, max: number): string | null {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (HEADING.test(line)) return null
    if (!line.trim()) continue
    const paragraph = paragraphAt(lines, i)
    const lead =
      isProse(line) && outcomeLine(line) === null ? leadOf(paragraph.join(" "), max) : null
    if (lead) return lead
    i += paragraph.length - 1
  }
  return null
}

// The TL;DR heading's line, a heading inside a code fence being a sample; -1 without one.
const tldrAt = (lines: string[]): number => {
  let fenced = false
  return lines.findIndex((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced
    return !fenced && HEADING.test(line) && /^tl;?dr$/i.test(line.replace(HEADING, "").trim())
  })
}

// A PR body's TL;DR bullets, as the pr skill writes it, each with its wrapped lines joined; empty without any.
const tldrBullets = (lines: string[]): string[] => {
  const at = tldrAt(lines)
  return at === -1 ? [] : itemsFrom(lines, at + 1)
}

// An older TL;DR written as prose: the plain lines of its `## TL;DR` up to the next heading, outside any code fence, as one paragraph; empty without one.
function tldrProse(lines: string[]): string {
  const at = tldrAt(lines)
  if (at === -1) return ""
  const prose: string[] = []
  let fenced = false
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced
    else if (fenced) continue
    else if (HEADING.test(line)) break
    else if (line.trim() && isProse(line)) prose.push(line.trim())
  }
  return prose.join(" ")
}

// The top-level list items from `from` to the next heading, each with its wrapped lines joined; a nested item and a paragraph after a blank line are left out.
function itemsFrom(lines: string[], from: number): string[] {
  const items: string[] = []
  let open = false
  for (let i = from; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (HEADING.test(line)) break
    if (!line.trim()) open = false
    else if (TOP_ITEM.test(line)) {
      items.push(line.replace(TOP_ITEM, ""))
      open = true
    } else if (/^\s+(?:[-*+]|\d+[.)])\s/.test(line)) open = false
    else if (open) items[items.length - 1] += ` ${line.trim()}`
  }
  return items
}

const LABEL = /^[ \t]*(?:\*\*|__)?Outcome(?::(?:\*\*|__)?|(?:\*\*|__):)/i

// A lead paragraph and a list as the aside's Markdown, held to MAX_DETAIL_LINES; null when neither has anything to show.
function compose(lead: string | null, items: string[]): string | null {
  const bullets = [...new Set(items.map(bulletOf))]
    .filter((line): line is string => Boolean(line))
    .slice(0, MAX_DETAIL_LINES - (lead ? 1 : 0))
    .map((line) => `- ${line}`)
  const parts = [lead, bullets.join("\n")].filter(Boolean)
  return parts.length ? parts.join("\n\n") : null
}

// What changed, as a few short lines of Markdown for the page's aside, with no model: a lead paragraph, then the bullets of its What changes section, else its TL;DR's bullets past the first. The lead is the paragraph of the entry's own line (outcomeLine), or a prose TL;DR, past its first sentence, else another `Outcome:` paragraph, else an Outcome section's, else the paragraph right after the line's; it keeps two sentences beside bullets and four alone, plus the whole first sentence when the line was shortened. A path aside comes out, and a sentence or bullet holding a path as a word, or naming an agent or the factory, is dropped. Null when the body has neither, so a PR without them shows its line alone.
export function detailOf(body: string | null): string | null {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").replace(ATTRIBUTION, "").split("\n")
  const section = (name: RegExp) =>
    lines.findIndex(
      (line) =>
        (HEADING.test(line) && name.test(line.replace(HEADING, "").trim())) ||
        new RegExp(
          `^(?:\\*\\*|__)?(?:${name.source.slice(1, -1)})(?:\\*\\*|__)?:?(?:\\*\\*|__)?$`,
          "i",
        ).test(line.trim()),
    )
  const changes = section(
    /^(?:what(?: (?:changes|changed|it does|ships|this does))?|changes?|fix)(?:\s*\(.*\))?$/i,
  )
  const label = OUTCOME_LABEL
  const forLine = lines.findIndex((text) => lineWith(text, label) !== null)
  // a TL;DR's bullets past the first, which is the entry's own line, or all of them under an `Outcome:` line
  const bullets = tldrBullets(lines).slice(forLine === -1 ? 1 : 0)
  const items = changes === -1 ? bullets : itemsFrom(lines, changes + 1)
  const max = items.length ? 2 : 4
  // the entry's own line is never its own detail paragraph, nor a bare label over a TL;DR's bullets
  const marked = lines.findIndex(
    (line, i) =>
      i !== forLine && LABEL.test(line) && Boolean(line.replace(LABEL, "").replace(/[*_\s]/g, "")),
  )
  const labelled = () => {
    const [first = "", ...rest] = paragraphAt(lines, marked)
    return leadOf([first.replace(LABEL, ""), ...rest].join(" "), max)
  }
  const own = forLine === -1 ? [] : paragraphAt(lines, forLine)
  // the entry's own paragraph past its first sentence, which is the entry's own line; when that line had to be shortened (leadLine), its whole sentence leads, so no word of it is lost
  const ownText =
    forLine === -1
      ? tldrBullets(lines).length
        ? ""
        : tldrProse(lines)
      : own.join(" ").replace(label, "").trim()
  const ownFirst = firstSentence(ownText)
  // the line is firstSentence, which can span more than one of sentencesOf's sentences (a second opening on code or a quote)
  const spanned = sentencesOf(ownFirst).length
  const ownRest = () =>
    // the same test leadLine shortens by; the whole sentence leads, capitalised as the line is, with a slot for each sentence it spans so none after it is pushed out
    wordCount(ownFirst) > MAX_WORDS
      ? leadOf(sentence(ownText), max + spanned)
      : leadOf(sentencesOf(ownText).slice(spanned).join(" "), max)
  // the paragraph right after the own line's paragraph, which a squash message hard-wraps over several lines
  const after = () => {
    let next = forLine + own.length
    while (forLine !== -1 && next < lines.length && !lines[next]?.trim()) next += 1
    return forLine !== -1 && next < lines.length && isProse(lines[next] ?? "")
      ? leadOf(paragraphAt(lines, next).join(" "), max)
      : null
  }
  const outcome = section(/^outcome$/i)
  const lead =
    ownRest() ??
    (marked !== -1 ? labelled() : null) ??
    (outcome !== -1 ? leadFrom(lines, outcome + 1, max) : null) ??
    after()
  return compose(lead, items)
}

// A squash commit's message as the detail, for a PR whose body gives none: detailOf's rules first, else the body's first paragraph and its top-level bullets, its trailers left out.
export function commitDetail(message: string | null): string | null {
  const body = (message ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(TRAILER, "")
  const marked = detailOf(body)
  if (marked) return marked
  const lines = body.split("\n")
  const items = itemsFrom(lines, 0)
  return compose(leadFrom(lines, 0, items.length ? 2 : 4), items)
}

// At most this many screenshots per entry.
export const MAX_IMAGES = 6

// The only image URLs the sync downloads: an asset uploaded to a GitHub comment or body (gh pr comment --attach), never another host.
export const ASSET_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}$/

export type ImageRef = { alt: string; url: string }

// A PR's before and after screenshots: the GitHub-hosted images whose alt text says before or after, from its body and then the first comment that holds any, in order, at most MAX_IMAGES. Later comments are the review's, whose shots repeat these or check one detail.
export function imageRefs(body: string | null, comments: string[]): ImageRef[] {
  const refsIn = (markdown: string): ImageRef[] =>
    [...markdown.matchAll(/!\[([^\]]*)\]\((\S+?)\)/g)].flatMap(([, alt = "", url = ""]) =>
      ASSET_URL.test(url) && /\b(?:before|after)\b/i.test(alt) ? [{ alt: alt.trim(), url }] : [],
    )
  const first = comments.map(refsIn).find((refs) => refs.length) ?? []
  const seen = new Set<string>()
  return [...refsIn(body ?? ""), ...first]
    .filter((ref) => !seen.has(ref.url) && seen.add(ref.url))
    .slice(0, MAX_IMAGES)
}

// A Conventional Commits title's type, as the changelog names it.
export function kindOfTitle(title: string): ChangelogKind {
  const type = title.match(/^(\w+)(?:\([^)]*\))?!?:/)?.[1]?.toLowerCase()
  return type === "feat" ? "feature" : type === "fix" ? "fix" : "ops"
}

// A title without its `type(scope):` prefix, as a sentence.
export const plainTitle = (title: string): string =>
  sentence(title.replace(/^\w+(?:\([^)]*\))?!?:\s*/, "").trim())

// owner/name from a github.com PR or release URL.
export function repoOf(url: string): string {
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//)
  if (!match?.[1]) throw new Error(`not a GitHub URL: ${url}`)
  return match[1]
}

export const pullKey = (pull: Pick<Pull, "number" | "url">): string =>
  `pr:${repoOf(pull.url)}#${pull.number}`

export const releaseKey = (tag: string): string => `release:${tag}`

export const ruleKey = (key: string): string => `rule:${key}`

// A PR merged into canary as one row: its own line (outcomeLine, through leadLine), else its title, a listed person in it reading "a teammate" before the cut, so a cut never leaves part of a name and the swap never passes the cap. A PR still open, or merged elsewhere, is refused, since only a merge into canary changes what the owner sees.
export function entryFromPull(pull: Pull): NewEntry {
  if (!pull.mergedAt) throw new Error(`#${pull.number} is not merged`)
  if (pull.baseRefName !== "canary") {
    throw new Error(`#${pull.number} merged into ${pull.baseRefName}, not canary`)
  }
  const line = outcomeLine(pull.body)
  return {
    at: new Date(pull.mergedAt),
    detail: detailOf(pull.body),
    kind: kindOfTitle(pull.title),
    link: pull.url,
    sourceKey: pullKey(pull),
    text: line ? leadLine(withTeammates(line)) : fitLine(withTeammates(plainTitle(pull.title))),
  }
}

// The PRs a release's notes link, in number order.
export function pullsIn(body: string | null): number[] {
  const numbers = [...(body ?? "").matchAll(/\/pull\/(\d+)\b/g)].map((m) => Number(m[1]))
  return [...new Set(numbers)].sort((a, b) => a - b)
}

// A release as one row counting the PRs it carries; its link is the notes that list them, since a list would break the line's cap.
export function entryFromRelease(release: Release): NewEntry {
  const prs = pullsIn(release.body).length
  return {
    at: new Date(release.createdAt),
    kind: "release",
    link: release.url,
    sourceKey: releaseKey(release.tagName),
    text: prs
      ? `Version ${release.tagName} is out, with ${prs === 1 ? "1 change" : `${prs} changes`}.`
      : `Version ${release.tagName} is out.`,
  }
}

// The publish step's own bookkeeping, a `ci(changelog)`, `ci(version)` or `ci(release)` PR: the version's group already stands for it, so it is no change of its own.
export const isBookkeeping = (pull: Pick<Pull, "title">): boolean =>
  /^ci\((?:changelog|release|version)\)!?:/i.test(pull.title)

// The merges a refresh removes: the rows of PRs this run read past (bookkeeping, or a merge into main), held to the window of numbers it read (gh lists them newest first by number, so the window holds every PR it covers), so a row outside it, older or newer than this read, is never touched.
export function staleKeys(
  held: string[],
  pulls: Pick<Pull, "number" | "url">[],
  kept: Set<string>,
): string[] {
  const window = new Map<string, [number, number]>()
  for (const pull of pulls) {
    const repo = repoOf(pull.url)
    const [low, high] = window.get(repo) ?? [pull.number, pull.number]
    window.set(repo, [Math.min(low, pull.number), Math.max(high, pull.number)])
  }
  return held.filter((key) => {
    const match = key.match(/^pr:(.+)#(\d+)$/)
    const range = match ? window.get(match[1] ?? "") : undefined
    const number = Number(match?.[2])
    return range !== undefined && number >= range[0] && number <= range[1] && !kept.has(key)
  })
}

// A line written by hand in the seed, a listed person in it reading "a teammate"; a one-word name read as two can pass the cap the seed was checked against, so such a line is cut as a PR's is.
const handLine = (text: string): string => {
  const line = withTeammates(text)
  return wordCount(line) <= MAX_WORDS ? line : leadLine(line)
}

// Every PR merged into canary from `merges.from` on, a line the seed drafted replacing its own: what sync adds every few minutes and the seed adds once, keyed alike, so either may run first and a re-run adds nothing.
export function mergeEntries(seed: Seed, pulls: Pull[]): NewEntry[] {
  return pulls
    .filter(
      (pull) =>
        pull.number >= seed.merges.from &&
        pull.mergedAt &&
        pull.baseRefName === "canary" &&
        !isBookkeeping(pull),
    )
    .map((pull) => {
      const entry = entryFromPull(pull)
      const drafted = seed.merges.lines[String(pull.number)]
      return drafted
        ? { ...entry, kind: drafted.kind ?? entry.kind, text: handLine(drafted.text) }
        : entry
    })
}

// The rules the seed adds once, each keyed by its own name.
export const ruleEntries = (seed: Seed): NewEntry[] =>
  seed.rules.lines.map((rule) => ({
    at: new Date(seed.rules.at),
    kind: "rule",
    link: null,
    sourceKey: ruleKey(rule.key),
    text: handLine(rule.text),
  }))
