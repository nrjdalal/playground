// ship:yard <tag>: deploys the hosted Yard from a ship's tag, its API and then its web, checking the live host after each and recording the tag it deployed.
import { registryName, rosterKind } from "../../../../scripts/hooks/role"
import { claudeAbove, type Proc, procOf } from "../../../../scripts/hooks/session-state"

export type Project = "api" | "web"

export type YardIo = {
  changed: (from: string, to: string) => Promise<string[]>
  deploy: (project: Project, dir: string) => Promise<boolean>
  drop: (dir: string) => Promise<void>
  err: (line: string) => void
  fetch: (tags: string[]) => Promise<void>
  files: (sha: string) => Promise<string[]>
  inRange: (sha: string, since: string, tag: string) => Promise<boolean>
  launch: () => Promise<Launch>
  out: (line: string) => void
  // a PR's body, or null when the read fails
  prBody: (pr: number) => Promise<string | null>
  readRecord: () => Promise<string | undefined>
  schemaCleared: (value: string) => Promise<SchemaSource | null>
  status: (url: string) => Promise<number>
  // the subject of each commit in since..tag that touches the file, or null when the read fails
  touching: (file: string, since: string, tag: string) => Promise<string[] | null>
  worktree: (tag: string) => Promise<string>
  writeRecord: (tag: string) => Promise<void>
}

// A --schema-cleared value's source: #iN an Inbox decision the owner approved and whether it is a schema one, PR#N a merged PR with its author's shape review, a dump path and its merge commit. A null read, one that failed or that no source shape fits, fails the step closed.
export type SchemaSource =
  | { approved: boolean; kind: "decision"; schema: boolean }
  | { dumpPath?: string; kind: "pr"; merged: boolean; mergeSha?: string; shapeReview: boolean }

// The call's launch, as the claude process it runs under was started: that process's PLAYGROUND_ROLE, the roster's kind for its session's registry name, and what the walk found.
export type Launch = { found: string; kind?: string; role?: string }

// The Ops lead's launch, which no-raw-vercel's pass keys on too: the lead role and the ops kind, so a call by any runner, copy or link of this file stops here unless the Ops lead's claude process runs it.
export const opsLaunch = (launch: Launch): boolean =>
  launch.role === "lead" && launch.kind === "ops"

// The launch of the claude process above this call (session-state's walk), each folder read from that process's own environment and never this one's, so a prefix, an export or env on the call changes none of it; a walk that finds no claude process, or a registry or roster it cannot read, names no kind.
export async function launchAbove(
  pid: number = process.ppid,
  procs: (pid: number) => Proc | undefined = procOf,
): Promise<Launch> {
  const above = await claudeAbove(pid, procs)
  if (!above) return { found: "no Claude Code process above this call" }
  const at = `the claude process ${above.pid}`
  if (!above.sessionId || !above.config)
    return { found: `${at}, whose session its registry does not name`, role: above.role }
  if (!above.env.PLAYGROUND_DATA_DIR && !above.env.HOME)
    return { found: `${at}, which names no data folder`, role: above.role }
  const own = {
    CLAUDE_CONFIG_DIR: above.config,
    HOME: above.env.HOME,
    PLAYGROUND_DATA_DIR: above.env.PLAYGROUND_DATA_DIR,
  }
  const name = await registryName(above.sessionId, own).catch(() => undefined)
  if (!name) return { found: `${at}, whose registry it cannot read`, role: above.role }
  return { found: `${at}, session ${name}`, kind: await rosterKind(name, own), role: above.role }
}

export type YardHosts = Record<Project, string>

export type YardArgs = { schemaCleared?: string[]; since?: string; tag: string }

// The API first, since its build applies the migrations the web's code reads.
export const ORDER: Project[] = ["api", "web"]

// A route a bot reads with its token, which answers 401 without one, so a deploy that serves Yard's router with its auth reads right.
export const BOT_ROUTE = "/api/v1/yard/channels"

// What a deploy migrates: the API's build applies packages/db's migrations (migrate-on-deploy.ts), which the schema's files write.
const SCHEMA = /^packages\/db\/(?:drizzle|src\/schema)\//

export const schemaChanges = (files: string[]): string[] =>
  files.filter((file) => SCHEMA.test(file))

// What a source must cover (issue 3125): the schema diff's migration files, else, with none, every schema file it names, so a cover is never empty.
export const coverSet = (schema: string[]): string[] => {
  const migrations = schema.filter((file) => /^packages\/db\/drizzle\/[^/]+\.sql$/.test(file))
  return migrations.length ? migrations : schema
}

// The PR a commit's subject names, the number in parentheses pr:merge's squash ends it with; none for a commit no PR merged.
export const subjectPr = (subject: string): number | undefined => {
  const pr = /\(#(\d+)\)$/.exec(subject.trim())
  return pr ? Number(pr[1]) : undefined
}

// Whether a PR's body names an Inbox id, `#i12` never matching `#i123`.
export const namesDecision = (body: string, value: string): boolean =>
  new RegExp(`${value}(?![0-9])`).test(body)

// A PR as `gh pr view --json author,body,comments,mergeCommit,state` sends it, its fields read here.
type PrJson = {
  author?: { login?: string }
  body: string
  comments?: { author?: { login?: string }; body: string }[]
  mergeCommit?: { oid?: string } | null
  state?: string
}

// A JSON parse that returns undefined on bad input, so a source treats a read it cannot trust as unreadable.
const safeParse = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

// A dump's path from `~/`: a home path, never a packages/db migration, so a schema PR's migration .sql never clears as its dump.
const DUMP_RE = /~\/[\w./-]+\.(?:sql|dump)\b/

// A shape review, a comment whose first line names it in any case (db-migration's step 0), counted only from the PR's own author, the account every session posts as, since anyone can comment on a public repo's PR.
const SHAPE_RE = /shape review/i

// A PR's JSON from `gh pr view --json author,body,comments,mergeCommit,state`, parsed into what it holds: null when the JSON is not that shape, so the step fails closed on a read it cannot trust.
export const prSource = (json: string): SchemaSource | null => {
  const read = safeParse(json) as PrJson | undefined
  const author = read?.author?.login
  if (!read || typeof read.state !== "string" || !Array.isArray(read.comments) || !author)
    return null
  const shapeReview = read.comments.some(
    (comment) =>
      comment.author?.login === author && SHAPE_RE.test(String(comment.body).split("\n")[0]!),
  )
  const dumpPath = DUMP_RE.exec(String(read.body))?.[0]
  const mergeSha = read.mergeCommit?.oid
  return { dumpPath, kind: "pr", merged: read.state === "MERGED", mergeSha, shapeReview }
}

// An Inbox decision's JSON from `playground ask get`, parsed into whether the owner approved it and whether its preview is a schema one, step 0's breaking path: null when the JSON is not an Inbox decision's shape, so a step fails closed on a read it cannot trust.
export const decisionSource = (json: string): SchemaSource | null => {
  const read = safeParse(json)
  if (!read || typeof read !== "object" || (read as { kind?: string }).kind !== "decision")
    return null
  const item = read as { preview?: { type?: unknown }; status?: string }
  return {
    approved: item.status === "approved",
    kind: "decision",
    schema: item.preview?.type === "schema",
  }
}

// The Inbox `ask get` argv for a #iN value: its id, so the reader the live dashboard checkout runs gets `i123` for `#i123`.
export const decisionArg = (value: string): string => value.replace(/^#/, "")

// The live host's two checks, each its URL and the status it answers when the deploy serves.
export const hostChecks = (host: string): [string, number][] => [
  [`${host}/api/health`, 200],
  [`${host}${BOT_ROUTE}`, 401],
]

export async function shipYard(args: YardArgs, hosts: YardHosts, io: YardIo): Promise<number> {
  const launch = await io.launch()
  if (!opsLaunch(launch)) {
    io.err(
      `ship:yard: the step deploys production, so it runs for the Ops lead's claude process alone (PLAYGROUND_ROLE lead, the roster's ops kind); this call runs under ${launch.found}, whose PLAYGROUND_ROLE is ${launch.role || "unset"} and kind ${launch.kind || "unknown"}`,
    )
    return 1
  }
  const recorded = await io.readRecord()
  if (recorded === args.tag) {
    io.out(`ship:yard: ${args.tag} is already deployed, by ops/yard-tag`)
    return 0
  }
  const since = recorded ?? args.since
  if (!since) {
    io.err(
      "ship:yard: no ops/yard-tag record in the data folder, so the step cannot tell what it deploys over: run it again with --since <the tag live now>, once, and the record takes over",
    )
    return 1
  }
  // step 4 makes the tag on GitHub alone, so the step fetches both tags before it reads them
  await io.fetch([since, args.tag])
  const schema = schemaChanges(await io.changed(since, args.tag))
  if (schema.length) {
    const values = args.schemaCleared ?? []
    if (!values.length) {
      io.err(
        `ship:yard: ${args.tag} changes the schema since ${since} (${schema.join(", ")}), which the API's build migrates: take it through the db-migration skill's step 0, then run again with --schema-cleared, once per source, naming sources that together cover each migration this ship carries: '#iN' (quoted, since a bare # starts a shell comment), the owner's approved step 0 schema decision, named in the body of each PR that carries a migration it covers (the breaking path), or PR#N, a PR merged between the recorded tag and this one, whose author posted a shape review (a comment whose first line names one), whose body names a dump path from \x60~/\x60, and whose diff holds the migrations it covers (the additive path)`,
      )
      return 1
    }
    const bad = values.find((value) => !/^#i\d+$/.test(value) && !/^PR#\d+$/.test(value))
    if (bad) {
      io.err(
        `ship:yard: --schema-cleared <${bad}> takes one of two forms: '#iN', the owner's approved step 0 schema decision, named in the body of each PR that carries a migration it covers (the breaking path), or PR#N, a PR merged between the recorded tag and this one, whose author posted a shape review (a comment whose first line names one), whose body names a dump path from \x60~/\x60, and whose diff holds the migrations it covers (the additive path); run it again naming one`,
      )
      return 1
    }
    const cover = coverSet(schema)
    const covered = new Set<string>()
    for (const value of values) {
      const source = await io.schemaCleared(value)
      if (!source) {
        const decision = /^#i\d+$/.test(value)
        io.err(
          `ship:yard: the ${decision ? "Inbox decision " + value : "PR " + value} is not readable (its ${decision ? "playground ask get" : "gh pr view"} read failed, or answered in a shape the step does not know), so the schema ${args.tag} changes is not cleared: run it again once that read answers`,
        )
        return 1
      }
      if (source.kind === "decision") {
        if (!source.approved) {
          io.err(
            `ship:yard: ${value} is not an approved Inbox decision, so it does not clear the schema ${args.tag} changes; take it through step 0, then run again once the owner has approved it`,
          )
          return 1
        }
        if (!source.schema) {
          io.err(
            `ship:yard: ${value} is not a schema decision, the kind step 0's breaking path posts, so it does not clear the schema ${args.tag} changes`,
          )
          return 1
        }
        // a file is covered when each commit of the range that touches it is a PR whose body names the decision (issue 3125)
        for (const file of cover) {
          const subjects = await io.touching(file, since, args.tag)
          const prs = (subjects ?? []).map(subjectPr)
          if (!prs.length || prs.some((pr) => pr === undefined)) continue
          const bodies = await Promise.all(prs.map((pr) => io.prBody(pr!)))
          if (bodies.every((body) => body !== null && namesDecision(body, value))) covered.add(file)
        }
        continue
      }
      const missing = [
        !source.merged && "it is not merged",
        !source.shapeReview && "no comment of its author's names a shape review in its first line",
        !source.dumpPath && "its body names no dump path from \x60~/\x60",
      ].filter(Boolean)
      if (missing.length) {
        io.err(
          `ship:yard: ${value} does not clear the schema ${args.tag} changes: ${missing.join("; ")}; it must be a PR merged between the recorded tag and this one, whose author posted a shape review (a comment whose first line names one), whose body names a dump path from \x60~/\x60, and whose diff holds the migrations it covers`,
        )
        return 1
      }
      if (!source.mergeSha || !(await io.inRange(source.mergeSha, since, args.tag))) {
        io.err(
          `ship:yard: ${value} ${source.mergeSha ? "merged outside" : "has no merge commit in"} ${since}..${args.tag}, so it does not cover the migrations ${args.tag} ships: name a PR#N merged in that range`,
        )
        return 1
      }
      const files = new Set(await io.files(source.mergeSha))
      for (const file of cover) if (files.has(file)) covered.add(file)
    }
    const uncovered = cover.filter((file) => !covered.has(file))
    if (uncovered.length) {
      io.err(
        `ship:yard: --schema-cleared ${values.join(" ")} does not cover the migrations ${args.tag} ships, still uncovered: ${uncovered.join(", ")}; add a source for each, once per --schema-cleared: '#iN', the owner's approved step 0 schema decision, named in the body of each PR that carries a migration it covers, or PR#N, a PR merged between the recorded tag and this one, whose author posted a shape review (a comment whose first line names one), whose body names a dump path from \x60~/\x60, and whose diff holds the migrations it covers`,
      )
      return 1
    }
  }
  const dir = await io.worktree(args.tag)
  try {
    for (const project of ORDER) {
      if (!(await io.deploy(project, dir))) {
        io.err(`ship:yard: the ${project} deploy failed, so the step stops here`)
        return 1
      }
      for (const [url, want] of hostChecks(hosts[project])) {
        const got = await io.status(url)
        if (got !== want) {
          io.err(`ship:yard: after the ${project} deploy, ${url} answered ${got}, not ${want}`)
          return 1
        }
      }
      io.out(`ship:yard: ${project} deployed from ${args.tag}, its live checks pass`)
    }
    await io.writeRecord(args.tag)
    return 0
  } finally {
    await io.drop(dir)
  }
}

const KEYS = [
  "YARD_API_URL",
  "YARD_VERCEL_API_PROJECT_ID",
  "YARD_VERCEL_TEAM_ID",
  "YARD_VERCEL_WEB_PROJECT_ID",
  "YARD_WEB_URL",
] as const

const USAGE = `usage: bun run ship:yard <tag> [--since <tag>] [--schema-cleared <'#iN' | PR#N>]...

Deploys the hosted Yard from <tag>, the ship's tag: its API, then its web, each with
vercel deploy --prod from a detached worktree at the tag, fetched from origin, checking
the live host after each (/api/health answers 200, ${BOT_ROUTE} answers 401 with no
token), then records the tag in the data folder's ops/yard-tag and removes the worktree.
It runs under the Ops lead's claude process alone (its PLAYGROUND_ROLE lead, the roster's
ops kind), read from that process and never this call's environment. It stops
when the tag changes packages/db's schema or migrations since the recorded tag, until
--schema-cleared, once per source, names sources that together cover each migration the ship carries (each schema file when it carries none): '#iN' (quoted), the owner's approved step 0 schema decision, named in the body of each PR that carries a migration it covers (the breaking path), or PR#N, a PR merged between the recorded tag and this one, whose author posted a shape review (a comment whose first line names one), whose body names a dump path from \x60~/\x60, and whose diff holds the migrations it covers (the additive path), and with no record until --since names the tag live now.
The ids and hosts come from the environment, else the live dashboard checkout's .env:
${KEYS.join(", ")}.`

if (import.meta.main) {
  const { parseArgs } = await import("node:util")
  const { dirname, join } = await import("node:path")
  const { mkdirSync } = await import("node:fs")
  const { dataDir } = await import("../../../env/src/data-dir")
  const { dashboardCheckout } = await import("../playground/probe")
  const { setting } = await import("../playground/yard")
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { short: "h", type: "boolean" },
      "schema-cleared": { multiple: true, type: "string" },
      since: { type: "string" },
    },
  })
  const [tag] = positionals
  if (values.help || !tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    console.log(USAGE)
    process.exit(values.help ? 0 : 2)
  }
  const repo = join(import.meta.dir, "..", "..", "..", "..")
  const live = dashboardCheckout(repo)
  const read = Object.fromEntries(
    await Promise.all(KEYS.map(async (key) => [key, await setting(key, live)] as const)),
  ) as Record<(typeof KEYS)[number], string | undefined>
  const missing = KEYS.filter((key) => !read[key])
  if (missing.length) {
    console.error(
      `ship:yard: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} unset in the environment and the live dashboard checkout's .env`,
    )
    process.exit(1)
  }
  const git = (args: string[]) => {
    const ran = Bun.spawnSync(["git", "-C", repo, ...args], { stderr: "pipe", stdout: "pipe" })
    if (ran.exitCode !== 0)
      throw new Error(`git ${args.join(" ")}: ${ran.stderr.toString().trim()}`)
    return ran.stdout.toString()
  }
  const record = join(dataDir(), "ops", "yard-tag")
  // the main checkout's worktrees folder, beside the common git dir, so a run from a worktree nests none
  const worktrees = join(
    dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
    ".claude",
    "worktrees",
  )
  const projects = { api: read.YARD_VERCEL_API_PROJECT_ID!, web: read.YARD_VERCEL_WEB_PROJECT_ID! }
  const io: YardIo = {
    changed: async (from, to) => git(["diff", "--name-only", from, to]).split("\n").filter(Boolean),
    deploy: async (project, dir) => {
      const ran = Bun.spawn(["vercel", "deploy", "--prod", "--yes"], {
        cwd: dir,
        env: {
          ...process.env,
          VERCEL_ORG_ID: read.YARD_VERCEL_TEAM_ID!,
          VERCEL_PROJECT_ID: projects[project],
        },
        stderr: "inherit",
        stdout: "inherit",
      })
      return (await ran.exited) === 0
    },
    // a plain remove, which keeps the folder when it holds a change, and says so
    drop: async (dir) => {
      try {
        git(["worktree", "remove", dir])
      } catch (error) {
        console.error(`ship:yard: ${dir} stays: ${(error as Error).message}`)
      }
    },
    err: console.error,
    fetch: async (tags) => {
      git(["fetch", "--quiet", "origin", ...tags.flatMap((tag) => ["tag", tag])])
    },
    // a merge's own diff, pr:merge's squash commit against its one parent; a read that fails covers nothing
    files: async (sha) => {
      try {
        return git(["diff", "--name-only", `${sha}^`, sha])
          .split("\n")
          .filter(Boolean)
      } catch {
        return []
      }
    },
    // a merge in since..tag: the tag holds it and since does not; a read that fails reads as outside
    inRange: async (sha, since, at) => {
      const holds = (ref: string) =>
        Bun.spawnSync(["git", "-C", repo, "merge-base", "--is-ancestor", sha, ref]).exitCode === 0
      return holds(at) && !holds(since)
    },
    launch: () => launchAbove(),
    out: console.log,
    prBody: async (pr) => {
      const ran = Bun.spawnSync(
        ["gh", "pr", "view", String(pr), "--json", "body", "--jq", ".body"],
        {
          cwd: repo,
          stderr: "pipe",
          stdout: "pipe",
        },
      )
      return ran.exitCode === 0 ? ran.stdout.toString() : null
    },
    readRecord: async () => {
      const file = Bun.file(record)
      return (await file.exists()) ? (await file.text()).trim() || undefined : undefined
    },
    status: async (url) =>
      fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) })
        .then((response) => response.status)
        .catch(() => 0),
    // A PR reads its verdict, merge state and body through gh; a decision reads its status through the Inbox reader playground ask uses. Each is parsed by a pure source, and a read that fails returns null, so the step fails closed.
    schemaCleared: async (value) => {
      const pr = /^PR#(\d+)$/.exec(value)
      if (pr) {
        const ran = Bun.spawnSync(
          ["gh", "pr", "view", pr[1]!, "--json", "author,body,comments,mergeCommit,state"],
          { cwd: repo, stderr: "pipe", stdout: "pipe" },
        )
        if (ran.exitCode !== 0) return null
        return prSource(ran.stdout.toString())
      }
      // the decision's status comes through the Inbox reader the live dashboard checkout runs; no checkout, no read, so the step fails closed
      if (!live) return null
      const ran = Bun.spawnSync(["bun", "run", "ask", "get", decisionArg(value)], {
        cwd: live,
        stderr: "pipe",
        stdout: "pipe",
      })
      if (ran.exitCode !== 0) return null
      return decisionSource(ran.stdout.toString())
    },
    touching: async (file, since, at) => {
      try {
        return git(["log", "--format=%s", `${since}..${at}`, "--", file])
          .split("\n")
          .filter(Boolean)
      } catch {
        return null
      }
    },
    worktree: async (at) => {
      const dir = join(worktrees, `yard-ship-${at}`)
      const sha = git(["rev-parse", `${at}^{commit}`]).trim()
      if (!(await Bun.file(join(dir, ".git")).exists()))
        git(["worktree", "add", "--detach", dir, sha])
      else if (git(["-C", dir, "rev-parse", "HEAD"]).trim() !== sha)
        throw new Error(`${dir} holds another commit than ${at}`)
      return dir
    },
    writeRecord: async (at) => {
      mkdirSync(join(dataDir(), "ops"), { recursive: true })
      await Bun.write(record, `${at}\n`)
    },
  }
  process.exit(
    await shipYard(
      { schemaCleared: values["schema-cleared"], since: values.since, tag },
      { api: read.YARD_API_URL!, web: read.YARD_WEB_URL! },
      io,
    ),
  )
}
