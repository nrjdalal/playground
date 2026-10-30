import {
  appendFileSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

// The record of every page `playground page` kept, one JSON line each, beside the pages in the previews folder.
export const PAGES_FILE = "pages.jsonl"

export type PageLine = { at: string; by: string; file: string; for: string | null; title: string }

export const PAGE_USAGE =
  'usage: playground page <file.html> --title "<title>" --by <session> [--for <session>]'

// A name the Previews app serves: a letter or digit, then letters, digits, ., _ or -, ending .html, as PREVIEW_NAME_PATTERN in api/hono/src/lib/apps/previews.ts reads it.
const PAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.html$/

type PageArgs = { by: string; file: string; for: string | null; title: string }

// The file and options `playground page` was given, or why they are refused.
export const pageArgs = (args: string[]): PageArgs | { error: string } => {
  const options: Record<string, string> = {}
  const words: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (["--by", "--for", "--title"].includes(arg)) {
      const value = args[++i]
      if (!value) return { error: `${arg} needs a value; ${PAGE_USAGE}` }
      options[arg] = value
    } else if (arg.startsWith("-"))
      return { error: `playground page takes no ${arg}; ${PAGE_USAGE}` }
    else words.push(arg)
  }
  const [file, ...extra] = words
  if (!file || extra.length) return { error: PAGE_USAGE }
  const title = options["--title"]?.trim()
  const by = options["--by"]
  if (!title || !by) return { error: PAGE_USAGE }
  return { by, file, for: options["--for"] ?? null, title }
}

// Every session name the roster in the data folder lists.
const rosterNames = (data: string): Set<string> => {
  try {
    const roster = JSON.parse(readFileSync(join(data, "roster.json"), "utf8")) as {
      agents?: { name?: unknown }[]
    }
    return new Set(
      (roster.agents ?? []).flatMap((a) => (typeof a.name === "string" ? [a.name] : [])),
    )
  } catch {
    return new Set()
  }
}

// The first of name, name-2, name-3… whose page and caption are both free in the folder, so a page never takes another file's caption.
export const freeName = (folder: string, name: string): string => {
  const stem = name.slice(0, -".html".length)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? stem : `${stem}-${n}`
    if (
      !existsSync(join(folder, `${candidate}.html`)) &&
      !existsSync(join(folder, `${candidate}.txt`))
    )
      return `${candidate}.html`
  }
}

// Keeps a page: copies the HTML file into the previews folder under a free name, writes its title to the caption beside it and appends its line to pages.jsonl. The path of the copy, or why it is refused.
export const keepPage = (
  args: PageArgs,
  data: string,
  now = new Date(),
): { path: string } | { error: string } => {
  const name = basename(args.file)
  if (!PAGE_NAME.test(name) || name.includes(".."))
    return {
      error: `${name} is not an HTML file with a plain name (letters, digits, ., _ and -, ending .html)`,
    }
  let bytes: Buffer
  try {
    bytes = readFileSync(args.file)
  } catch {
    return { error: `no file at ${args.file}` }
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return { error: `${args.file} is not text, so it is not an HTML page` }
  }
  const known = rosterNames(data)
  for (const session of [args.by, args.for]) {
    if (session !== null && !known.has(session))
      return { error: `no session named ${session} in ${join(data, "roster.json")}` }
  }
  const folder = join(data, "previews")
  mkdirSync(folder, { mode: 0o700, recursive: true })
  const file = freeName(folder, name)
  const path = join(folder, file)
  copyFileSync(args.file, path, constants.COPYFILE_EXCL)
  writeFileSync(join(folder, `${file.slice(0, -".html".length)}.txt`), `${args.title}\n`, {
    flag: "wx",
  })
  const line: PageLine = {
    at: now.toISOString(),
    by: args.by,
    file,
    for: args.for,
    title: args.title,
  }
  appendFileSync(join(folder, PAGES_FILE), `${JSON.stringify(line)}\n`)
  return { path }
}
