// PreToolUse hook for the factory's sessions (role.ts), registered in both settings files: refuses a write to the public repository (a pull request, an issue, a review or a comment, through gh, gh api, curl or the GitHub MCP) whose text holds a name, a handle, a company term, a Slack id or a Linear key from its list, or an email address, an archive issue key or an archive link, since everything written there is public once the repository is. Its reason names the kind of text, never the text; it reads every write as no-playground-leak does, through that guard's engine, and each kind as the trace ratchet counts it (packages/scripts/src/trace-count/kinds.ts).
import "../../packages/env/src/aliases"
import { dataDir } from "../../packages/env/src/data-dir"
import {
  EMPTY_LIST,
  isPublicList,
  type Kind,
  type PublicList,
  patterns,
  readPast,
  type Repos,
  reposOf,
} from "../../packages/scripts/src/trace-count/kinds"
import { readPolicy } from "../../packages/settings/src/rendered"
import { guardList } from "./lists"
import { type Hit, inspectAs, type Policy, refusedList } from "./no-playground-leak"
import { fromFactory } from "./role"

type Environment = Record<string, string | undefined>

const PERSON = "Say the role (the owner, a reviewer, a worker) in place of the person."

// What a refusal says of each kind it refuses, and its plain-words fix; #NNN and the old session names are the public repository's own words, so a write may hold them.
const SAID: Partial<Record<Kind, Hit>> = {
  archiveKeys: {
    detail: "an archive issue key",
    fix: "Describe the change in plain words, or name its issue on this repository.",
  },
  archiveLinks: {
    detail: "an archive link",
    fix: "Describe what it points to, or link this repository's own copy.",
  },
  companies: { detail: "a company term", fix: "Name the work in plain words, not whose it is." },
  emails: { detail: "an email address", fix: "Leave the address out." },
  handles: { detail: "a handle", fix: PERSON },
  linearKeys: { detail: "a Linear key", fix: "Describe the ticket in plain words." },
  names: { detail: "a person's name", fix: PERSON },
  slackIds: {
    detail: "a Slack id",
    fix: "Leave the id out, and say what the conversation settled.",
  },
}

function finder(list: PublicList, repos: Repos): (text: string) => Hit | undefined {
  const kinds = patterns(list, repos).filter(([kind]) => SAID[kind])
  return (text) => {
    const said = readPast(text, repos)
    const found = kinds.find(([, re]) => said.search(re) !== -1)
    return found && SAID[found[0]]
  }
}

const policy = (list: PublicList, repos: Repos): Policy => ({
  find: finder(list, repos),
  git: false,
  guard: "no-public-leak",
  guarded: (repo) => `${repo.owner}/${repo.repo}`.toLowerCase() === repos.public,
  hosts: false,
  place: "the public repository",
  what: "private text",
  why: `Everything written to ${repos.public} is public once the repository is, and stays cached after, so it names no person, company or private record.`,
})

// Fails closed on its list, which only the store holds (lists.ts), and on a store it cannot read for the repositories (factory.publicRepo and factory.archiveRepo), and, as no-playground-leak, only on a call that may write.
export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  const loaded = await guardList(
    "no-public-leak",
    "no-public-leak",
    isPublicList,
    EMPTY_LIST,
    environment,
  )
  if (loaded.refusal) return refusedList(raw, loaded.refusal)
  const read = await readPolicy(dataDir(environment))
  if (read.refusal !== undefined)
    return refusedList(
      raw,
      `no-public-leak hook refused this call: ${read.refusal}, then run the call again.`,
    )
  return inspectAs(policy(loaded.list ?? EMPTY_LIST, reposOf(read.settings)), raw, environment)
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
