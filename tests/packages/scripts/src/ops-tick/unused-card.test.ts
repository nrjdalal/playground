import { expect, test } from "bun:test"

import type { Machine, Unused } from "../../../../../packages/scripts/src/ops-tick/unused"
import {
  type Approval,
  approvalPicks,
  approvalsOf,
  CARD_MAX,
  type CardDeps,
  type CardItem,
  cardNight,
  keptAfter,
  listLine,
  offered,
  peerCommand,
} from "../../../../../packages/scripts/src/ops-tick/unused-card"

const MB = 1024 ** 2
const GB = 1024 ** 3
const HOME = "/home/me"
const ID = "11111111-2222-3333-4444-555555555555"
const NEXT = "66666666-7777-8888-9999-000000000000"
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
// When nightly-clean wrote the saved list, an approval after it, and the next night's write.
const WROTE = "2026-11-17T03:00:00.000Z"
const LATER = "2026-11-17T09:00:00.000Z"
const NEWER = "2026-11-18T03:00:00.000Z"

const weights: Unused = {
  bytes: 2 * GB,
  kind: "weights",
  path: `${HOME}/models/hf/hub/models--nvidia--Qwen-27B`,
  recorded: false,
}
const image: Unused = {
  bytes: 300 * MB,
  id: "sha256:aaa",
  kind: "image",
  path: "docker image old:1",
  recorded: false,
}
const rehearsal: Unused = {
  bytes: Math.round(1.7 * GB),
  kind: "rehearsal",
  path: `${HOME}/.playground/scratchpad/ops/rehearse142`,
  recorded: true,
}
const running: Unused = { ...rehearsal, path: `${HOME}/.playground/scratchpad/ops/rehearse149` }
const run: Unused = {
  bytes: GB,
  kind: "run",
  path: `${HOME}/models/kit/runs/MB-old/pr0001`,
  recorded: false,
}
const small: Unused = { ...image, bytes: 50 * MB, id: "sha256:bbb", path: "docker image tiny:1" }
const peerImage: Unused = { ...image, id: "sha256:ccc", path: "docker image peer:1" }

const here = (...items: Unused[]): Machine => ({ items, machine: "here" })
const out = (path: string) => path.endsWith("rehearse142")

test("the card offers each item but the trial record's, a rehearsal whose tag is not out, a small one and one kept at its size; a recorded one is marked", () => {
  const found = [
    here(weights, image, rehearsal, running, run, small),
    { items: [peerImage], machine: "peer" },
  ]
  expect(
    offered(found, HOME, out, { "here docker image old:1": 300 * MB }).map((i) => i.path),
  ).toEqual([weights.path, rehearsal.path, peerImage.path])
  expect(offered(found, HOME, out, {}).find((i) => i.path === rehearsal.path)?.recorded).toBe(true)
  expect(
    offered(found, HOME, out, { "here docker image old:1": 299 * MB }).map((i) => i.path),
  ).toContain(image.path)
})

test("a night with unused items posts no Inbox item: no ask new, its list saved for the factory (#3157)", async () => {
  const asked: string[][] = []
  const deps = {
    approvals: async () => [],
    ask: async (args: string[]) => (asked.push(args), { code: 0, out: `${ID}\n` }),
    from: "ops",
    here: "here",
    id: () => ID,
    now: () => WROTE,
    out,
    remove: async () => ({ code: 0, out: "" }),
  } as unknown as CardDeps
  const night = await cardNight([here(weights, image)], HOME, {}, deps)
  expect(asked.filter((args) => args[0] === "new")).toEqual([])
  expect(night.card?.items.map((i) => i.path)).toEqual([weights.path, image.path])
})

test("the list's line numbers each item with its size and what its Remove does, a recorded one naming its entry, and the command that approves one", () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const line = listLine({ at: WROTE, id: ID, items })
  expect(line).toStartWith(`nightly-clean unused list ${ID}, 2 items: 1. here ${weights.path}, `)
  expect(line).toContain(`${2 * GB} bytes (2.0 GB), weights, deleted outright`)
  expect(line).toContain(
    `2. here ${image.path}, ${image.bytes} bytes (0.3 GB), image, docker image rm`,
  )
  expect(line).toContain(
    `playground rm --approve ${ID} <path> [--peer <machine>] [--keep]; an item no line approves comes back on the next list.`,
  )
  const recorded = (kind: CardItem["kind"]) =>
    listLine({ at: WROTE, id: ID, items: [{ ...items[1]!, kind, recorded: true }] })
  expect(recorded("rehearsal")).toContain("its machine record entry goes too")
  expect(recorded("image")).not.toContain("its machine record entry goes too")
  expect(listLine({ at: WROTE, id: ID, items: items.slice(0, 1) })).toContain("1 item: ")
})

const approval = (item: CardItem, over: Partial<Approval> = {}): Approval => ({
  at: LATER,
  by: "ops",
  bytes: item.bytes,
  choice: "remove",
  list: ID,
  machine: item.machine,
  path: item.path,
  ...over,
})

test("the approvals file reads each well-formed line and reads past every other", () => {
  const items = offered([here(weights)], HOME, out, {})
  const line = approval(items[0]!)
  expect(
    approvalsOf(
      [JSON.stringify(line), "not json", JSON.stringify({ ...line, choice: "maybe" }), ""].join(
        "\n",
      ),
    ),
  ).toEqual([line])
})

test("an approval counts only on the list nightly-clean saved, written at or after its write, for an item on it at its size, the last line for an item its choice", () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const saved = { at: WROTE, id: ID, items }
  const [w, i] = items as [CardItem, CardItem]
  expect(approvalPicks([approval(w), approval(i, { choice: "keep" })], saved, ID)).toEqual({
    keep: [i],
    remove: [w],
  })
  expect(approvalPicks([approval(w), approval(w, { choice: "keep" })], saved, ID)).toEqual({
    keep: [w],
    remove: [],
  })
  const none = { keep: [], remove: [] }
  expect(approvalPicks([approval(w, { at: "2026-11-17T02:00:00.000Z" })], saved, ID)).toEqual(none)
  expect(approvalPicks([approval(w, { bytes: w.bytes + 1 })], saved, ID)).toEqual(none)
  expect(approvalPicks([approval(w, { list: OTHER })], saved, ID)).toEqual(none)
  expect(approvalPicks([approval(w, { machine: "peer" })], saved, ID)).toEqual(none)
  expect(approvalPicks([approval(w)], { ...saved, id: OTHER }, ID)).toBe(
    `list ${ID} is not the list nightly-clean saved`,
  )
  expect(approvalPicks([approval(w)], { id: ID, items }, ID)).toBe(
    `list ${ID} has no write time to check its approvals against`,
  )
  expect(approvalPicks([approval(w)], undefined, ID)).toBeString()
})

test("a peer's image runs `docker image rm`, a rehearsal a `playground rm` with a reason, and weights a `playground rm` naming the peer's list", () => {
  const item = ({ recorded: _, ...u }: Unused): CardItem => ({ ...u, machine: "peer" })
  expect(peerCommand(item(peerImage), ID)).toBe("docker image rm sha256:ccc")
  expect(peerCommand(item(rehearsal), ID)).toBe(
    `playground rm ${rehearsal.path} --reason "nightly-clean card ${ID}"`,
  )
  expect(peerCommand(item(weights), ID)).toBe(
    `playground rm --card ${ID} --peer peer '${weights.path.replaceAll("'", `'\\''`)}'`,
  )
  const spaced = { ...weights, path: `${HOME}/models/a b/gguf` }
  expect(peerCommand(item(spaced), ID)).toBe(
    `playground rm --card ${ID} --peer peer '/home/me/models/a b/gguf'`,
  )
  const quoted = { ...weights, path: `${HOME}/models/it's/gguf` }
  expect(peerCommand(item(quoted), ID)).toBe(
    `playground rm --card ${ID} --peer peer '/home/me/models/it'\\''s/gguf'`,
  )
})

// The night's deps: the approvals file's lines as given, each new list's id NEXT and write time LATER, and each removal kept.
const factory = (lines: Approval[] = []) => {
  const removed: string[] = []
  const deps: CardDeps = {
    approvals: async () => lines,
    here: "here",
    id: () => NEXT,
    now: () => NEWER,
    out,
    remove: async (item) => {
      removed.push(item.path)
      return { code: 0, out: "Moved to the trash as 20261118T030000Z-shell/1 (2 files)" }
    },
  }
  return { deps, removed }
}

test("a night with no list saves one and sends it to Ops as one line", async () => {
  const { deps } = factory()
  const night = await cardNight([here(weights, image)], HOME, {}, deps)
  const items = offered([here(weights, image)], HOME, out, {})
  expect(night.card).toEqual({ at: NEWER, id: NEXT, items })
  expect(night.ops).toEqual([listLine({ at: NEWER, id: NEXT, items })])
  expect(night.said).toBe(`list ${NEXT} sent to Ops, 2 items`)
})

test("a list nothing approves comes back whole on the next night's list, under a new id", async () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const { deps, removed } = factory()
  const night = await cardNight(
    [here(weights, image)],
    HOME,
    { card: { at: WROTE, id: ID, items } },
    deps,
  )
  expect(removed).toEqual([])
  expect(night.card).toEqual({ at: NEWER, id: NEXT, items })
  expect(night.kept).toEqual({})
})

test("an approved list removes each Remove still listed at its size here, sends a peer's to Ops, leaves one whose size changed, and keeps each Keep", async () => {
  const items = offered(
    [here(weights, image, rehearsal), { items: [peerImage], machine: "peer" }],
    HOME,
    out,
    {},
  )
  expect(items.map((i) => i.path)).toEqual([
    weights.path,
    rehearsal.path,
    image.path,
    peerImage.path,
  ])
  const [w, r, i, p] = items as [CardItem, CardItem, CardItem, CardItem]
  const { deps, removed } = factory([
    approval(w),
    approval(r),
    approval(i, { choice: "keep" }),
    approval(p),
  ])
  const tonight = [
    here(weights, image, { ...rehearsal, bytes: rehearsal.bytes + 1 }),
    { items: [peerImage], machine: "peer" },
  ]
  const night = await cardNight(tonight, HOME, { card: { at: WROTE, id: ID, items } }, deps)
  expect(removed).toEqual([weights.path])
  expect(night.ops).toEqual([`list ${ID} approved on peer: docker image rm sha256:ccc`])
  expect(night.said).toStartWith(`list ${ID}: removed 1, 1 to Ops, 1 kept`)
  expect(night.said).toContain(
    `left ${rehearsal.path} on here: no longer listed at the list's size`,
  )
  expect(night.kept).toEqual({ "here docker image old:1": image.bytes })
  expect(night.card).toBeUndefined()
})

test("an approval written before the list's write time removes nothing and keeps nothing", async () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const early = "2026-11-17T02:00:00.000Z"
  const { deps, removed } = factory(
    items.map((item, n) => approval(item, { at: early, choice: n ? "keep" : "remove" })),
  )
  const night = await cardNight(
    [here(weights, image)],
    HOME,
    { card: { at: WROTE, id: ID, items } },
    deps,
  )
  expect(removed).toEqual([])
  expect(night.kept).toEqual({})
  expect(night.card?.items).toEqual(items)
})

test("a second approval line for an item already removed does nothing on a later night", async () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const lines = [approval(items[0]!)]
  const first = factory(lines)
  const night = await cardNight(
    [here(weights, image)],
    HOME,
    { card: { at: WROTE, id: ID, items } },
    first.deps,
  )
  expect(first.removed).toEqual([weights.path])
  lines.push(approval(items[0]!, { at: NEWER }))
  const second = factory(lines)
  const next = await cardNight([here(weights, image)], HOME, { card: night.card }, second.deps)
  expect(second.removed).toEqual([])
  expect(next.said).toStartWith(`list ${NEXT}: removed 0, 0 to Ops, 0 kept`)
})

test("a kept item stays off the next list, and comes back on one once its size changes", async () => {
  const items = offered([here(image)], HOME, out, {})
  const { deps } = factory([approval(items[0]!, { choice: "keep" })])
  const night = await cardNight([here(image)], HOME, { card: { at: WROTE, id: ID, items } }, deps)
  expect(night.kept).toEqual({ "here docker image old:1": image.bytes })
  expect(night.card).toBeUndefined()
  const fresh = factory()
  const same = await cardNight([here(image)], HOME, { kept: night.kept }, fresh.deps)
  expect(same.card).toBeUndefined()
  expect(same.ops).toEqual([])
  const grown = await cardNight(
    [here({ ...image, bytes: image.bytes + MB })],
    HOME,
    { kept: night.kept },
    fresh.deps,
  )
  expect(grown.card?.items.map((i) => i.bytes)).toEqual([image.bytes + MB])
  expect(grown.kept).toEqual({})
})

test("kept stays for a machine not read, and drops an item gone from tonight's list", () => {
  const kept = { "here docker image gone:1": MB, "peer docker image x:1": MB }
  expect(keptAfter([here(image), { machine: "peer", why: "exit 255" }], kept)).toEqual({
    "peer docker image x:1": MB,
  })
})

test("a list holds CARD_MAX items at most, the largest first", async () => {
  const many = Array.from({ length: CARD_MAX + 3 }, (_, i) => ({
    ...image,
    bytes: (200 + i) * MB,
    path: `docker image i${i}:1`,
  }))
  const night = await cardNight([here(...many)], HOME, {}, factory().deps)
  expect(night.card?.items).toHaveLength(CARD_MAX)
  expect(night.card?.items[0]!.bytes).toBe((200 + CARD_MAX + 2) * MB)
})

test("a sharded set is one item, listed once at its total, its line naming the model stem and the shard count", () => {
  const stem = "models--nvidia--Qwen"
  const shards = ["00001", "00002", "00003", "00004"].map(
    (n) => `${HOME}/models/loose/${stem}-${n}-of-00004.gguf`,
  )
  const bytes = 13 * GB
  const item: CardItem = { bytes, kind: "weights", machine: "here", path: shards[0]!, shards }
  const line = listLine({ at: WROTE, id: ID, items: [item] })
  expect(line).toContain(`1. here ${shards[0]!}, ${bytes} bytes (${(bytes / GB).toFixed(1)} GB)`)
  expect(line).toContain(`${stem}, all 4 of 4 shards`)
})

test("a sharded set missing a shard is still one item, its line naming the shards that are there and the set's total", () => {
  const stem = "models--nvidia--Qwen"
  const shards = ["00002"].map((n) => `${HOME}/models/loose/${stem}-${n}-of-00004.gguf`)
  const item: CardItem = {
    bytes: 13 * GB,
    kind: "weights",
    machine: "here",
    path: shards[0]!,
    shards,
  }
  const line = listLine({ at: WROTE, id: ID, items: [item] })
  expect(line).toContain(stem)
  expect(line).toContain("with only shards 2 of 4 here")
})
