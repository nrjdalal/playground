import { join } from "node:path"

import { OWNER_WINDOW_MS, readOwn, writeOwn } from "./habits"

// numbers.json, the bridge's queue's alone: for each owner text message that holds exactly one phone number, its id, time and that number, never its text, the last 50 of 24 hours, so the owner's own message can set the second number (ADR 0032)
export const numbersFile = (dir: string) => join(dir, "numbers.json")
export type Kept = { at: number; id: string; number: string }
const KEEP = 50

const masked = (e164: string) => `...${e164.slice(-4)}`

// Each phone number in a text in E.164, once: a + and 8 to 15 digits with spaces, dashes or brackets between, or a bare 10 digits, which take the owner's own country code.
export function phonesIn(text: string, owner: string): string[] {
  const found = new Set<string>()
  for (const [match] of text.matchAll(/(?<![\w+])\+\d[\d ()-]{6,20}\d(?![\w-])/g)) {
    const digits = match.replace(/\D/g, "")
    if (digits.length >= 8 && digits.length <= 15) found.add(`+${digits}`)
  }
  const country = owner.replace(/\D/g, "").slice(0, -10)
  for (const [match] of text.matchAll(/(?<![\w+#.:/-])\d{5} ?\d{5}(?![\w.:/-])/g))
    if (country) found.add(`+${country}${match.replace(/\D/g, "")}`)
  return [...found]
}

// Keeps an owner message's one number by its id; a message with none or several keeps nothing.
export async function keepNumber(
  dir: string,
  id: string,
  text: string,
  at: number,
  owner: string,
): Promise<boolean> {
  const numbers = phonesIn(text, owner)
  if (numbers.length !== 1) return false
  const { kept = [] } = await readOwn<{ kept?: Kept[] }>(numbersFile(dir), {})
  const fresh = [...kept, { at, id, number: numbers[0]! }]
    .filter((k) => at - k.at < OWNER_WINDOW_MS)
    .slice(-KEEP)
  await writeOwn(numbersFile(dir), { kept: fresh })
  return true
}

export type AlertSetIo = {
  device: string
  dir: string
  now: () => number
  owner: string
  // writes wa.alert as the owner's act and seeds its first message, and says what it held before
  set: (number: string, id: string) => Promise<string>
}

// wa alert-set: the second number becomes the one number in the owner's own kept message, by its id; anything else is refused, so the guard on wa.alert still holds for every other writer.
export async function alertSet(io: AlertSetIo, id: string): Promise<string> {
  const { kept = [] } = await readOwn<{ kept?: Kept[] }>(numbersFile(io.dir), {})
  const hit = kept.find((k) => k.id === id && io.now() - k.at < OWNER_WINDOW_MS)
  if (!hit)
    throw new Error(
      `no message of the owner's in the last 24 hours with exactly one phone number has the id ${id}`,
    )
  if (hit.number === io.owner) throw new Error("the number is the owner's own number")
  if (hit.number === io.device) throw new Error("the number is the spare number ops-wa links as")
  const before = await io.set(hit.number, id)
  return `set the second number to ${masked(hit.number)} from the owner's message ${id}; ${before}`
}
