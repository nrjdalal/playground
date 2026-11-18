import { join } from "node:path"

import {
  GUARD_SETTING_KEYS,
  loginOf,
  resolveKey,
  setSetting,
  settingRows,
  shownValue,
} from "@packages/settings"

import { valueOf } from "../playground/store"
import { keptMessage, wordHashes, wordKey } from "./alert-set"
import { readOwn, writeOwn } from "./habits"
import { seedAlert } from "./seed"

// confirm.json, ops-wa's alone: the one setting a guarded key waits to apply on, until the owner's yes within CONFIRM_MS (ADR 0035)
export const confirmFile = (dir: string) => join(dir, "confirm.json")
export const CONFIRM_MS = 10 * 60_000
type Pending = { at: number; id: string; key: string; value: string }

// Whether a key is one a guard reads, which waits for the owner's confirm on WhatsApp: a guard key or any ops job's jobs.<name>.
export const guarded = (key: string) => {
  const name = resolveKey(key) ?? key
  return (GUARD_SETTING_KEYS as readonly string[]).includes(name) || name.startsWith("jobs.")
}

// Whether the value's words stand in a row in the message's words, so a value the owner did not write is refused.
export const holds = (words: string[], value: string, key: Buffer) => {
  const want = wordHashes(value, key)
  if (!want.length) return false
  for (let i = 0; i + want.length <= words.length; i++)
    if (want.every((hash, k) => words[i + k] === hash)) return true
  return false
}

const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`
// A value as the owner reads it: a string as it stands, masked to its last 4 where the setting is masked, anything else as JSON.
const shown = (key: string, value: unknown) => {
  const seen = shownValue(key, value) ?? null
  return typeof seen === "string" ? seen : JSON.stringify(seen)
}

// Sets a key at the login's scope as the owner's act, as the Inbox's Approve writes it, and gives the undo: the old value's set, or a reset when the scope held none.
export function applyOwnerSetting(data: string, key: string, text: string, id: string) {
  const scope = loginOf(data)
  const name = resolveKey(key) ?? key
  const old = settingRows(data).find(
    (row) => row.scope === scope && (resolveKey(row.key) ?? row.key) === name,
  )
  const reason = `the owner's WhatsApp message ${id} asked for it`
  const set = setSetting(
    data,
    { key, scope, value: valueOf(text) },
    { actor: "ops-wa", author: "owner", inboxRef: null, reason },
  )
  if (!set.ok) throw new Error(set.message)
  if (set.key === "wa.alert" && set.value) seedAlert(data, String(set.value), Date.now())
  const why = `--reason ${quoted(`undo of the owner's WhatsApp message ${id}`)}`
  const undo = old
    ? `playground settings set ${set.key} ${quoted(JSON.stringify(old.value))} ${why}`
    : `playground settings reset ${set.key} ${why}`
  return {
    log: `ops-wa: ${set.key} set from the owner's message ${id}; it was ${old ? shown(set.key, old.value) : "unset"}`,
    undo,
  }
}

export type SettingSetIo = {
  // sets the key as the owner's act, its log line and undo back
  apply: (key: string, value: string, id: string) => { log: string; undo: string }
  dir: string
  log: (line: string) => void
  now: () => number
  // one line to the owner's WhatsApp
  tell: (line: string) => Promise<unknown>
}

async function applied(io: SettingSetIo, key: string, value: string, id: string) {
  const { log, undo } = io.apply(key, value, id)
  io.log(log)
  await io
    .tell(`set ${key} from your message. to undo: ${undo}`)
    .catch((error: Error) => io.log(`ops-wa: the set line: ${error.message}`))
  return `set ${key} from the owner's message ${id}; to undo: ${undo}`
}

// settings set --from-owner-msg: the owner's own kept message of that id must hold the value; a guarded key then waits for the owner's yes on WhatsApp, and any other key applies at once.
export async function settingSet(io: SettingSetIo, id: string, key: string, value: string) {
  const hit = await keptMessage(io.dir, id, io.now())
  if (!hit) throw new Error(`no message of the owner's in the last 24 hours has the id ${id}`)
  const secret = await wordKey(io.dir)
  if (!secret) throw new Error("ops-wa has no word key, so no message can be matched")
  if (!holds(hit.words, value, secret))
    throw new Error(`the owner's message ${id} does not hold the value`)
  if (!guarded(key)) return applied(io, key, value, id)
  const earlier = await readOwn<Partial<Pending>>(confirmFile(io.dir), {})
  if (earlier.key && io.now() - (earlier.at ?? 0) < CONFIRM_MS)
    await io.tell(`the question on ${earlier.key} no longer waits.`)
  await io.tell(`set ${key} to ${shown(key, valueOf(value))}? yes or no`)
  await writeOwn(confirmFile(io.dir), { at: io.now(), id, key, value } satisfies Pending)
  return `${key} is a key a guard reads: asked the owner on WhatsApp to confirm, and it applies on their yes within ${CONFIRM_MS / 60_000} minutes`
}

// The owner's answers to the question: these apply, "no" drops it, and so does any other message
const YES = new Set(["1", "y", "yes", "yes do it"])
const answer = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "")

// The owner's next message after the question settles it: a yes within 10 minutes applies the waiting setting, and anything else, or a yes after 10 minutes, drops it; true when the message was a yes or a no, which goes no further, and false for any other, which goes on as before.
export async function confirm(io: SettingSetIo, text: string): Promise<boolean> {
  const pending = await readOwn<Partial<Pending>>(confirmFile(io.dir), {})
  if (!pending.key || !pending.id || pending.value === undefined) return false
  await writeOwn(confirmFile(io.dir), {})
  const said = answer(text)
  const late = io.now() - (pending.at ?? 0) >= CONFIRM_MS
  if (late || (!YES.has(said) && said !== "no")) return false
  if (said === "no") {
    await io
      .tell(`left ${pending.key} as it was.`)
      .catch((error: Error) => io.log(`ops-wa: the no line: ${error.message}`))
    return true
  }
  await applied(io, pending.key, pending.value, pending.id).catch((error: Error) =>
    io
      .tell(`did not set ${pending.key}: ${error.message}`)
      .catch(() => io.log(`ops-wa: ${pending.key} was not set: ${error.message}`)),
  )
  return true
}
