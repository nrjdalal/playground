// SessionStart hook, matcher "resume": after any restart that resumes a factory session, it tells the session to re-arm what the restart ended and re-send what went unanswered (playbook's **context** rule), since an account switch restarts every session, and a watch, a loop or a round request it held is otherwise lost.

import { dirname, join } from "node:path"

import { WAITER } from "./after-compact"
import { fromFactory, MANAGER_ROLES, sessionOf, sessionRole } from "./role"

// The transcript's tail it reads: a transcript runs to many megabytes, and its last entries sit at the end.
export const TAIL = 256 * 1024

// The newest timestamp in the transcript, the old process's last entry: measured on 2.1.309, a resumed process writes no timestamped line before its first input, so none of its own precedes this hook. Entries are not written in time order, hence the newest rather than the last, and none after now counts, since a tool result can carry a timestamp of its own.
export async function lastEntry(path: unknown, now = new Date()): Promise<Date | undefined> {
  if (typeof path !== "string" || !path) return undefined
  const text = await tail(path)
  let newest = Number.NaN
  for (const m of text.matchAll(/"timestamp":"([^"]+)"/g)) {
    const at = Date.parse(m[1] ?? "")
    if (at <= now.getTime() && (Number.isNaN(newest) || at > newest)) newest = at
  }
  return Number.isNaN(newest) ? undefined : new Date(newest)
}

const minute = (at: Date) => `${at.toISOString().slice(0, 16)}Z`

// The time goes into the text, since the session may read it hours later and sees no time on its own messages: its last entry before the restart, else the resume itself.
export function rearm(stopped: Date | undefined, now: Date): string {
  const before = stopped
    ? `${minute(stopped)}, your last entry before the restart`
    : `${minute(now)}, the resume`
  return `This session was restarted and resumed at ${minute(now)}, and the restart ended every background task, loop and watch it was running. Before you act: 1. Re-arm every background loop and watch you had running, and each cron CronList no longer shows, started again the way you started it. 2. Re-send each message to another session that got no reply in the 10 minutes before ${before}, marked as a re-send. Then carry on. Done when each one runs again and each re-send has gone, or you have found none.`
}

async function tail(path: unknown): Promise<string> {
  if (typeof path !== "string" || !path) return ""
  const file = Bun.file(path)
  return file.slice(Math.max(0, file.size - TAIL)).text()
}

// Each patch lefthook left in the shared git folder when a restart killed a commit mid pre-commit, the unstaged half of a partly staged file, which nothing puts back, with the folder it belongs in: lefthook names it by the worktree's folder, and with no name in a main checkout (measured on lefthook 2.2.2), and a resume's cwd is the folder the session started in, the main checkout for a worker, so a worktree's patch is the session's when it resumed there or its transcript's tail names that folder.
export async function leftPatches(
  cwd: unknown,
  transcript: string,
): Promise<{ folder: string; patch: string }[]> {
  if (typeof cwd !== "string" || !cwd) return []
  const git = Bun.spawn(
    ["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"],
    { stderr: "ignore", stdout: "pipe" },
  )
  const [common, own] = (await new Response(git.stdout).text()).trim().split("\n")
  if ((await git.exited) !== 0 || !common || !own) return []
  const found: { folder: string; patch: string }[] = []
  const info = join(common, "info")
  for await (const file of new Bun.Glob("lefthook-unstaged.*patch").scan(info)) {
    const name = file.slice("lefthook-unstaged.".length, -".patch".length)
    const patch = join(info, file)
    if (!name) {
      if (own === common) found.push({ folder: dirname(common), patch })
      continue
    }
    const gitdir = Bun.file(join(common, "worktrees", name, "gitdir"))
    if (!(await gitdir.exists())) continue
    const folder = dirname((await gitdir.text()).trim())
    const escaped = folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const named = new RegExp(`${escaped}(?![\\w.-])`).test(transcript)
    if (own === join(common, "worktrees", name) || named) found.push({ folder, patch })
  }
  return found
}

const restore = ({ folder, patch }: { folder: string; patch: string }) =>
  `The restart killed a commit after lefthook had set aside the unstaged half of a partly staged file, so that edit is missing from ${folder}: before any commit there, put it back with \`git -C ${folder} apply --unidiff-zero ${patch}\`, since plain \`git apply\` fails on its patch with no context lines. Done when \`git -C ${folder} diff\` shows the edit again.`

// The hook's output, or nothing for a session outside the factory: the owner's own sessions load this hook too, from the project settings, and need no instruction. Fails open, so a resume never waits on this hook.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<string | undefined> {
  try {
    if (!(await fromFactory(raw, environment))) return undefined
    const input = JSON.parse(raw) as { cwd?: unknown; transcript_path?: unknown }
    const stopped = await lastEntry(input.transcript_path, now).catch(() => undefined)
    const manager = MANAGER_ROLES.has(await sessionRole(environment, sessionOf(raw)))
    const transcript = await tail(input.transcript_path).catch(() => "")
    const patches = await leftPatches(input.cwd, transcript).catch(() => [])
    const text = [rearm(stopped, now), ...patches.map(restore)].join(" ")
    return JSON.stringify({
      hookSpecificOutput: {
        additionalContext: manager ? `${text} ${WAITER}` : text,
        hookEventName: "SessionStart",
      },
    })
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const out = await check(await Bun.stdin.text())
  if (out) console.log(out)
}
