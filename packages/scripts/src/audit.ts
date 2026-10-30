// `bun audit <args>` that tries again, up to 3 tries of 90s, when npm's advisories endpoint hangs or answers 5xx, and fails at once on any other exit, an advisory found among them
// With `--new-over <ref>` it fails only on an advisory the head adds over <ref>'s lockfile, at the head's merge base with <ref> or in the file <ref> names, so a PR never fails on an advisory canary already carries

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TRIES = 3
// AUDIT_TRY_MS shortens a try for the tests alone
const LIMIT_MS = Number(process.env.AUDIT_TRY_MS) || 90_000
const SERVER_ERROR = /advisories\/bulk - 5\d\d\b/
const LEVELS = ["low", "moderate", "high", "critical"]

export type Advisory = { id: string; package: string; severity: string; title: string }

// one `bun audit` in cwd, tried again on a hang or a 5xx; null when no try was answered
const attempt = async (args: string[], cwd: string, echo: boolean) => {
  for (let n = 1; ; n++) {
    const proc = Bun.spawn(["bun", "audit", ...args], {
      cwd,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
      timeout: LIMIT_MS,
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (echo) {
      process.stdout.write(out)
      process.stderr.write(err)
    }
    if (code === 0) return { code: 0, err, out }
    const why =
      // Bun's timeout ends a try with SIGTERM, while a crash comes by another signal and is the run's
      proc.signalCode === "SIGTERM"
        ? `no answer in ${LIMIT_MS / 1000}s`
        : SERVER_ERROR.test(out + err)
          ? "npm's advisories endpoint answered 5xx"
          : ""
    if (!why) return { code: code ?? 1, err, out }
    if (n === TRIES) {
      console.error(`audit: ${why} on all ${TRIES} tries`)
      return null
    }
    console.error(`audit: try ${n} of ${TRIES}: ${why}, trying again`)
  }
}

const valuesOf = (args: string[], flag: string) =>
  args.flatMap((arg, i) => (arg === flag && i + 1 < args.length ? [args[i + 1]] : []))

// the advisories `bun audit --json` finds in cwd at `--audit-level` or above, but those `--ignore` names, by their GHSA id; null when the audit gave no answer
export const advisories = async (cwd: string, args: string[]): Promise<Advisory[] | null> => {
  const floor = LEVELS.indexOf(valuesOf(args, "--audit-level")[0] ?? "low")
  const ignore = new Set(valuesOf(args, "--ignore"))
  const res = await attempt(["--json"], cwd, false)
  if (!res) return null
  let found: Record<string, { id: number; severity: string; title: string; url: string }[]>
  try {
    found = JSON.parse(res.out)
  } catch {
    process.stderr.write(res.out + res.err)
    console.error(`audit: bun audit --json in ${cwd} exited ${res.code} with no answer to read`)
    return null
  }
  return Object.entries(found).flatMap(([pkg, list]) =>
    list
      .map((a) => ({
        id: a.url.split("/").pop() || String(a.id),
        package: pkg,
        severity: a.severity,
        title: a.title,
      }))
      .filter((a) => LEVELS.indexOf(a.severity) >= floor && !ignore.has(a.id)),
  )
}

export const advisoryLine = (a: Advisory) => `${a.id} (${a.package}, ${a.severity}): ${a.title}`

const run = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { stderr: "pipe", stdout: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, err: err.trim(), out }
}

// the base's bun.lock: the file ref names, else the lockfile at HEAD's merge base with ref
const baseLock = async (ref: string) => {
  const file = Bun.file(ref)
  if (await file.exists()) return file.text()
  const base = await run(["git", "merge-base", "HEAD", ref])
  if (base.code !== 0) {
    console.error(`audit: no merge base of HEAD and ${ref}: ${base.err}`)
    return null
  }
  const lock = await run(["git", "show", `${base.out.trim()}:bun.lock`])
  if (lock.code !== 0) {
    console.error(`audit: no bun.lock at ${base.out.trim()}: ${lock.err}`)
    return null
  }
  return lock.out
}

const newOver = async (args: string[], ref: string) => {
  const lock = await baseLock(ref)
  if (lock === null) return 1
  // bun audit reads the lockfile alone, beside any package.json
  const dir = mkdtempSync(join(tmpdir(), "audit-base-"))
  try {
    await Bun.write(join(dir, "bun.lock"), lock)
    await Bun.write(join(dir, "package.json"), "{}\n")
    const [head, base] = await Promise.all([advisories(process.cwd(), args), advisories(dir, args)])
    if (!head || !base) return 1
    if (base.length)
      console.log(
        `audit: ${ref} already carries ${base.length}, which fail its own audit, not this one:\n${base.map((a) => `  ${advisoryLine(a)}`).join("\n")}`,
      )
    const known = new Set(base.map((a) => a.id))
    const added = head.filter((a) => !known.has(a.id))
    if (!added.length) {
      console.log(`audit: this head adds no advisory over ${ref}`)
      return 0
    }
    console.error(
      `audit: this head adds ${added.length} over ${ref}:\n${added.map((a) => `  ${advisoryLine(a)}`).join("\n")}`,
    )
    return 1
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

const main = async (args: string[]) => {
  const at = args.indexOf("--new-over")
  if (at === -1) {
    const res = await attempt(args, process.cwd(), true)
    return res ? res.code : 1
  }
  const ref = args[at + 1]
  if (!ref) {
    console.error("audit: --new-over takes a ref or a lockfile")
    return 2
  }
  return newOver([...args.slice(0, at), ...args.slice(at + 2)], ref)
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
