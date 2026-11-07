// PreToolUse hook for the factory's sessions (role.ts), registered in both settings files: refuses a write to a public repository (a pull request, an issue, a review or a comment, through gh, gh api, curl or the GitHub MCP) whose text holds a name, a handle, a company term, a Slack id or a Linear key from its list, or an email address or an archive link, since everything written there is public once the repository is. Its reason names the kind of text, never the text; it reads every write as no-playground-leak does, through that guard's engine, and each kind as the trace ratchet counts it (packages/scripts/src/trace-count/kinds.ts).
import "../../packages/env/src/aliases"
import { dataDir } from "../../packages/env/src/data-dir"
import {
  EMPTY_LIST,
  isPublicList,
  type Kind,
  LIST_KEYS,
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

// A plain ship notes write, one `gh release create` or `edit` with no substitution, chain, pipe or redirect, the one call whose notes may name the owner.
const SHIP = /^\s*gh release (?:create|edit)\b[^`$();&|<>\n]*$/
// The notes with the owner's own Contributors line read past: under a Contributors heading, `- <names> @<login>` whose login and every name owner.names lists, so the same names anywhere else are still refused.
function ownLinesPast(text: string, owner: string[]): string {
  const own = new Set(owner.map((word) => word.toLowerCase()))
  let contributors = false
  return text
    .split("\n")
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) contributors = /\bContributors\s*$/.test(line)
      const m = contributors ? /^- ((?:\S+ )+)@([\w-]+)\s*$/.exec(line) : null
      const mine =
        m !== null &&
        own.has(m[2].toLowerCase()) &&
        m[1]
          .trim()
          .split(" ")
          .every((word) => own.has(word.toLowerCase()))
      return mine ? "" : line
    })
    .join("\n")
}

function finder(list: PublicList, repos: Repos, ship: boolean): (text: string) => Hit | undefined {
  const kinds = patterns(list, repos).filter(([kind]) => SAID[kind])
  return (text) => {
    const said = readPast(ship ? ownLinesPast(text, repos.owner) : text, repos)
    const found = kinds.find(([, re]) => said.search(re) !== -1)
    return found && SAID[found[0]]
  }
}

const policy = (list: PublicList, repos: Repos, ship: boolean): Policy => ({
  find: finder(list, repos, ship),
  git: false,
  guard: "no-public-leak",
  guarded: (repo) => repos.public.includes(`${repo.owner}/${repo.repo}`.toLowerCase()),
  hosts: false,
  place: "a public repository",
  what: "private text",
  why: `Everything written to ${repos.public.join(" or ")} is public once the repository is, and stays cached after, so it names no person, company or private record.`,
})

const shipWrite = (raw: string): boolean => {
  try {
    const { tool_input: input, tool_name: tool } = JSON.parse(raw) as {
      tool_input?: { command?: unknown }
      tool_name?: unknown
    }
    return tool === "Bash" && typeof input?.command === "string" && SHIP.test(input.command)
  } catch {
    return false
  }
}

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
  if (loaded.refusal)
    return refusedList(
      raw,
      `${loaded.refusal} The list is a JSON object with an array of strings under each of ${LIST_KEYS.join(", ")}.`,
    )
  const read = await readPolicy(dataDir(environment))
  if (read.refusal !== undefined)
    return refusedList(
      raw,
      `no-public-leak hook refused this call: ${read.refusal}, then run the call again.`,
    )
  return inspectAs(
    policy(loaded.list ?? EMPTY_LIST, reposOf(read.settings), shipWrite(raw)),
    raw,
    environment,
  )
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
