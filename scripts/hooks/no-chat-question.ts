// Stop hook, the inbox gate: refuses a manager's stop while its final reply asks the owner for a decision or for their own action in chat, until it is an open item in the owner's Inbox (playbook's ask rule), so a question in chat is never missed. It acts for the dispatcher and the leads (PLAYGROUND_ROLE lead, dispatcher or manager, else the roster's kind for the session's registry name, else that name), judges the hook input's `last_assistant_message` (the transcript can lag the turn's last message, ADR 0001), and refuses every stop that still asks, `stop_hook_active` included, Claude Code's own cap on continuations in a row with no tool call between them bounding it. A reply naming an #iN passes once one of them reads open through bun run ask in the live dashboard's checkout; when none does, one it cannot read included, it fails closed for that reply. Anything else it cannot read lets the stop through.

import "../../packages/env/src/aliases"
import { join } from "node:path"

import {
  DISPATCHER_SLOT_LABELS,
  ID_NAME_SOURCE,
  kindOfName,
  MANAGER_KINDS,
} from "../../packages/config/src/kinds"
import { dataDir } from "../../packages/env/src/data-dir"
import { ownerSettings } from "../../packages/settings/src/owner"
import { readPolicy } from "../../packages/settings/src/rendered"
import { loadNames, MANAGER_ROLES, registryName, roleOfName, rosterNames, rosterRole } from "./role"

export const REASON =
  "name the open #iN on the same thing if one exists (bun run ask open lists them), else post it with bun run ask new, then say in chat that it's in the inbox as #iN"

// git worktree list, then each bun run ask get (all at once), is killed past its limit; one bun run ask get took 5.9s under load.
const GIT_TIMEOUT_MS = 3000
const READ_TIMEOUT_MS = 10_000
// A backstop for a read whose pipes outlive its killed process: past it, the item counts as unread, so the hook ends inside its 15s.
export const DASHBOARD_DEADLINE_MS = GIT_TIMEOUT_MS + READ_TIMEOUT_MS
const MAX_REFS = 5

const within = <T>(read: Promise<T>): Promise<T> =>
  Promise.race([
    read,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`no answer in ${DASHBOARD_DEADLINE_MS / 1000}s`)),
        DASHBOARD_DEADLINE_MS,
      ).unref(),
    ),
  ])

// "say" told to him: opening a line, a bullet, a sentence or a clause (past one of first, now, simply, so or then), or after and, or, just, or you with a modal ("you can say"), never a third person's ("The PR will say `Refs #1`")
const SAY_TO_HIM = String.raw`(?:(?:^\s*(?:(?:[-*]|\d+[.)])\s+)?|[.!?]\s+|[,;:(]\s*)(?:(?:first|now|simply|so|then)\s+)?|\b(?:and|just|or|you(?:'d|'ll|\s+(?:can|could|just|may|might|will|would))?)\s+)say\s+`
const SAY = new RegExp(String.raw`${SAY_TO_HIM}(?:["'\`][^"'\`\n]+["'\`]|yes\b|go\b)`, "im")
const PHRASES =
  /\b(?:can we|do you want|if you (?:still )?want|if you'd rather|is yours to|let me know which|one[\s-]word answer|settles it|shall I|should I|should we|tell me if|want me to|which do you|your call|your pick)\b/i
// After these a need describes, never asks ("Nothing you need to do", "If you need to roll back", "## What you need to know").
const NOT_ASKED = String.raw`(?<!\b(?:anything|if|nothing|what|whatever)\s)`
// A request for his own action, second person plus a need or a request: "please" alone, never inside a name (#projects-status-eob-please); no one, nobody or nothing waiting on him, a page only he can see, and "it yourself" after a past tense (an -ed verb, did, made, ran, saw, wrote) or a bare "you can <verb>" pass.
const ACTION = new RegExp(
  String.raw`\b(?:could you|(?<!\b(?:no one|nobody|nothing)\s)is waiting on you\b(?!')|only you can(?!'|\s(?:access|open|read|see|view)\b)|(?<![-#\w])please(?![-\w])|when you can(?!')|when you get a chance|${NOT_ASKED}you have to|${NOT_ASKED}you must|${NOT_ASKED}you need to|${NOT_ASKED}you(?:'ll| will) need to|(?<!\byou can\s)(?!(?:\w+ed|did|made|ran|saw|wrote)\s)\w+ it yourself)\b`,
  "i",
)
// A ? that is not inside a word or a URL's query (x?status=todo).
const QUESTION = /\?(?![\w/=&%#-])/
const BLOCKQUOTE = /^\s*>/
// Someone else's words: a line that says who asked ("A colleague asks: …", "A colleague asks in Slack: …"), never I or we, whose words are the session's own.
const QUOTED =
  /^\s*(?:[-*]\s+)?(?!(?:i|we)\s)[@\w][\w@.' -]{0,40}?\s(?:asks|asked|wrote|writes|said|says|replied|replies)(?:\s(?:in|on|via|from|over)\s[\w#@.-]+(?:\s[\w#@.-]+)?)?\s*:/i
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// The owner's names and handles (owner.names) as one alternation, or none while unset.
const ownerOf = (owner: string[]) => owner.map(escape).join("|")
// An agent's name (an old prefix or `<id>-<kind>`) or mention; the owner's own handles are not an agent.
const agentOf = (owner: string[]) =>
  String.raw`(?:@${owner.length ? String.raw`(?!(?:${ownerOf(owner)})\b)` : ""}[\w-]+|light(?:man|kid|boy|plan)|${ID_NAME_SOURCE}|(?:worker|reviewer|tester|runner|probe)-[\w-]+)`
const BULLET = String.raw`(?:(?:[-*]|\d+[.)])\s+)?`

// A role label opening a line ("Ops: should I restart the dashboard?") is a heading to the owner, never a line put to a session, so a roster name that reads as one (optimizer) stays out.
const ROLE_LABELS = new Set(
  [...DISPATCHER_SLOT_LABELS, ...MANAGER_KINDS].map((label) => label.toLowerCase()),
)

// Pure: each roster name as chat names it, its role word dropped (`worker-plain-fern` is plain-fern, `k3m9px-worker` k3m9px), as a pattern; a word that names no session (well-known) or a role label stays out.
const shownNames = (names: string[]): string[] =>
  names.flatMap((name) => {
    const kind = kindOfName(name)
    const shown = !kind
      ? name
      : name.startsWith(`${kind}-`)
        ? name.slice(kind.length + 1)
        : name.slice(0, -kind.length - 1)
    return shown && !ROLE_LABELS.has(shown.toLowerCase())
      ? [shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]
      : []
  })
// A line addressed to the owner by name, then a verb that asks them to act ("<owner>, plug in the Mac"); a bulleted "- <owner>:" is a label, as a bulleted "- builder:" is a status line, and a status to them ("<owner>, quick update: …") opens on no such verb.
const toOwner = (owner: string[]) =>
  owner.length
    ? new RegExp(
        String.raw`^\s*(?:(?:[-*]|\d+[.)])\s+@?(?:${ownerOf(owner)})\s*,|@?(?:${ownerOf(owner)})\s*[,:])\s*(?:accept|add|allow|answer|approve|check|click|close|confirm|connect|copy|create|decide|delete|deny|enable|generate|give|grant|install|log|look|merge|move|open|pass|paste|pick|plug|press|pull|put|reload|remove|reply|restart|review|rotate|run|send|share|sign|start|switch|tap|try|turn|type|unplug|upgrade|visit)\b(?!')`,
        "i",
      )
    : undefined
// A question to another agent: a line saying it was put to one ("Sent builder: …", "I asked builder: …", "To builder: …"), addressing one ("builder, …"), or opening on its name ("builder: …") with no bullet, since a bulleted "- builder: idle, …" is a status line that exempts nothing. A roster name as chat names it counts too (shownNames).
const toAgent = (names: string[], owner: string[]) => {
  const agent = [agentOf(owner), ...shownNames(names)].join("|")
  return new RegExp(
    String.raw`^\s*(?:${BULLET}(?:(?:i\s+)?(?:sent|asked|told|messaged|pinged)|to)\s+(?:${agent})\s*[,:]|${BULLET}(?:${agent})\s*,|(?:${agent})\s*:)`,
    "i",
  )
}
// An optional pointer leaves him free to skip it: "if you want to look" or "to see", and an "if you want" closing a sentence of a bare "you can" ("You can withdraw it yourself if you want."), but never an "if" later in a clause of "ask me", "let me know", "need to know", "say" or "tell me" (us too).
const IF_NOT_ASKED = String.raw`(?<!\b(?:ask (?:me|us)|let (?:me|us) know|need to know|say|tell (?:me|us))\b[^,.?!;]*)\bif you (?:still )?want`
const POINTER = new RegExp(
  String.raw`${IF_NOT_ASKED} to (?:check|look|read|see|view|watch)\b|(?<=(?<!\b(?:only|when)\s)\byou can\b(?!')[^,.?!;]*)${IF_NOT_ASKED}(?=\s*(?:[.!]|$))`,
  "gi",
)
// A quoted span is someone else's words, unless it is the word the owner is told to say (Say "go").
const QUOTE_SPAN = new RegExp(String.raw`(?<!${SAY_TO_HIM})"[^"\n]*"`, "gim")
// An inline code span is code, unless it is the word he is told to say (Say `go`).
const CODE_SPAN = new RegExp(String.raw`(?<!${SAY_TO_HIM})\`[^\`\n]*\``, "gim")
// The quoted span or the sentence that follows a QUOTED or TO_AGENT prefix: a sentence ends at its first . ? ! or ; before a space or the line's end.
const FIRST_SENTENCE = /^\s*(?:"[^"\n]*"|.*?[.?!;]+["')\]]*(?=\s|$))/

// Pure: the line's own words, with someone else's words or a line put to an agent (its prefix and first sentence) taken out, so an ask after them still counts.
function ownWords(line: string, toAgentLine: RegExp): string {
  const prefix = line.match(QUOTED) ?? line.match(toAgentLine)
  if (!prefix) return line
  const rest = line.slice(prefix[0].length)
  return FIRST_SENTENCE.test(rest) ? rest.replace(FIRST_SENTENCE, "") : ""
}

// Pure: whether the reply asks the owner for a decision or for their own action, code, quotes and lines to others (names, the roster's as chat names them) left out.
export function asksDecision(reply: string, names: string[] = [], owner: string[] = []): boolean {
  const toAgentLine = toAgent(names, owner)
  const toOwnerLine = toOwner(owner)
  const lines = reply
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(CODE_SPAN, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // bold and underline marks, so a bold label ("**A colleague asks:**") reads as its words
    .replace(/\*\*|__/g, "")
    .split("\n")
    .filter((line) => line.trim() && !BLOCKQUOTE.test(line))
  return lines.some((line) => {
    const own = ownWords(line, toAgentLine).replace(QUOTE_SPAN, '""').replace(POINTER, "")
    return (
      SAY.test(own) ||
      PHRASES.test(own) ||
      QUESTION.test(own) ||
      ACTION.test(own) ||
      !!toOwnerLine?.test(own)
    )
  })
}

export type Deps = {
  itemStatus: (ref: string) => Promise<string>
  ownerNames?: (env: Record<string, string | undefined>) => Promise<string[]>
  sessionName: (sessionId: string) => Promise<string | undefined> | string | undefined
}

// Every dashboard read still running; Bun.spawn's timeout is a timer in this process, so a read left behind at exit would run on unbounded.
const running = new Set<Bun.Subprocess>()

async function output(command: string[], cwd: string, timeoutMs: number) {
  const run = Bun.spawn(command, { cwd, stderr: "pipe", stdout: "pipe", timeout: timeoutMs })
  running.add(run)
  void run.exited.finally(() => running.delete(run))
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ])
  if (run.signalCode) throw new Error(`${command[0]} timed out after ${timeoutMs / 1000}s`)
  if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `${command[0]} exited ${code}`)
  return out
}

let dashboard: Promise<string> | undefined

// The live dashboard's checkout, the worktree on the branch live.branch names, whose database is the owner's Inbox.
function dashboardCheckout(): Promise<string> {
  const setting = join(import.meta.dir, "../../packages/scripts/src/playground/setting.ts")
  dashboard ??= Promise.all([
    output(["bun", setting, "--text", "live.branch"], import.meta.dir, READ_TIMEOUT_MS),
    output(["git", "worktree", "list", "--porcelain"], import.meta.dir, GIT_TIMEOUT_MS),
  ]).then(([read, listed]) => {
    const branch = read.trim()
    const block = listed
      .split("\n\n")
      .find((b) => b.split("\n").includes(`branch refs/heads/${branch}`))
    const path = block?.match(/^worktree (.+)$/m)?.[1]
    if (!path) throw new Error(`no ${branch} checkout in git worktree list`)
    return path
  })
  return dashboard
}

// One item's status, read by the checkout's own bun run ask, killed past the limit.
export async function readStatus(
  ref: string,
  checkout: string,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<string> {
  const item = JSON.parse(
    await output(
      ["bun", join(checkout, "api/hono/src/bin/dashboard-ask.ts"), "get", ref],
      checkout,
      timeoutMs,
    ),
  ) as { status?: unknown }
  if (typeof item.status !== "string") throw new Error(`bun run ask printed no status for ${ref}`)
  return item.status
}

// The owner's names from the extensions' policy; none when it cannot be read, so the gate still reads every other ask.
const policyOwnerNames = async (env: Record<string, string | undefined>): Promise<string[]> => {
  const read = await readPolicy(dataDir(env))
  return read.settings ? ownerSettings.get(read.settings, "owner.names") : []
}

const live: Deps = {
  itemStatus: async (ref) => readStatus(ref, await dashboardCheckout()),
  ownerNames: policyOwnerNames,
  sessionName: registryName,
}

async function isManager(env: Record<string, string | undefined>, sessionId: unknown, deps: Deps) {
  const role = env.PLAYGROUND_ROLE ?? ""
  if (MANAGER_ROLES.has(role)) return true
  if (role || typeof sessionId !== "string") return false
  const name = (await deps.sessionName(sessionId)) ?? ""
  const rostered = name && (await rosterRole(name, env))
  if (rostered) return MANAGER_ROLES.has(rostered)
  await loadNames(env)
  return MANAGER_ROLES.has(roleOfName(name))
}

// Fails closed: the stop passes only when some #iN the reply names reads open; the reason says what each one read as.
async function gate(reply: string, deps: Deps): Promise<string | undefined> {
  const refs = [...new Set(reply.match(/#i\d+\b/g) ?? [])].slice(0, MAX_REFS)
  if (!refs.length) return REASON
  const anyOpen = Promise.withResolvers<"open">()
  const reads = Promise.all(
    refs.map((ref) =>
      within(deps.itemStatus(ref)).then(
        (status) => {
          if (status === "open") anyOpen.resolve("open")
          return { ref, status }
        },
        (error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
          ref,
        }),
      ),
    ),
  )
  const read = await Promise.race([reads, anyOpen.promise]).finally(() => {
    for (const run of running) run.kill("SIGKILL")
  })
  if (read === "open") return
  const why = read.map((r) =>
    "status" in r
      ? `${r.ref} is ${r.status}, not open`
      : `${r.ref} could not be read with bun run ask (${r.error}), so it does not count as open`,
  )
  return `${REASON} (${why.join("; ")})`
}

async function inspect(raw: string, env: Record<string, string | undefined>, deps: Deps) {
  const { last_assistant_message: reply, session_id: sessionId } = JSON.parse(raw) as {
    last_assistant_message?: unknown
    session_id?: unknown
  }
  if (typeof reply !== "string") return
  const owner = await (deps.ownerNames ?? policyOwnerNames)(env)
  if (!asksDecision(reply, [], owner)) return
  if (!(await isManager(env, sessionId, deps))) return
  if (!asksDecision(reply, await rosterNames(env), owner)) return
  return gate(reply, deps)
}

// Fails open: an input the hook cannot read, or a session it cannot place, lets the session stop.
export async function check(
  raw: string,
  env: Record<string, string | undefined> = process.env,
  deps: Deps = live,
): Promise<string | undefined> {
  try {
    return await inspect(raw, env, deps)
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const reason = await check(await Bun.stdin.text())
  // additionalContext continues the turn without the "Stop hook error" notice a block shows (ADR 0001)
  if (reason)
    console.log(
      JSON.stringify({ hookSpecificOutput: { additionalContext: reason, hookEventName: "Stop" } }),
    )
  // a read past its deadline may still hold a pipe open, which would keep the hook running
  process.exit(0)
}
