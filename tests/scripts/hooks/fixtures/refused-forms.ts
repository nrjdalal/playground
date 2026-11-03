import { readdirSync } from "node:fs"
import { join } from "node:path"

import type { Group } from "./refused-forms/_shared"

export * from "./refused-forms/_shared"

// Every bypass form a review found, refused on canary or since the PR whose tests pinned it: one file a source in refused-forms/, `<n>.ts` holding #<n>'s groups, so a new source is a new file and two guard PRs add theirs without touching a shared line; tests/scripts/hooks/refused-forms.test.ts runs every row through each guard its group names and expects a refusal.
// Each row is data: it reaches a hook only as a check() input or through that test, and no session runs it as a command, in any mode, since a form can name a path outside HOME, so pointing HOME at a scratch folder contains nothing.
// A file's `allowed` lists the rows a guard-loosening PR lets run on purpose, and the rows that show the one form a guard lets run, each written as a row's "<what>" for all its cases, or as one case's "<what> | <guard> | <folder>"; ALLOWED below puts its file's source in front of each.
const FOLDER = join(import.meta.dir, "refused-forms")
const SOURCE_FILE = /^(\d+)\.ts$/

type SourceFile = { allowed?: string[]; groups: Group[] }

// Each source file in the folder, by its number, and a refusal for any other file but _shared.ts, so a misnamed file fails rather than drops its rows.
const files = readdirSync(FOLDER)
  .filter((name) => name !== "_shared.ts")
  .map((name) => {
    const n = name.match(SOURCE_FILE)?.[1]
    if (!n)
      throw new Error(`refused-forms/${name} is not <number>.ts, so its source cannot be read`)
    return { n: Number(n), name }
  })
  .sort((a, b) => a.n - b.n)

const sources = await Promise.all(
  files.map(async ({ n, name }) => ({
    file: (await import(join(FOLDER, name))) as SourceFile,
    source: `#${n}`,
  })),
)

export const REFUSED_FORMS: (Group & { source: string })[] = sources.flatMap(({ file, source }) =>
  file.groups.map((group) => ({ ...group, source })),
)

export const ALLOWED: string[] = sources.flatMap(({ file, source }) =>
  (file.allowed ?? []).map((entry) => `${source} ${entry}`),
)
