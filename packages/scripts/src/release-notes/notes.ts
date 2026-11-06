// A ship's GitHub release notes in ZeroStarter's shape, which changelogen 0.6.2's markdown gives it: the compare link, one emoji section per Conventional Commits type in changelogen's order, then the contributors; pure, so the ship renders them from GitHub's compare and commits nothing.

export type NoteCommit = {
  login: string | null
  message: string
  name: string | null
  parents: number
  sha: string
}

// changelogen 0.6.2's default types, in its order; ci stays out, as ZeroStarter's changelog.config.json sets it.
const TYPES: [string, string][] = [
  ["feat", "🚀 Enhancements"],
  ["perf", "🔥 Performance"],
  ["fix", "🩹 Fixes"],
  ["refactor", "💅 Refactors"],
  ["docs", "📖 Documentation"],
  ["build", "📦 Build"],
  ["types", "🌊 Types"],
  ["chore", "🏡 Chore"],
  ["examples", "🏀 Examples"],
  ["test", "✅ Tests"],
  ["style", "🎨 Styles"],
]
const HIDDEN = new Set(["ci"])
const OTHER = "📌 Other changes"

// type, scope, the breaking bang and the subject, after an optional leading emoji, as changelogen reads a subject
const CONVENTIONAL = /^(?:\p{Extended_Pictographic}\s*)?([a-z]+)(?:\((.+)\))?(!)?: (.+)/iu
const PULL = /\([ a-z]*#(\d+)\s*\)/gi

// a first word that reads as code (a flag, a quote, a file, a script, a kebab-case or camelCase name), or a command before its arguments, keeps its case; an article before a flag is a plain word
const CODE_LIKE = /^[-`]|[\p{L}\d][-./:@_][\p{L}\d]|\p{Ll}\p{Lu}/u
const ARTICLES = new Set(["a", "an", "the"])
const COMMANDS = new Set(["bun", "bunx", "gh", "git", "npx", "playground"])

function capital(text: string): string {
  const [word = "", next = ""] = text.split(/\s+/)
  if (CODE_LIKE.test(word) || COMMANDS.has(word) || (next.startsWith("-") && !ARTICLES.has(word)))
    return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function line(
  repo: string,
  commit: NoteCommit,
  scope: string,
  breaking: boolean,
  subject: string,
): string {
  const url = `https://github.com/${repo}`
  const pulls = [...subject.matchAll(PULL)].map((m) => `[#${m[1]}](${url}/pull/${m[1]})`)
  const refs = pulls.length
    ? pulls.join(", ")
    : `[${commit.sha.slice(0, 7)}](${url}/commit/${commit.sha})`
  const text = capital(subject.replace(PULL, "").trim())
  return `- ${scope ? `**${scope}:** ` : ""}${breaking ? "⚠️  " : ""}${text} (${refs})`
}

export function renderNotes({
  commits,
  from,
  repo,
  to,
}: {
  commits: NoteCommit[]
  from: string
  repo: string
  to: string
}): string {
  const groups = new Map<string, string[]>()
  const breakingLines: string[] = []
  const authors = new Map<string, string | null>()
  for (const commit of commits.filter((c) => c.parents < 2)) {
    const [first = "", ...rest] = commit.message.split("\n")
    const [, rawType, scope = "", bang, subject = ""] = first.match(CONVENTIONAL) ?? []
    const type = rawType?.toLowerCase()
    if (type && HIDDEN.has(type)) continue
    const known = TYPES.find(([t]) => t === type)
    const breaking = Boolean(known && (bang || /^BREAKING[ -]CHANGE:/m.test(rest.join("\n"))))
    const entry = known
      ? line(repo, commit, scope, breaking, subject)
      : line(repo, commit, "", false, first)
    const title = known ? known[1] : OTHER
    groups.set(title, [...(groups.get(title) ?? []), entry])
    if (breaking) breakingLines.push(entry)
    if (commit.login && !commit.login.endsWith("[bot]") && !authors.has(commit.login))
      authors.set(commit.login, commit.name)
  }
  const sections = [...TYPES.map(([, title]) => title), OTHER]
    .filter((title) => groups.has(title))
    .map((title) => `### ${title}\n\n${groups.get(title)!.join("\n")}`)
  if (breakingLines.length) sections.push(`#### ⚠️ Breaking Changes\n\n${breakingLines.join("\n")}`)
  const contributors = [...authors].map(([login, name]) => `- ${name ? `${name} ` : ""}@${login}`)
  if (contributors.length) sections.push(`### ❤️ Contributors\n\n${contributors.join("\n")}`)
  return (
    [`[compare changes](https://github.com/${repo}/compare/${from}...${to})`, ...sections].join(
      "\n\n",
    ) + "\n"
  )
}
