import { basename } from "node:path"

import { MIN_LIST_BYTES, type Machine, SHARD, type Unused } from "./unused"

// The factory's list of each machine's unused space: nightly-clean saves a new one each night and sends it to Ops as one outbox line, never to the owner's Inbox; Ops or a dispatcher approves an item with `playground rm --approve`, which appends one line to the approvals file, and the next night removes each approved Remove by its own handle; `playground rm --card` reads the same list and lines to check its approval itself.
// Trust: a line counts whatever its `by` says, since `rm --approve` checks the seat when it writes and no-roster-write refuses every other write to the approvals file, so that command stays its one writer.

// The Planner's trial record: a model test's replay worktrees and logs stay off the list, listed only.
export const KIT_RECORD = ["models/kit/logs", "models/kit/runs"]
// The most items one list holds; the rest wait for the next night's list.
export const CARD_MAX = 20
// The approvals file `playground rm --approve` appends to, in the ops folder's tick/: the store each approval is read from and the log of who approved it.
export const APPROVALS = "unused-approvals.jsonl"

export type CardItem = {
  bytes: number
  id?: string
  kind: Unused["kind"]
  machine: string
  path: string
  recorded?: true
  shards?: string[]
}
// One approved item, as the list names it.
export type CardPick = { bytes: number; machine: string; path: string }
// The list nightly-clean keeps in its state file under `card`: its id, which `playground rm --card` names, the time it was written, and the items it lists.
export type CardState = { at?: string; id: string; items: CardItem[] }
// Each item kept, by `<machine> <path>`, at the bytes it was kept at: it stays off later lists until its size changes.
export type Kept = Record<string, number>
// One line of the approvals file: who approved, when, the list's id, and the item as the list names it, at its bytes.
export type Approval = CardPick & {
  at: string
  by: string
  choice: "keep" | "remove"
  list: string
}

const GB = 1024 ** 3
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)

// A sharded set's note, read through SHARD: a whole set reads "all N of N shards", and a set missing a shard names each shard that is present.
const shardedNote = (shards: string[]): string => {
  const [, stem, , total] = SHARD.exec(basename(shards[0]!))!
  const present = shards.map((p) => Number(SHARD.exec(basename(p))![2]))
  const complete = present.length === Number(total) && present.every((n, i) => n === i + 1)
  return complete
    ? `, ${stem}, all ${present.length} of ${Number(total)} shards`
    : `, ${stem}, with only shards ${present.join(", ")} of ${Number(total)} here`
}

// Pure: one item's words on the list's line: where it is, its exact size, and what its Remove does.
const itemLine = (item: CardItem): string =>
  `${item.machine} ${item.path}, ${item.bytes} bytes (${(item.bytes / GB).toFixed(1)} GB), ${
    item.kind === "weights"
      ? "weights, deleted outright"
      : item.kind === "image"
        ? "image, docker image rm"
        : `${item.kind}, to the trash`
  }${item.recorded && item.kind !== "image" ? ", its machine record entry goes too" : ""}${
    item.shards ? shardedNote(item.shards) : ""
  }`

// Pure: the outbox line that hands Ops one night's list, each item numbered, with the command that approves one.
export const listLine = (list: CardState): string =>
  `nightly-clean unused list ${list.id}, ${list.items.length} item${list.items.length === 1 ? "" : "s"}: ${list.items
    .map((item, i) => `${i + 1}. ${itemLine(item)}`)
    .join(
      "; ",
    )}. Approve one before the next night with playground rm --approve ${list.id} <path> [--peer <machine>] [--keep]; an item no line approves comes back on the next list.`

const keyOf = (item: { machine: string; path: string }) => `${item.machine} ${item.path}`

// Pure: every item the list may name tonight, the largest first: each machine's items at MIN_LIST_BYTES or over, a recorded one marked, since the record guards it from every removal but an approved one, but the trial record's, each rehearsal whose tag is not out yet (out reads it), and each kept at the same size.
export const offered = (
  found: Machine[],
  home: string,
  out: (rehearsal: string) => boolean,
  kept: Kept,
): CardItem[] =>
  found
    .flatMap((m) =>
      "why" in m
        ? []
        : m.items
            .filter((i) => i.bytes >= MIN_LIST_BYTES)
            .filter((i) => !KIT_RECORD.some((rel) => inside(i.path, `${home}/${rel}`)))
            .filter((i) => i.kind !== "rehearsal" || out(i.path))
            .filter((i) => kept[keyOf({ machine: m.machine, path: i.path })] !== i.bytes)
            .map(({ bytes, id, kind, path, recorded, shards }) => ({
              bytes,
              ...(id ? { id } : {}),
              kind,
              machine: m.machine,
              path,
              ...(recorded ? { recorded: true as const } : {}),
              ...(shards ? { shards } : {}),
            })),
    )
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))

// Pure: kept as it stands after tonight: each key still listed tonight at its kept size, and each of a machine not read; an item gone or at a new size drops out, so it comes back on a list.
export const keptAfter = (found: Machine[], kept: Kept): Kept => {
  const next: Kept = {}
  for (const m of found)
    for (const [key, bytes] of Object.entries(kept))
      if (
        key.startsWith(`${m.machine} `) &&
        ("why" in m ||
          m.items.some(
            (i) => keyOf({ machine: m.machine, path: i.path }) === key && i.bytes === bytes,
          ))
      )
        next[key] = bytes
  return next
}

// Pure: each line of the approvals file that reads as an approval; any other line is read past.
export const approvalsOf = (text: string): Approval[] =>
  text.split("\n").flatMap((line) => {
    try {
      const a = JSON.parse(line) as Partial<Approval>
      return typeof a.at === "string" &&
        typeof a.by === "string" &&
        typeof a.bytes === "number" &&
        (a.choice === "keep" || a.choice === "remove") &&
        typeof a.list === "string" &&
        typeof a.machine === "string" &&
        typeof a.path === "string"
        ? [a as Approval]
        : []
    } catch {
      return []
    }
  })

// Pure: list id's approved items, each the saved list's own item, counted only from a line naming that list, written at or after the list's write time, for an item on it at its bytes, the last such line for an item its choice; else why none counts, so a line for another night's list, an older line or another size approves nothing.
export const approvalPicks = (
  lines: Approval[],
  saved: CardState | undefined,
  id: string,
): { keep: CardItem[]; remove: CardItem[] } | string => {
  if (saved?.id !== id) return `list ${id} is not the list nightly-clean saved`
  if (!saved.at) return `list ${id} has no write time to check its approvals against`
  const choice = new Map<string, Approval["choice"]>()
  for (const line of lines)
    if (
      line.list === id &&
      line.at >= saved.at &&
      saved.items.some((i) => keyOf(i) === keyOf(line) && i.bytes === line.bytes)
    )
      choice.set(keyOf(line), line.choice)
  const of = (want: Approval["choice"]) => saved.items.filter((i) => choice.get(keyOf(i)) === want)
  return { keep: of("keep"), remove: of("remove") }
}

// Pure: the saved list id names in nightly-clean's state, tonight's `card` or `sent`, the last list's items sent to Ops for a peer, or none.
export const listOf = (saved: { card?: CardState; sent?: CardState }, id: string) =>
  saved.card?.id === id ? saved.card : saved.sent?.id === id ? saved.sent : undefined

// Pure: the command each peer runs for one approved item, since approved weights reach a peer only as a narrow `playground rm --peer` that re-checks there before deleteWeights, while an image is `docker image rm` and a replay a `playground rm` with a reason.
export const peerCommand = (item: CardItem, card: string): string =>
  item.kind === "image"
    ? `docker image rm ${item.id ?? item.path.replace(/^docker image /, "")}`
    : item.kind === "weights"
      ? `playground rm --card ${card} --peer ${item.machine} '${item.path.replaceAll("'", `'\\''`)}'`
      : `playground rm ${item.path} --reason "nightly-clean card ${card}"`

// An id as crypto.randomUUID writes it, the one form a list id takes.
export const CARD_ID = /^[0-9a-f-]{36}$/

// What the list's night reads and runs: approvals the approvals file's lines, here this machine's name, id a new list's id, now the time it is written, out whether a rehearsal's tag is out, and remove takes one of this machine's approved items away (docker image rm by its id, else playground rm --card).
export type CardDeps = {
  approvals: () => Promise<Approval[]>
  here: string
  id: () => string
  now: () => string
  out: (rehearsal: string) => boolean
  remove: (item: CardItem, card: string) => Promise<{ code: number; out: string }>
}

const lastLine = (out: string) => out.trim().split("\n").at(-1) ?? ""

// One night of the list: the saved list's approved Removes still listed tonight at the same size are removed here (deps.remove) or sent to Ops for a peer, each approved Keep held at its size, and every item no line approves comes back on tonight's list; then a new list of what is left is saved and sent to Ops as one line, and no Inbox item is posted. Returns the list and kept to save, the saved list's items sent to Ops as `sent` (its id and write time kept, so a peer's `playground rm --card <id> --peer` line still reads after the new list replaces it), the log's words, and each line for Ops.
export async function cardNight(
  found: Machine[],
  home: string,
  saved: { card?: CardState; kept?: Kept },
  deps: CardDeps,
): Promise<{ card?: CardState; kept: Kept; ops: string[]; said: string; sent?: CardState }> {
  const kept = keptAfter(found, saved.kept ?? {})
  const ops: string[] = []
  const said: string[] = []
  const done = new Set<string>()
  const list = saved.card
  let sent: CardState | undefined
  if (list) {
    const counted = approvalPicks(await deps.approvals(), list, list.id)
    const { keep, remove } = typeof counted === "string" ? { keep: [], remove: [] } : counted
    if (typeof counted === "string") said.push(counted)
    for (const item of keep) {
      kept[keyOf(item)] = item.bytes
      done.add(keyOf(item))
    }
    const listed = new Map(
      found.flatMap((m) =>
        "why" in m
          ? []
          : m.items.map((i) => [keyOf({ machine: m.machine, path: i.path }), i.bytes] as const),
      ),
    )
    let removed = 0
    const toOps: CardItem[] = []
    for (const asked of remove) {
      done.add(keyOf(asked))
      if (listed.get(keyOf(asked)) !== asked.bytes) {
        said.push(`left ${asked.path} on ${asked.machine}: no longer listed at the list's size`)
        continue
      }
      if (asked.machine !== deps.here) {
        ops.push(`list ${list.id} approved on ${asked.machine}: ${peerCommand(asked, list.id)}`)
        toOps.push(asked)
        continue
      }
      const ran = await deps.remove(asked, list.id)
      if (ran.code === 0) removed++
      said.push(
        ran.code === 0
          ? `removed ${asked.path}: ${lastLine(ran.out)}`
          : `kept ${asked.path}: ${lastLine(ran.out)}`,
      )
    }
    said.unshift(`list ${list.id}: removed ${removed}, ${toOps.length} to Ops, ${keep.length} kept`)
    if (toOps.length) sent = { ...(list.at ? { at: list.at } : {}), id: list.id, items: toOps }
  }
  const tonight = offered(found, home, deps.out, kept)
    .filter((i) => !done.has(keyOf(i)))
    .slice(0, CARD_MAX)
  if (!tonight.length) return { kept, ops, said: said.join("; "), ...(sent && { sent }) }
  const next = { at: deps.now(), id: deps.id(), items: tonight }
  ops.push(listLine(next))
  said.push(`list ${next.id} sent to Ops, ${tonight.length} items`)
  return { card: next, kept, ops, said: said.join("; "), ...(sent && { sent }) }
}
