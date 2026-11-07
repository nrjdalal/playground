// What an ask card holds for an answer not yet sent: the option index picked for a single-question ask, one index per question for a multi-question ask, the question in sight, and the Note, each entry stamped with the questions' signature (picksKey) so a set changed under an unmounted card drops the stale picks and step. A list refresh or a shelf move that remounts the card gives them back, as a draft card's words come back under cardDraftKey.
export type AskPicks = {
  note: string
  pick: number | null
  picks: (number | null)[]
  sig: string
  step: number
}
export type PicksStore = Record<string, AskPicks>

export const PICKS_KEY = "dashboard.inbox.picks.v1"

const EMPTY: PicksStore = {}

// An entry with no pick made and no note typed is dropped, as an empty draft is, so an untouched card leaves nothing behind; step alone never holds an entry, since a step past the first needs a pick.
const isEmpty = (entry: AskPicks) =>
  entry.pick === null && entry.picks.every((p) => p === null) && entry.note.trim() === ""

const isIndex = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0)

const isStep = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0

// Pure: the answers a stored value holds, dropping any entry a hand-edit malformed so a stale or bad index never checks a row.
export function parsePicks(raw: string | null): PicksStore {
  if (!raw) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY
  const store: PicksStore = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue
    const { note, pick, picks, sig, step } = entry as Record<string, unknown>
    if (typeof sig !== "string" || typeof note !== "string" || !isStep(step)) continue
    if (!isIndex(pick)) continue
    if (!Array.isArray(picks) || !picks.every(isIndex)) continue
    const parsed: AskPicks = { note, pick, picks: picks as (number | null)[], sig, step }
    if (!isEmpty(parsed)) store[id] = parsed
  }
  return store
}

// Pure: the store with one card's answer replaced, an entry with no pick and no note removing it.
export function putPicks(store: PicksStore, id: string, entry: AskPicks): PicksStore {
  const rest = { ...store }
  delete rest[id]
  return isEmpty(entry) ? rest : { ...rest, [id]: entry }
}

// The answers in this tab, read from localStorage and kept here too, so a blocked or private window still gives them back across a remount.
let current: PicksStore | null = null

const readStored = (): PicksStore | null => {
  try {
    return parsePicks(localStorage.getItem(PICKS_KEY))
  } catch {
    return null
  }
}

export function readPicks(): PicksStore {
  if (current === null) current = readStored() ?? EMPTY
  return current
}

// Writes one card's answer over what storage holds now, so another card's answer stays.
export function savePicks(id: string, entry: AskPicks): void {
  const before = readStored() ?? readPicks()
  const next = putPicks(before, id, entry)
  if (JSON.stringify(next) === JSON.stringify(readPicks())) return
  current = next
  try {
    if (Object.keys(current).length) localStorage.setItem(PICKS_KEY, JSON.stringify(current))
    else localStorage.removeItem(PICKS_KEY)
  } catch {}
}
