import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  hashOf,
  lineOf,
  type Slack,
  watch,
} from "../../../../../packages/scripts/src/ops-channel-watch/watch"

const CHANNEL = "C0FIXTURE"
const SKIP = "U0FIXTURE"
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "channel-watch-"))
  dirs.push(dir)
  return dir
}

// The old runner's pipeline, in the locale its shell ran with.
const pipeline = async (written: string) => {
  const proc = Bun.spawn(
    ["bash", "-c", "tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]' | shasum | cut -c1-10"],
    { env: { ...process.env, LC_ALL: "en_US.UTF-8" }, stdin: new Blob([written]), stdout: "pipe" },
  )
  return (await new Response(proc.stdout).text()).trim()
}

describe("hashOf", () => {
  test("matches the old runner's tr, shasum pipeline on the text it wrote", async () => {
    const cases: [raw: string, written: string][] = [
      ["See <https://x.io/a?b=1|the PR> now!", "See https://x.io/a?b=1 now!"],
      ["Café \u2014 Über 2x,\n\n  done.", "Café \u2014 Über 2x,\n\n  done."],
      ["Reply: ok <@U123> &amp; <#C9|ops>", "Reply: ok <@U123> &amp; <#C9|ops>"],
    ]
    for (const [raw, written] of cases) expect(await hashOf(raw)).toBe(await pipeline(written))
    expect(await hashOf("Hello, World!")).toBe("6adfb183a4")
  })
})

describe("lineOf", () => {
  test("names a Playground post by its prefix or its signature, and joins its lines", () => {
    const at = { name: "merritt", thread: "1.0" }
    expect(lineOf({ ...at, text: "Question: why\nnow" })).toBe(
      "1.0 · merritt · Playground · Question: why now",
    )
    expect(lineOf({ ...at, text: "done\n_Sent via Playground_" })).toBe(
      "1.0 · merritt · Playground · done _Sent via Playground_",
    )
    expect(lineOf({ ...at, text: "done\nSent via Playground" })).toBe(
      "1.0 · merritt · Playground · done Sent via Playground",
    )
    expect(lineOf({ ...at, text: "a question: here" })).toBe(
      "1.0 · merritt · person · a question: here",
    )
  })
})

type Post = { permalink?: string; text: string; ts: string; user: string; username?: string }

const fakeSlack =
  (history: Post[], matches: Post[], calls: string[] = []): Slack =>
  async (method, params) => {
    calls.push(`${method} ${JSON.stringify(params)}`)
    if (method === "conversations.history")
      return { messages: history.filter((m) => Number(m.ts) > Number(params.oldest)), ok: true }
    if (method === "search.messages") return { messages: { matches }, ok: true }
    if (method === "users.info") return { ok: true, user: { name: `name-${params.user}` } }
    return { error: "unknown_method", ok: false }
  }

const NOW = 1_800_000_000

describe("watch quick", () => {
  test("relays each new post oldest first once, skips the skipped user and the relayed, and moves seen", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "channel-seen.txt"), `${NOW - 100}.000100\n`)
    writeFileSync(join(dir, "channel-relayed.txt"), `${NOW - 50}.000001\n`)
    const sent: string[] = []
    const calls: string[] = []
    const slack = fakeSlack(
      [
        { text: "old", ts: `${NOW - 400}.000001`, user: "U1" },
        { text: "Idea: top", ts: `${NOW - 20}.000001`, user: "U2" },
        { text: "mine", ts: `${NOW - 10}.000001`, user: SKIP },
      ],
      [
        { text: "relayed", ts: `${NOW - 50}.000001`, user: "U1", username: "ann" },
        {
          permalink: `https://x.slack.com/archives/C/p1?thread_ts=${NOW - 90}.000001&cid=C`,
          text: "a\nreply",
          ts: `${NOW - 30}.000001`,
          user: "U1",
          username: "ann",
        },
      ],
      calls,
    )
    await watch("quick", {
      channel: CHANNEL,
      dir,
      now: NOW,
      send: async (t) => void sent.push(t),
      skip: SKIP,
      slack,
    })
    expect(sent).toEqual([
      `${NOW - 90}.000001 · ann · person · a reply`,
      `${NOW - 20}.000001 · name-U2 · Playground · Idea: top`,
    ])
    expect(readFileSync(join(dir, "channel-relayed.txt"), "utf8")).toBe(
      `${NOW - 50}.000001\n${NOW - 30}.000001\n${NOW - 20}.000001\n`,
    )
    expect(readFileSync(join(dir, "channel-seen.txt"), "utf8").trim()).toBe(`${NOW - 10}.000001`)
    expect(calls.some((c) => c.startsWith("search.messages") && c.includes('"count":"20"'))).toBe(
      true,
    )
  })

  test("a failed send keeps that post unrelayed and seen where it was", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "channel-seen.txt"), `${NOW - 100}.000100\n`)
    const slack = fakeSlack([{ text: "hi", ts: `${NOW - 20}.000001`, user: "U2" }], [])
    const send = async () => {
      throw new Error("notify.sh to dispatcher: down")
    }
    await expect(
      watch("quick", { channel: CHANNEL, dir, now: NOW, send, skip: SKIP, slack }),
    ).rejects.toThrow("notify.sh")
    expect(readFileSync(join(dir, "channel-relayed.txt"), "utf8")).toBe("")
    expect(readFileSync(join(dir, "channel-seen.txt"), "utf8").trim()).toBe(`${NOW - 100}.000100`)
  })

  test("a failed read throws its method and Slack's error, and moves nothing", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "channel-seen.txt"), `${NOW - 100}.000100\n`)
    const slack: Slack = async () => ({ error: "invalid_auth", ok: false })
    await expect(
      watch("quick", { channel: CHANNEL, dir, now: NOW, send: async () => {}, skip: SKIP, slack }),
    ).rejects.toThrow("conversations.history: invalid_auth")
    expect(readFileSync(join(dir, "channel-seen.txt"), "utf8").trim()).toBe(`${NOW - 100}.000100`)
  })
})

describe("watch full", () => {
  test("relays new posts with their hash, checks edits inside 2 hours and prunes past 3 days", async () => {
    const dir = scratch()
    const ts = (ago: number) => `${NOW - ago}.000001`
    writeFileSync(join(dir, "channel-seen.txt"), `${ts(5000)}\n`)
    writeFileSync(
      join(dir, "channel-relayed.txt"),
      [
        `${ts(4 * 86400)} aaaaaaaaaa`,
        `${ts(3 * 86400 - 60)} bbbbbbbbbb`,
        `${ts(9000)} cccccccccc`,
        ts(3000),
        `${ts(2000)} ${await hashOf("same, text")}`,
        `${ts(1000)} dddddddddd`,
        "",
      ].join("\n"),
    )
    const sent: string[] = []
    const slack = fakeSlack(
      [{ text: "brand new", ts: ts(500), user: "U3" }],
      [
        { text: "older edit", ts: ts(9000), user: "U1", username: "ann" },
        { text: "no hash yet", ts: ts(3000), user: "U1", username: "ann" },
        { text: "Same text", ts: ts(2000), user: "U1", username: "ann" },
        { text: "changed\nnow", ts: ts(1000), user: "U1", username: "ann" },
        { text: "mine", ts: ts(400), user: SKIP, username: "skipped" },
      ],
    )
    await watch("full", {
      channel: CHANNEL,
      dir,
      now: NOW,
      send: async (t) => void sent.push(t),
      skip: SKIP,
      slack,
    })
    expect(sent).toEqual([
      `${ts(500)} · name-U3 · person · brand new`,
      `Edited: ${ts(1000)} · ann · changed now`,
    ])
    expect(readFileSync(join(dir, "channel-relayed.txt"), "utf8")).toBe(
      [
        `${ts(3 * 86400 - 60)} bbbbbbbbbb`,
        `${ts(9000)} cccccccccc`,
        `${ts(3000)} ${await hashOf("no hash yet")}`,
        `${ts(2000)} ${await hashOf("same, text")}`,
        `${ts(1000)} ${await hashOf("changed\nnow")}`,
        `${ts(500)} ${await hashOf("brand new")}`,
        "",
      ].join("\n"),
    )
    expect(readFileSync(join(dir, "channel-seen.txt"), "utf8").trim()).toBe(ts(400))
  })
})
