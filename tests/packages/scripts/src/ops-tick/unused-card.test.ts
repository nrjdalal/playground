import { expect, test } from "bun:test"

import type { Machine, Unused } from "../../../../../packages/scripts/src/ops-tick/unused"
import {
  approvedOf,
  CARD_MAX,
  type CardDeps,
  type CardItem,
  cardNight,
  cardOf,
  keptAfter,
  offered,
  peerCommand,
  questionOf,
  savedPicks,
} from "../../../../../packages/scripts/src/ops-tick/unused-card"

const MB = 1024 ** 2
const GB = 1024 ** 3
const HOME = "/home/me"
const ID = "11111111-2222-3333-4444-555555555555"

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

test("a single item's card is one yes or no with Keep; more are one question each, weights with no recommended badge and the words that they are deleted outright", () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const one = cardOf(items.slice(1))
  expect(one.preview).toMatchObject({ deny: "Keep", options: [{ label: "Remove" }], type: "ask" })
  expect((one.preview as { text: string }).text.split("\n")[0]).toBe(questionOf(items[1]!))
  const many = cardOf(items).preview as {
    questions: { options: { description?: string }[]; recommended?: number }[]
  }
  expect(many.questions.map((q) => q.recommended)).toEqual([undefined, 0])
  expect(many.questions[0]!.options[0]!.description).toBe(
    "Deleted outright, cannot be restored; it downloads again.",
  )
  expect(questionOf(items[0]!)).toBe(
    `Remove \`${weights.path}\` on here, ${2 * GB} bytes (2.0 GB)?`,
  )
})

test("an approval reads back each Remove pick from the card's own words, and none for a denied card or one another session posted", () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const many = {
    ...cardOf(items),
    answer: { choice: "approve", options: [1, 0] },
    from: "ops",
    status: "approved",
  }
  expect(approvedOf(many, "ops")).toEqual([
    { bytes: image.bytes, machine: "here", path: image.path },
  ])
  expect(approvedOf(many, "builder")).toEqual([])
  const one = {
    ...cardOf(items.slice(0, 1)),
    answer: { choice: "approve" },
    from: "ops",
    status: "approved",
  }
  expect(approvedOf(one, "ops")).toEqual([
    { bytes: weights.bytes, machine: "here", path: weights.path },
  ])
  expect(approvedOf({ ...one, answer: { choice: "deny" }, status: "denied" }, "ops")).toEqual([])
})

test("an edit of the card's words after the owner's answer approves nothing the saved card did not ask", () => {
  const items = offered([here(weights, image)], HOME, out, {})
  const answered = {
    ...cardOf(items),
    answer: { choice: "approve", options: [0, 0] },
    from: "ops",
    status: "approved",
  }
  const saved = { id: ID, items }
  expect(savedPicks(approvedOf(answered, "ops"), saved, ID)).toHaveLength(2)
  const other = { ...weights, bytes: 9 * GB, path: `${HOME}/models/hf/hub/models--other--Model` }
  const edited = {
    ...cardOf(offered([here(other, image)], HOME, out, {})),
    answer: answered.answer,
    from: "ops",
    status: "approved",
  }
  expect(approvedOf(edited, "ops").map((p) => p.path)).toContain(other.path)
  expect(savedPicks(approvedOf(edited, "ops"), saved, ID).map((p) => p.path)).toEqual([image.path])
  expect(savedPicks(approvedOf(answered, "ops"), { ...saved, id: "another" }, ID)).toEqual([])
  expect(savedPicks(approvedOf(answered, "ops"), undefined, ID)).toEqual([])
})

test("a peer's approved item is a command Ops runs by hand, naming the card", () => {
  const item = ({ recorded: _, ...u }: Unused): CardItem => ({ ...u, machine: "peer" })
  expect(peerCommand(item(peerImage), ID)).toBe("docker image rm sha256:ccc")
  expect(peerCommand(item(rehearsal), ID)).toBe(
    `playground rm ${rehearsal.path} --reason "nightly-clean card ${ID}"`,
  )
  expect(peerCommand(item(weights), ID)).toContain(
    `delete ${weights.path} (${weights.bytes} bytes) by hand`,
  )
})

// A fake Inbox holding one card: each ask call kept, get answering with the card as it stands.
const inbox = (answer?: { answer: { choice: string; options?: number[] }; status: string }) => {
  const calls: { args: string[]; stdin?: string }[] = []
  const removed: string[] = []
  let posted: Record<string, unknown> | undefined
  const deps: CardDeps = {
    ask: async (args, stdin) => {
      calls.push({ args, ...(stdin ? { stdin } : {}) })
      if (args[0] === "new") {
        posted = JSON.parse(stdin!)
        return { code: 0, out: `${ID}\n` }
      }
      if (args[0] === "edit") posted = JSON.parse(stdin!)
      if (args[0] === "get" && args.length === 2)
        return posted
          ? { code: 0, out: JSON.stringify({ ...posted, ...(answer ?? { status: "open" }) }) }
          : { code: 1, out: `ask: no inbox item ${args[1]}` }
      return { code: 0, out: "" }
    },
    from: "ops",
    here: "here",
    out,
    remove: async (item) => {
      removed.push(item.path)
      return { code: 0, out: "Moved to the trash as 20261118T030000Z-shell/1 (2 files)" }
    },
  }
  return { calls, deps, removed, setPosted: (p: Record<string, unknown>) => (posted = p) }
}

test("a night with no card posts one from the ops manager's name and keeps its id", async () => {
  const { calls, deps } = inbox()
  const night = await cardNight([here(weights, image)], HOME, {}, deps)
  expect(night.card).toEqual({ id: ID, items: offered([here(weights, image)], HOME, out, {}) })
  expect(calls.map((c) => c.args)).toEqual([["new"]])
  expect(JSON.parse(calls[0]!.stdin!)).toMatchObject({ from: "ops", kind: "decision" })
})

test("an open card is edited in place to tonight's items, and settled once none is left", async () => {
  const { calls, deps } = inbox()
  const first = await cardNight([here(weights, image)], HOME, {}, deps)
  const second = await cardNight([here(image)], HOME, { card: first.card }, deps)
  expect(calls.map((c) => c.args[0])).toEqual(["new", "get", "edit"])
  expect(second.card).toEqual({ id: ID, items: offered([here(image)], HOME, out, {}) })
  const third = await cardNight([here()], HOME, { card: second.card }, deps)
  expect(calls.at(-1)!.args.slice(0, 2)).toEqual(["settle", ID])
  expect(third.card).toBeUndefined()
})

test("an answered card removes each Remove still listed at its size here, sends a peer's to Ops, leaves one whose size changed, keeps each Keep, and closes", async () => {
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
  const { calls, deps, removed, setPosted } = inbox({
    answer: { choice: "approve", options: [0, 0, 1, 0] },
    status: "approved",
  })
  setPosted({ from: "ops", ...cardOf(items) })
  const tonight = [
    here(weights, image, { ...rehearsal, bytes: rehearsal.bytes + 1 }),
    { items: [peerImage], machine: "peer" },
  ]
  const night = await cardNight(tonight, HOME, { card: { id: ID, items } }, deps)
  expect(removed).toEqual([weights.path])
  expect(night.ops).toEqual([`card ${ID} approved on peer: docker image rm sha256:ccc`])
  expect(night.said).toContain(
    `left ${rehearsal.path} on here: no longer listed at the card's size`,
  )
  expect(night.kept).toEqual({ "here docker image old:1": image.bytes })
  expect(calls.at(-1)!.args.slice(0, 3)).toEqual(["ack", ID, "--no-link"])
  expect(night.card).toBeUndefined()
})

test("a kept item stays off the next card, and comes back on one once its size changes", async () => {
  const { deps } = inbox({ answer: { choice: "deny" }, status: "denied" })
  const items = offered([here(image)], HOME, out, {})
  const night = await cardNight(
    [here(image)],
    HOME,
    { card: { id: ID, items } },
    {
      ...deps,
      ask: async (args, stdin) => {
        if (args[0] === "get" && args.length === 2)
          return {
            code: 0,
            out: JSON.stringify({
              from: "ops",
              ...cardOf(items),
              answer: { choice: "deny" },
              status: "denied",
            }),
          }
        return deps.ask(args, stdin)
      },
    },
  )
  expect(night.kept).toEqual({ "here docker image old:1": image.bytes })
  expect(night.card).toBeUndefined()
  const fresh = inbox()
  const same = await cardNight([here(image)], HOME, { kept: night.kept }, fresh.deps)
  expect(same.card).toBeUndefined()
  expect(fresh.calls).toEqual([])
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

test("a card that does not read stays for the next night, and one the Inbox no longer holds is let go", async () => {
  const items = offered([here(image)], HOME, out, {})
  const unread = await cardNight(
    [here(image)],
    HOME,
    { card: { id: ID, items } },
    {
      ...inbox().deps,
      ask: async () => ({ code: 1, out: "ERR_POSTGRES_CONNECTION_REFUSED" }),
    },
  )
  expect(unread.card).toEqual({ id: ID, items })
  const gone = await cardNight([here()], HOME, { card: { id: ID, items } }, inbox().deps)
  expect(gone.card).toBeUndefined()
})

test("a card holds CARD_MAX questions at most, the largest first", () => {
  const many = Array.from({ length: CARD_MAX + 3 }, (_, i) => ({
    ...image,
    bytes: (200 + i) * MB,
    path: `docker image i${i}:1`,
  }))
  const items = offered([here(...many)], HOME, out, {}).slice(0, CARD_MAX)
  expect((cardOf(items).preview as { questions: unknown[] }).questions).toHaveLength(CARD_MAX)
  expect(items[0]!.bytes).toBe((200 + CARD_MAX + 2) * MB)
})
