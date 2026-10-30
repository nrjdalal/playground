#!/usr/bin/env bun
// A rewrite keeps its meaning: every backticked token, bold name and ALWAYS or NEVER rule opening in the files as they stand at <base> must still appear in the files as they stand now, or be named on a "dropped: <why>" line of the ledger, the PR body's rule ledger saved to a file.
// Usage: bun scripts/check-tokens.ts <base ref> <ledger file> <file>...   (a file new since <base>, or gone now, reads as empty)

const USAGE = "usage: bun scripts/check-tokens.ts <base ref> <ledger file> <file>..."

export type Token = { kind: "backtick" | "bold" | "rule"; text: string }

const squash = (text: string) => text.replace(/\s+/g, " ")

export function tokens(text: string): Token[] {
  const all: Token[] = []
  for (const m of text.matchAll(/`([^`\n]+)`/g)) all.push({ kind: "backtick", text: m[1] })
  for (const m of text.matchAll(/\*\*([^*\n]+)\*\*/g)) all.push({ kind: "bold", text: m[1] })
  // An ALWAYS or NEVER rule is held by its marker and first five words, as tests/AGENTS.test.ts holds AGENTS.md's.
  for (const m of text.matchAll(/^\s*- ((?:ALWAYS|NEVER): (?:\S+\s+){0,4}\S+)/gm))
    all.push({ kind: "rule", text: m[1] })
  const seen = new Set<string>()
  return all.filter((t) => {
    const key = `${t.kind}\0${squash(t.text)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Every token of `before` that `after` lacks and no "dropped:" line of `ledger` names.
export function missing(before: string, after: string, ledger: string): Token[] {
  const now = squash(after)
  const dropped = ledger
    .split("\n")
    .filter((line) => line.includes("dropped:"))
    .map(squash)
  return tokens(before).filter((t) => {
    const text = squash(t.text)
    return !now.includes(text) && !dropped.some((line) => line.includes(text))
  })
}

async function git(args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", ...args], { stderr: "pipe", stdout: "pipe" })
  const out = await new Response(proc.stdout).text()
  return { code: await proc.exited, out }
}

async function main(argv: string[]): Promise<number> {
  const [base, ledgerPath, ...files] = argv
  if (!base || !ledgerPath || files.length === 0) {
    console.error(USAGE)
    return 2
  }
  if ((await git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`])).code !== 0) {
    console.error(`check-tokens: no commit ${base}`)
    return 2
  }
  const ledgerFile = Bun.file(ledgerPath)
  if (!(await ledgerFile.exists())) {
    console.error(`check-tokens: no ledger file ${ledgerPath}`)
    return 2
  }
  const before: string[] = []
  const after: string[] = []
  for (const file of files) {
    const old = await git(["show", `${base}:${file}`])
    before.push(old.code === 0 ? old.out : "")
    const current = Bun.file(file)
    after.push((await current.exists()) ? await current.text() : "")
  }
  const lost = missing(before.join("\n"), after.join("\n"), await ledgerFile.text())
  if (lost.length > 0) {
    for (const t of lost) console.log(`${t.kind}: ${t.text}`)
    console.error(
      `check-tokens: ${lost.length} token(s) from ${base} are gone: keep each, or give it a "dropped: <why>" line in the ledger`,
    )
    return 1
  }
  console.log(
    `check-tokens: every token from ${base} is kept or ledgered (${tokens(before.join("\n")).length} checked)`,
  )
  return 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
