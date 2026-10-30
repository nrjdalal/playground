import { ID_ALPHABET, isRosterKind, ROSTER_KINDS } from "@packages/config/kinds"
import { configDirOf } from "@packages/env/data-dir"
import { customAlphabet } from "nanoid"

import { freshName, usedNames } from "./pick"

// Prints a new session's name, `<id>-<kind>`: an id of 6 letters that no session before it holds, so a name is never reused (Inbox #i473: a reused name starts a session on the transcripts of the one before it), then its kind. `bun run name worker`; a checker gets an id of its own, `bun run name reviewer`, and spawn.sh records its worker in the roster.

const [kind, ...extra] = process.argv.slice(2)
if (!isRosterKind(kind) || extra.length > 0) {
  console.error(`usage: bun run name <kind>, a kind of ${ROSTER_KINDS.join(", ")}`)
  process.exit(1)
}
const name = freshName(kind, await usedNames(configDirOf()), customAlphabet(ID_ALPHABET, 6))
if (!name) {
  console.error("every new id it drew is held already; run it again")
  process.exit(1)
}
console.log(name)
