import { homedir } from "node:os"
import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { deleteWeights, isWeights, type Roots } from "@packages/safe-delete"

import { dropPaths, readRecord } from "../machine-record/record"
import { mainCheckout } from "../main-checkout"
import { CARD_ID } from "../ops-tick/unused-card"
import { sessionName } from "../trash"
import { removeSet, setBytes, shardSet } from "./shards"

// The far end of an approved removal on a peer's own machine, run from there by the ssh `peerArgv` shapes: <path> <bytes> <card>, a path on the record or under a recorded folder at the card's exact size, re-checked here before the same deleteWeights drops it.
export const RM_PEER_USAGE =
  "usage: playground rm --card <id> --peer <machine> <path> (a far end takes <path> <bytes> <card>); or --bytes <path>, a read-only size, no delete"

export type RmPeerDeps = {
  data: string
  home: string
  main: string
  session: () => Promise<string> | string
}

// One record-or-weights gate both modes share, so its refusal and its exit 1 live in one place: the recorded folders when this path is on this peer's record, or isWeights accepts it under ~/models or a recorded folder, else null.
const gateRecord = async (path: string, deps: RmPeerDeps): Promise<string[] | null> => {
  const { entries } = await readRecord(deps.data).catch(() => ({ entries: [] }))
  const folders = entries.filter((entry) => entry.kind === "folder").map((entry) => entry.path)
  if (!entries.some((entry) => entry.path === path) && !isWeights(path, deps.home, folders)) {
    console.error(`playground: ${path} is not on the machine record, so it stays`)
    return null
  }
  return folders
}

// The peer's far end: <path> <bytes> <card>, or why the bytes or card do not read, a path on the record or under a recorded folder at its exact size, re-checked on this peer and deleted with the same deleteWeights, its record entry dropped.
export async function runRmPeer(words: string[], deps: RmPeerDeps): Promise<number> {
  if (words[0] === "--bytes") {
    if (words.length < 2) {
      console.error(`playground: ${RM_PEER_USAGE}`)
      return 2
    }
    const folders = await gateRecord(words[1], deps)
    if (!folders) return 1
    const size = setBytes(words[1])
    if (size === 0) {
      console.error(`playground: ${words[1]} holds no bytes here, so it stays`)
      return 1
    }
    console.log(String(size))
    return 0
  }
  if (words.length < 3) {
    console.error(`playground: ${RM_PEER_USAGE}`)
    return 2
  }
  const [path, bytesText, card] = words
  const bytes = Number(bytesText)
  if (!/^\d+$/.test(bytesText) || !Number.isInteger(bytes) || bytes <= 0) {
    console.error(`playground: ${bytesText} is not ${path}'s bytes`)
    return 2
  }
  if (!CARD_ID.test(card)) {
    console.error(`playground: ${card} is not an Inbox card id`)
    return 2
  }
  const folders = await gateRecord(path, deps)
  if (!folders) return 1
  const roots: Roots = { home: deps.home, main: deps.main, trash: join(deps.data, "trash") }
  const session = await deps.session()
  const set = shardSet(path)
  if (!set) {
    const done = deleteWeights(
      path,
      { approved: { bytes, card }, folders, reason: `nightly-clean card ${card}`, session },
      roots,
    )
    if ("refused" in done) {
      console.error(`playground: ${done.refused}`)
      // a protected or tripwire refusal exits 3, so the near end tells the dispatcher of it as a local one does
      return done.kind === "refused" ? 1 : 3
    }
    const logged = `Deleted ${path} outright (${done.size} bytes), as card ${card} approved on the peer; ${join(roots.trash, "deleted.jsonl")} logs it`
    const dropped = await dropPaths(deps.data, [path]).catch(() => [])
    console.log(dropped.length ? `${logged}; its machine record entry is dropped` : logged)
    return 0
  }
  const done = removeSet(
    set,
    { bytes, card },
    { folders, reason: `nightly-clean card ${card}`, session },
    roots,
  )
  if ("refused" in done) {
    console.error(`playground: ${done.refused}`)
    // a protected or tripwire refusal exits 3, so the near end tells the dispatcher of it as a local one does
    return done.kind === "refused" ? 1 : 3
  }
  const logged = `Deleted the ${set.length} shards outright (${done.size} bytes), as card ${card} approved on the peer; ${join(roots.trash, "deleted.jsonl")} logs it`
  const dropped = await dropPaths(deps.data, set).catch(() => [])
  console.log(dropped.length ? `${logged}; its machine record entries are dropped` : logged)
  return 0
}

if (import.meta.main) {
  void (async () => {
    const home = process.env.HOME || homedir()
    const code = await runRmPeer(process.argv.slice(2), {
      data: dataDir(),
      home,
      main: mainCheckout(),
      session: sessionName,
    })
    process.exit(code)
  })()
}
