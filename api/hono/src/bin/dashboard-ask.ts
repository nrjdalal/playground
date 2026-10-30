import "@/bin/ask-from-clone"
import { join } from "node:path"

import { ASK_CODE_COLUMNS } from "@packages/config/inbox"
import { createDatabase } from "@packages/db"
import { env } from "@packages/env/db"

import { ASK_EXAMPLES, isAskExampleKind, shapeHints } from "@/lib/dashboard/ask-shape"
import { branchOf, checkoutRoot, readsLive } from "@/lib/dashboard/fixture"
import {
  ackItem,
  editItem,
  getItem,
  itemTag,
  postItem,
  readAnswer,
  resolveItem,
  settleItem,
  staleItems,
} from "@/lib/dashboard/inbox"
import { keepAttachments } from "@/lib/dashboard/inbox-attachments"
import { livePair, othersLiveDashboard } from "@/lib/dev/launch"
import { checkoutMismatch, locate, prove } from "@/lib/sessions/guard"

// The one way into Playground's Inbox: `bun run ask new < item.json` posts a decision, a draft or an update and prints its id (its #iN tag on stderr); `edit <id|#iN> < item.json` replaces the poster's own open item's title and preview in place, checked as new checks it; `get <id|#iN>` prints the item, the owner's answer included once given, and `--ack` marks that answer read, so the Dashboard shows it reached the poster, closing a deny, a clear or a discard; `ack <id>` closes it once carried out, a go with `--link` (where it landed) or `--no-link "<why>"`; `settle <id>` closes the poster's own open item once it is decided another way; `resolve <id> --by <you>` closes the poster's own alert update once it has resolved itself; `stale` lists the answers no poster has closed, for ops-sweep; `example <kind>` prints an ask to start from, and `new` hints at that shape when an ask is one block of prose or holds a code line too wide for the card. See `.agents/dashboard/asks.md` for the fields.
const USAGE = `usage: bun run ask new [--thread <id>] < item.json
                                                posts an inbox item from JSON on stdin, prints its id
                                                options and approve/deny labels go in plain words (ELI5, ASD-STE100)
                                                an ask's attachments name files on this Mac by absolute path
                                                an update with text and attachments is a read-only card: it shows
                                                them as an ask does, with no Approve or Deny
                                                --thread files it under that thread (bun run thread)
       bun run ask edit <id|#iN> < item.json
                                                replaces your own open item's title, preview and attachments
                                                in place, checked as new checks it, so one card carries a
                                                progress to its end; a snoozed item edits and stays snoozed;
                                                an item answered, closed or replied to in chat is refused
       bun run ask example <code|decision|slack|ui>
                                                prints an item to start from: an ask's picture of the point, bullets,
                                                then what Approve does (.agents/dashboard/asks.md, The ask's shape),
                                                or a Slack message led by its thread so far
       bun run ask get <id|#iN> [--ack]    prints the item, answer included; --ack marks an answer read
                                                (and closes a deny, a clear or a discard, which reading carries out)
       bun run ask ack <id|#iN> [--link <https url> [--label "Filed ABC-123"] | --no-link "<why>"]
                                                closes the answer once carried out; a go (approve, draft, edit, send)
                                                needs --link, where it landed (the Slack message, PR, issue or
                                                Linear ticket), which its card links to, named by --label, else
                                                by the link itself, or --no-link with why there is none
       bun run ask settle <id|#iN> [--note "<one line>"] [--link <https url> [--label "<one line>"]]
                                                closes your own open item, decided another way
       bun run ask resolve <id|#iN> --by <your session name> [--note "<one line>"]
                                                closes your own alert update, once it has resolved itself
       bun run ask stale [--minutes 15] [--since <iso time>]
                                                lists each answer given since --since (default 24h ago)
                                                that its poster has not acked within --minutes`

// An agent's shell hands a command a stdin that never closes, so waiting on it unbounded would hang the call that forgot the redirect.
const STDIN_TIMEOUT_MS = 5000

const DAY_MS = 24 * 60 * 60 * 1000

const fail = (message: string, code = 1): never => {
  console.error(`ask: ${message}`)
  process.exit(code)
}

const [command, key, ...rest] = process.argv.slice(2)

// A template needs no database, so it prints before the checkout's database is proved.
if (command === "example") {
  if (key === undefined || rest.length > 0 || !isAskExampleKind(key)) fail(USAGE, 2)
  else console.log(JSON.stringify(ASK_EXAMPLES[key], null, 2))
  process.exit(0)
}

// A checkout that does not read the live machine (a factory checkout or session, a test run) has its own database, so say so on stderr, where it leaves the id on stdout clean: an item posted here never reaches the owner.
if (!readsLive()) {
  console.error(
    "ask: this checkout reads the fixture, and the owner's Dashboard (the live dashboard) never shows its inbox; for a real item, run bun run --cwd <the live dashboard's checkout> ask",
  )
}

const acking = rest.length === 1 && rest[0] === "--ack"

// Pure: `--name value` pairs, each named at most once and only from allowed; null for anything else.
const flagsOf = (args: string[], allowed: string[]): Record<string, string> | null => {
  if (args.length % 2 !== 0) return null
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, "") ?? ""
    if (!args[i]?.startsWith("--") || !allowed.includes(name) || name in flags) return null
    flags[name] = args[i + 1] ?? ""
  }
  return flags
}

const flags =
  command === "ack"
    ? flagsOf(rest, ["label", "link", "no-link"])
    : command === "resolve"
      ? flagsOf(rest, ["by", "note"])
      : command === "settle"
        ? flagsOf(rest, ["label", "link", "note"])
        : command === "stale" || command === "new"
          ? flagsOf(
              key === undefined ? [] : [key, ...rest],
              command === "new" ? ["thread"] : ["minutes", "since"],
            )
          : {}
const valid =
  (command === "get" && key && (rest.length === 0 || acking)) ||
  ((command === "ack" || command === "settle") && key && flags !== null) ||
  (command === "resolve" && key && flags !== null && !!flags.by) ||
  (command === "stale" && flags !== null) ||
  (command === "new" && flags !== null && flags.thread !== "" && !process.stdin.isTTY) ||
  (command === "edit" && key && rest.length === 0 && !process.stdin.isTTY)
if (!valid) fail(USAGE, 2)

// The database, proved this machine's own container before the first read or write, as bun run ingest does; the live dashboard's is refused off its own checkout, as the launcher refuses it, so a worktree's item never lands in the owner's inbox.
try {
  // a run by path from another checkout, or a POSTGRES_URL exported over the .env, reaches a database this checkout never shows; a test run passes its own container's URL on purpose
  const root = checkoutRoot()
  const dotenv =
    root === null
      ? null
      : await Bun.file(join(root, ".env"))
          .text()
          .catch(() => null)
  const stray = process.env.NODE_ENV === "test" ? null : checkoutMismatch(env.POSTGRES_URL, dotenv)
  if (stray) fail(stray)
  const located = locate(env.POSTGRES_URL)
  if (othersLiveDashboard(located.owner.name, branchOf(root))) {
    fail(
      `refusing ${livePair().database}, the live dashboard's database, off its own checkout (branch ${livePair().branch}); run bun run --cwd <the live dashboard's checkout> ask`,
    )
  }
  await prove(env.POSTGRES_URL, located)
} catch (error) {
  fail(`refusing to use the database: ${(error as Error).message}`)
}
const db = createDatabase(env.POSTGRES_URL)

if (command === "new" || command === "edit") {
  const timer = setTimeout(
    () => fail("no JSON arrived on stdin; redirect a file or pipe one in"),
    STDIN_TIMEOUT_MS,
  )
  const text = await Bun.stdin.text()
  clearTimeout(timer)
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    fail("stdin is not JSON")
  }
  for (const hint of shapeHints(input)) {
    console.error(
      hint.kind === "prose"
        ? "ask: this ask is one block of prose; lead with a picture of the point (an ASCII flow or a diff in a code block), then short bullets, then what Approve does in its approve and deny labels. bun run ask example code|decision|ui prints a template (.agents/dashboard/asks.md, The ask's shape)"
        : `ask: a code or ASCII line runs ${hint.longest} characters, past the ${ASK_CODE_COLUMNS} the narrowest Inbox card shows on one line; break or shorten it (.agents/dashboard/asks.md, The ask's shape)`,
    )
  }
  // the files an ask names are copied in first, so the item keeps their ids, never a path on this Mac
  const kept = await keepAttachments(input)
  if (!kept.ok) fail(kept.message)
  const result =
    command === "edit"
      ? await editItem(db, key as string, kept.ok ? kept.input : input)
      : await postItem(db, kept.ok ? kept.input : input, flags?.thread)
  if (!result.ok)
    fail(
      command === "edit" && result.code === "NOT_FOUND" ? `no inbox item ${key}` : result.message,
    )
  else {
    // the id alone on stdout, as a poster's `id=$(bun run ask new < f)` takes it; the tag the owner sees beside it on stderr
    if (command === "new") console.log(result.item.id)
    console.error(`ask: ${command === "edit" ? "edited" : "posted"} ${itemTag(result.item.ref)}`)
    // a draft whose link is a Slack message replies to it, so the poster checks it is still unanswered
    const link = (result.item.preview as { link?: string }).link ?? ""
    if (result.item.kind === "draft" && link.includes("/thread/")) {
      console.error(
        "ask: this draft replies to a message: read that conversation from it on, thread and top level, and settle this draft if the owner has already answered",
      )
    }
  }
} else if (command === "get") {
  let item = await getItem(db, key as string)
  if (!item) fail(`no inbox item ${key}`)
  // An open item is printed as it is, so a poll with --ack only marks the answer once there is one; an update takes none, though a dismissed one records when in its answer.
  if (acking && item) item = await readAnswer(db, item)
  console.log(JSON.stringify(item, null, 2))
} else if (command === "stale") {
  const minutes = Number(flags?.minutes ?? 15)
  const since = flags?.since === undefined ? new Date(Date.now() - DAY_MS) : new Date(flags.since)
  if (!Number.isInteger(minutes) || minutes < 0) fail("--minutes takes a whole number")
  if (Number.isNaN(since.getTime())) fail("--since takes an ISO time")
  const now = Date.now()
  // one line an answer: its tag and id, its poster, how its delivery stands and how long ago the owner answered
  for (const item of await staleItems(db, { minutes, since })) {
    const delivery = item.delivery
    const state =
      delivery?.status === "failed"
        ? `failed (${delivery.code}: ${delivery.reason})`
        : (delivery?.status ?? "pending")
    const at = item.answer && "at" in item.answer ? item.answer.at : item.updatedAt
    const ago = Math.round((now - Date.parse(at)) / 60_000)
    console.log(
      `${itemTag(item.ref)} ${item.id} from ${item.from}: ${state}, answered ${ago}m ago, not acked · ${item.title}`,
    )
  }
} else if (command === "settle") {
  const settled = await settleItem(db, key as string, {
    label: flags?.label,
    link: flags?.link,
    note: flags?.note,
  })
  if (!settled.ok) fail(settled.code === "NOT_FOUND" ? `no inbox item ${key}` : settled.message)
  else console.log(`${settled.item.id} settled by ${settled.item.from}`)
} else if (command === "resolve") {
  const resolved = await resolveItem(db, key as string, { by: flags?.by ?? "", note: flags?.note })
  if (!resolved.ok) fail(resolved.code === "NOT_FOUND" ? `no inbox item ${key}` : resolved.message)
  else console.log(`${resolved.item.id} resolved by ${resolved.item.from}`)
} else {
  const acked = await ackItem(db, key as string, {
    label: flags?.label,
    link: flags?.link,
    noLink: flags?.["no-link"],
  })
  if (!acked.ok) fail(acked.code === "NOT_FOUND" ? `no inbox item ${key}` : acked.message)
  else {
    // The same line for a repeated ack with the same flags, since it states what is recorded rather than what this call did.
    const { delivery, from, id } = acked.item
    if (delivery?.status === "delivered") {
      console.log(
        delivery.via === "cli"
          ? `${id} read by ${from} at ${delivery.at}`
          : `${id} delivered to ${delivery.to ?? from}'s session at ${delivery.at}`,
      )
    }
  }
}
process.exit(0)
