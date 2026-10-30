// SessionStart hook, matcher "resume": after any restart that resumes a factory session, it tells the session to re-arm what the restart ended and re-send what went unanswered (playbook's **context** rule), since an account switch restarts every session, and a watch, a loop or a round request it held is otherwise lost.

import { fromFactory } from "./role"

// The transcript's tail it reads: a transcript runs to many megabytes, and its last entries sit at the end.
export const TAIL = 256 * 1024

// The newest timestamp in the transcript, the old process's last entry: measured on 2.1.309, a resumed process writes no timestamped line before its first input, so none of its own precedes this hook. Entries are not written in time order, hence the newest rather than the last, and none after now counts, since a tool result can carry a timestamp of its own.
export async function lastEntry(path: unknown, now = new Date()): Promise<Date | undefined> {
  if (typeof path !== "string" || !path) return undefined
  const file = Bun.file(path)
  const text = await file.slice(Math.max(0, file.size - TAIL)).text()
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

// The hook's output, or nothing for a session outside the factory: the owner's own sessions load this hook too, from the project settings, and need no instruction. Fails open, so a resume never waits on this hook.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<string | undefined> {
  try {
    if (!(await fromFactory(raw, environment))) return undefined
    const input = JSON.parse(raw) as { transcript_path?: unknown }
    const stopped = await lastEntry(input.transcript_path, now).catch(() => undefined)
    return JSON.stringify({
      hookSpecificOutput: { additionalContext: rearm(stopped, now), hookEventName: "SessionStart" },
    })
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const out = await check(await Bun.stdin.text())
  if (out) console.log(out)
}
