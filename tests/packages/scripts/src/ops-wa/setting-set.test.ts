import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  keepMessage,
  keptFile,
  wordHashes,
  wordKey,
  wordKeyFile,
} from "../../../../../packages/scripts/src/ops-wa/alert-set"
import { bridge } from "../../../../../packages/scripts/src/ops-wa/bridge"
import {
  applyOwnerSetting,
  CONFIRM_MS,
  confirm,
  guarded,
  holds,
  settingSet,
} from "../../../../../packages/scripts/src/ops-wa/setting-set"
import { type Io, runStore } from "../../../../../packages/scripts/src/playground/store"
import { scopeDir } from "../../../../../packages/settings/src/rendered"
import { ALERT, fakeSocket, jid, OWNER, STRANGER } from "./fake-socket"

process.env.PLAYGROUND_LOGIN = "made-up-me"

const scratch = mkdtempSync(join(tmpdir(), "ops-wa-setting-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
let n = 0

const HOUR = 3_600_000
const START = Date.parse("2026-11-11T03:00:00Z")

// The settings CLI on a data folder of its own, as settings.test.ts runs it.
const cli = (data: string) => async (words: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { data, out: (l) => out.push(l), stdin: async () => "", write: Bun.write }
  const code = await runStore("settings", words, io, (l) => err.push(l))
  return { code, err: err.join("\n"), out: out.join("\n") }
}

// The login scope's stored values, none before its first write.
const stored = (data: string): Record<string, unknown> => {
  const path = join(scopeDir(data, "made-up-me"), "settings.json")
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
}

// A data folder and ops-wa's folder in it, the setting-set io over them, each line told to the owner, and a clock a test moves.
const owned = () => {
  const data = join(scratch, `data-${n++}`)
  const dir = join(data, "whatsapp")
  const told: string[] = []
  const logged: string[] = []
  let now = START
  const io = {
    apply: (key: string, value: string, id: string) => applyOwnerSetting(data, key, value, id),
    dir,
    log: (line: string) => void logged.push(line),
    now: () => now,
    tell: async (line: string) => void told.push(line),
  }
  return { advance: (ms: number) => (now += ms), data, dir, io, logged, run: cli(data), told }
}

describe("the kept record", () => {
  test("keeps a hash of each word of every owner text, in an owner-only file, never the text", async () => {
    const o = owned()
    expect(await keepMessage(o.dir, "own1", "Set the theme to dark, please.", START, OWNER)).toBe(
      false,
    )
    const raw = readFileSync(keptFile(o.dir), "utf8")
    expect(raw).not.toContain("dark")
    expect(raw).not.toContain("theme")
    const { kept } = JSON.parse(raw) as { kept: { id: string; words: string[] }[] }
    expect(kept[0]!.id).toBe("own1")
    expect(kept[0]!.words).toHaveLength(6)
    expect(statSync(keptFile(o.dir)).mode & 0o777).toBe(0o600)
  })

  test("a value matches the message's words in a row, past case, quotes and stops", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", 'Reply policy: "Factory status only." thanks', START, OWNER)
    const { kept } = (await Bun.file(keptFile(o.dir)).json()) as { kept: { words: string[] }[] }
    const key = (await wordKey(o.dir))!
    expect(holds(kept[0]!.words, "factory status only", key)).toBe(true)
    expect(holds(kept[0]!.words, "status", key)).toBe(true)
    expect(holds(kept[0]!.words, "factory only", key)).toBe(false)
    expect(holds(kept[0]!.words, "  ", key)).toBe(false)
  })

  test("the word hashes are keyed by ops-wa's own random key, an owner-only file, so a plain sha256 word list matches none", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "set the reply policy to factory status", START, OWNER)
    const key = await wordKey(o.dir)
    expect(key).toHaveLength(32)
    expect(statSync(wordKeyFile(o.dir)).mode & 0o777).toBe(0o600)
    const { kept } = (await Bun.file(keptFile(o.dir)).json()) as { kept: { words: string[] }[] }
    const plain = ["set", "the", "reply", "policy", "to", "factory", "status"].map((word) =>
      createHash("sha256").update(word).digest("hex").slice(0, 16),
    )
    expect(kept[0]!.words.filter((hash) => plain.includes(hash))).toEqual([])
    expect(wordHashes("factory status", key!)).not.toEqual(
      wordHashes("factory status", Buffer.alloc(32, 7)),
    )
    expect(wordHashes("factory status", key!)).toEqual(kept[0]!.words.slice(-2))
  })

  test("a missing or unreadable key applies no setting", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "point the repo at made-up-me/new", START, OWNER)
    rmSync(wordKeyFile(o.dir))
    await expect(settingSet(o.io, "own1", "factory.repo", "made-up-me/new")).rejects.toThrow(
      "no word key",
    )
    writeFileSync(wordKeyFile(o.dir), "short", { mode: 0o600 })
    await expect(settingSet(o.io, "own1", "factory.repo", "made-up-me/new")).rejects.toThrow(
      "no word key",
    )
    expect(stored(o.data)["factory.repo"]).toBeUndefined()
    expect(o.told).toEqual([])
  })
})

describe("settings set from the owner's message", () => {
  test("an owner id whose message holds the value applies it, logs the id and old value, and tells the undo", async () => {
    const o = owned()
    await o.run(["set", "factory.repo", "made-up-me/old", "--reason", "made-up start"])
    await keepMessage(o.dir, "own1", "point the repo at made-up-me/new", START, OWNER)
    const said = await settingSet(o.io, "own1", "factory.repo", "made-up-me/new")
    expect(said).toContain("set factory.repo from the owner's message own1")
    expect(stored(o.data)["factory.repo"]).toBe("made-up-me/new")
    expect(o.logged).toEqual([
      "ops-wa: factory.repo set from the owner's message own1; it was made-up-me/old",
    ])
    expect(o.told).toHaveLength(1)
    expect(o.told[0]).toContain("to undo: playground settings set factory.repo")
  })

  test("a value the message does not hold refuses, and nothing is set", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "point the repo at made-up-me/new", START, OWNER)
    await expect(settingSet(o.io, "own1", "factory.repo", "made-up-me/old")).rejects.toThrow(
      "does not hold the value",
    )
    expect(o.told).toEqual([])
  })

  test("an unknown id and one older than 24 hours refuse", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "point the repo at made-up-me/new", START, OWNER)
    await expect(settingSet(o.io, "own9", "factory.repo", "made-up-me/new")).rejects.toThrow(
      "no message of the owner's",
    )
    o.advance(25 * HOUR)
    await expect(settingSet(o.io, "own1", "factory.repo", "made-up-me/new")).rejects.toThrow(
      "no message of the owner's",
    )
    expect(o.told).toEqual([])
  })

  test("the undo line restores the old value, and a reset when there was none", async () => {
    const o = owned()
    await o.run(["set", "factory.repo", "made-up-me/old", "--reason", "made-up start"])
    await keepMessage(o.dir, "own1", "repo made-up-me/new and the db made-up-db", START, OWNER)
    const words = (said: string) =>
      [...said.split("to undo: ")[1]!.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    const undo = words(await settingSet(o.io, "own1", "factory.repo", "made-up-me/new"))
    expect(undo.slice(0, 2)).toEqual(["playground", "settings"])
    expect((await o.run(undo.slice(2))).code).toBe(0)
    expect(stored(o.data)["factory.repo"]).toBe("made-up-me/old")
    const reset = words(await settingSet(o.io, "own1", "live.container", "made-up-db"))
    expect(reset.slice(0, 4)).toEqual(["playground", "settings", "reset", "live.container"])
    expect(stored(o.data)["live.container"]).toBe("made-up-db")
    expect((await o.run(reset.slice(2))).code).toBe(0)
    expect(stored(o.data)).not.toHaveProperty("live.container")
  })

  test("a guarded key asks the owner yes or no, and applies on a yes within 10 minutes", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "reply policy: factory status only", START, OWNER)
    expect(guarded("wa.replyPolicy")).toBe(true)
    expect(guarded("jobs.ops-wa")).toBe(true)
    expect(guarded("factory.repo")).toBe(false)
    const said = await settingSet(o.io, "own1", "wa.replyPolicy", "factory status only")
    expect(said).toContain("asked the owner on WhatsApp to confirm")
    expect(o.told).toEqual(["set wa.replyPolicy to factory status only? yes or no"])
    expect(stored(o.data)["wa.replyPolicy"]).toBeUndefined()
    o.advance(CONFIRM_MS - 1)
    expect(await confirm(o.io, " Yes ")).toBe(true)
    expect(stored(o.data)["wa.replyPolicy"]).toBe("factory status only")
    expect(o.told[1]).toContain("to undo: playground settings reset wa.replyPolicy")
    expect(await confirm(o.io, "yes")).toBe(false)
  })

  test.each(["yes", "Y", "yes do it", "1", "YES."])("%s applies the waiting key", async (yes) => {
    const o = owned()
    await keepMessage(o.dir, "own1", "guest policy: status only", START, OWNER)
    await settingSet(o.io, "own1", "wa.guestPolicy", "status only")
    expect(await confirm(o.io, yes)).toBe(true)
    expect(stored(o.data)["wa.guestPolicy"]).toBe("status only")
  })

  test("a masked key's question shows its last 4 alone", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "second number +15550100123", START, OWNER)
    await settingSet(o.io, "own1", "wa.alert", "+15550100123")
    expect(o.told).toEqual(["set wa.alert to ••••0123? yes or no"])
  })

  test("a no drops it and says so, and any other reply drops it and goes on", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "reply policy: factory status only", START, OWNER)
    await settingSet(o.io, "own1", "wa.replyPolicy", "factory status only")
    expect(await confirm(o.io, "No")).toBe(true)
    expect(o.told[1]).toBe("left wa.replyPolicy as it was.")
    expect(await confirm(o.io, "yes")).toBe(false)
    await settingSet(o.io, "own1", "wa.replyPolicy", "factory status only")
    expect(await confirm(o.io, "what's the status?")).toBe(false)
    expect(await confirm(o.io, "yes")).toBe(false)
    expect(stored(o.data)["wa.replyPolicy"]).toBeUndefined()
  })

  test("silence past 10 minutes drops it, so a late yes applies nothing", async () => {
    const o = owned()
    await keepMessage(o.dir, "own1", "reply policy: factory status only", START, OWNER)
    await settingSet(o.io, "own1", "wa.replyPolicy", "factory status only")
    o.advance(CONFIRM_MS)
    expect(await confirm(o.io, "yes")).toBe(false)
    expect(stored(o.data)["wa.replyPolicy"]).toBeUndefined()
  })
})

describe("ops-wa's bridge keeps a message and takes a confirm from the owner alone", () => {
  const watched = (o: ReturnType<typeof owned>) => {
    const fake = fakeSocket()
    fake.setClock(() => o.io.now())
    const relayed: string[] = []
    const w = bridge({
      alert: async () => ALERT,
      assistant: async () => undefined,
      busy: async () => false,
      confirm: (text) => confirm(o.io, text),
      dir: o.dir,
      log: () => {},
      now: o.io.now,
      on: async () => true,
      owner: OWNER,
      relay: async (_: string, text: string) => void relayed.push(text),
      reply: async () => "sent",
      sleep: async () => {},
      stuck: async () => null,
    })
    w.attach(fake.sock)
    return { fake, relayed, settle: w.idle }
  }

  test("the owner's line names its id and the settings set, and the owner's yes applies the guarded key", async () => {
    const o = owned()
    const h = watched(o)
    h.fake.upsert([h.fake.message(jid(OWNER), "guest policy: status only", { id: "own1" })])
    await h.settle()
    expect(h.relayed[0]).toContain("--from-owner-msg own1")
    await settingSet(o.io, "own1", "wa.guestPolicy", "status only")
    h.fake.upsert([h.fake.message(jid(OWNER), "yes", { id: "own2" })])
    await h.settle()
    expect(stored(o.data)["wa.guestPolicy"]).toBe("status only")
    expect(h.relayed).toHaveLength(1)
  })

  test("a yes from the second number or a stranger applies nothing", async () => {
    const o = owned()
    const h = watched(o)
    h.fake.upsert([h.fake.message(jid(OWNER), "guest policy: status only", { id: "own1" })])
    await h.settle()
    await settingSet(o.io, "own1", "wa.guestPolicy", "status only")
    h.fake.upsert([
      h.fake.message(jid(ALERT), "yes", { id: "guest1" }),
      h.fake.message(jid(STRANGER), "yes", { id: "stranger1" }),
    ])
    await h.settle()
    expect(stored(o.data)).toEqual({})
  })

  test("a guest's or a stranger's message is never kept, so its id refuses", async () => {
    const o = owned()
    const h = watched(o)
    h.fake.upsert([
      h.fake.message(jid(ALERT), "repo made-up-me/new", { id: "guest1" }),
      h.fake.message(jid(STRANGER), "repo made-up-me/new", { id: "stranger1" }),
    ])
    await h.settle()
    await expect(settingSet(o.io, "guest1", "factory.repo", "made-up-me/new")).rejects.toThrow(
      "no message of the owner's",
    )
    await expect(settingSet(o.io, "stranger1", "factory.repo", "made-up-me/new")).rejects.toThrow(
      "no message of the owner's",
    )
  })
})

describe("playground settings set --from-owner-msg", () => {
  test("only asks ops-wa, so with ops-wa down it refuses and writes nothing", async () => {
    const o = owned()
    const r = await o.run(["set", "wa.alert", "+15550100444", "--from-owner-msg", "own1"])
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("ops-wa is not running")
    expect(stored(o.data)).toEqual({})
  })

  test("takes no --scope, --by or --reason", async () => {
    const o = owned()
    const r = await o.run([
      "set",
      "factory.repo",
      "a/b",
      "--from-owner-msg",
      "own1",
      "--scope",
      "x",
    ])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--from-owner-msg takes no --scope")
  })
})
