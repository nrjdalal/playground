import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-raw-vercel"

let scratch = ""

// Made-up sessions: the Ops lead, the Builder (a lead of another kind) and a worker, each placed by its registry name and the roster's kind.
type Session = "builder" | "ops" | "worker"
const ROLE: Record<Session, string> = { builder: "lead", ops: "lead", worker: "worker" }

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "no-raw-vercel-"))
  await mkdir(join(scratch, "config", "sessions"), { recursive: true })
  await Bun.write(
    join(scratch, "data", "roster.json"),
    JSON.stringify({
      agents: [
        { kind: "builder", name: "builder", status: "working" },
        { kind: "ops", name: "ops", status: "working" },
        { kind: "worker", name: "abc-worker", status: "working" },
      ],
    }),
  )
  for (const [session, name] of [
    ["s-builder", "builder"],
    ["s-ops", "ops"],
    ["s-worker", "abc-worker"],
  ])
    await Bun.write(
      join(scratch, "config", "sessions", `${session}.json`),
      JSON.stringify({ name, sessionId: session }),
    )
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

const as = (session: Session, command: string) =>
  check(
    JSON.stringify({
      cwd: scratch,
      hook_event_name: "PreToolUse",
      session_id: `s-${session}`,
      tool_input: { command },
      tool_name: "Bash",
    }),
    {
      CLAUDE_CONFIG_DIR: join(scratch, "config"),
      PLAYGROUND_DATA_DIR: join(scratch, "data"),
      PLAYGROUND_ROLE: ROLE[session],
    },
  )

const REFUSED = "no-raw-vercel hook refuses"

// Each moves what production serves: a production deploy, a redeploy that keeps the original's environment, a promote, a rollback, an alias and a rolling release.
const PRODUCTION: [string, string][] = [
  ["a bare production deploy", "vercel --prod"],
  ["a production deploy", "vercel deploy --prod"],
  ["the vc name", "vc deploy --prod"],
  ["a capitalised program", "Vercel deploy --prod"],
  ["the environment as the next word", "vercel deploy --environment production"],
  ["the environment attached", "vercel deploy --environment=production"],
  ["the old target flag", "vercel deploy --target=production"],
  ["the target as the next word", "vercel --target production"],
  ["a path deploy", "vercel ./web --prod"],
  ["a prebuilt deploy", "vercel deploy --prebuilt --prod --yes"],
  ["a global option first", "vercel --cwd web deploy --prod"],
  ["a scope first", "vercel -S acme-labs deploy --prod"],
  ["an environment built at run time", 'vercel deploy --environment "$E"'],
  ["a flag built at run time", 'vercel deploy "$FLAG"'],
  ["a redeploy into the original's environment", "vercel redeploy demo-abc.vercel.app"],
  ["a redeploy to production", "vercel redeploy demo-abc.vercel.app -e production"],
  ["a promote", "vercel promote demo-abc.vercel.app"],
  ["a rollback", "vercel rollback"],
  ["a rollback to a deployment", "vercel rollback demo-abc.vercel.app --yes"],
  ["an alias set", "vercel alias set demo-abc.vercel.app demo.example.com"],
  ["an alias by its default", "vercel alias demo-abc.vercel.app demo.example.com"],
  ["a rolling release start", "vercel rolling-release start --deployment=dpl_123"],
  ["a rolling release approve", "vercel rolling-release approve"],
  ["an alias set by ln", "vercel ln set demo-abc.vercel.app demo.example.com"],
  ["an alias by ln's default", "vercel ln demo-abc.vercel.app demo.example.com"],
  ["an alias set by aliases", "vercel aliases set demo-abc.vercel.app demo.example.com"],
  ["an alias by aliases' default", "vercel aliases demo-abc.vercel.app demo.example.com"],
  ["a rolling release start by rr", "vercel rr start --deployment=dpl_1"],
  ["a rolling release approve by rr", "vercel rr approve"],
  ["a promote after the team option", "vercel --team acme promote demo-abc.vercel.app"],
  ["a production deploy after deploy's force letter", "vercel deploy -f --prod"],
  ["a bare production deploy after the force letter", "vercel -f --prod"],
  ["a production target after the force letter", "vercel deploy -f --target production"],
  [
    "a production deploy after an option the hook does not know",
    "vercel deploy --made-up x --prod",
  ],
]

// Each writes the project's secrets to disk, prints them, or hands them to a command.
const SECRETS: [string, string][] = [
  ["an env pull", "vercel env pull"],
  ["an env pull of production", "vercel env pull .env.production --environment production"],
  ["a decrypted env list", "vercel env ls --json"],
  ["a decrypted env list by its long name", "vercel env list --json"],
  ["a pull", "vercel pull"],
  ["a pull of production", "vercel pull --environment=production"],
  ["an env run", "vercel env run -- printenv"],
  ["a link", "vercel link"],
  ["a link to a project", "vercel link --yes --project demo"],
  ["an integration add that pulls the env", "vercel integration add neon"],
  ["a subcommand built at run time", 'vercel "$CMD"'],
  ["an env subcommand built at run time", 'vercel env "$SUB"'],
  ["an api read of the env", "vercel api /v9/projects/demo/env"],
  ["an api read of the env decrypted", 'vercel api "/v9/projects/demo/env?decrypt=true"'],
  ["an api read of one env variable", "vercel api /v1/projects/demo/env/abc"],
  ["an api POST", "vercel api /v13/deployments -X POST -F name=demo"],
  ["an api method attached", "vercel api /v9/projects/demo --method=PATCH"],
  ["an api body, which POSTs", "vercel api /v10/projects -F name=demo"],
  ["an api string field", "vercel api /v10/projects -f name=demo"],
  ["an api input file", "vercel api /v9/projects/demo --input body.json"],
  ["an api method built at run time", 'vercel api /v2/user -X "$M"'],
  ["an api endpoint built at run time", 'vercel api "$P"'],
  ["an install, which adds an integration", "vercel install neon"],
  ["an install by its letter", "vercel i neon"],
  ["an integration install", "vercel integration install neon"],
  ["an env list in json format", "vercel env ls --format json"],
  ["an env list in json format attached", "vercel env ls --format=json"],
  ["an env list in json format by its letter", "vercel env ls -F json"],
  ["an env list in json format in capitals", "vercel env list --format JSON --project demo"],
  ["an env pull after the team letter", "vercel -T acme env pull"],
  ["a link after the api option", "vercel --api https://api.example.com link"],
  ["a build", "vercel build --yes"],
  ["a production build", "vercel build --prod --yes --project demo"],
  ["an api GET with a field", "vercel api /v2/user -X GET -F a=b"],
  ["an api GET with a string field", "vercel api /v2/user -X GET -f a=b"],
  ["an api GET with an input file", "vercel api /v2/user -X GET --input x"],
]

// The prefixes a call can come behind.
const PREFIXES: [string, string][] = [
  ["a cd", "cd web && vercel --prod"],
  ["an env wrapper", "env VERCEL_ORG_ID=team_x vercel --prod"],
  ["an assignment", "VERCEL_ORG_ID=team_x vercel env pull"],
  ["bun x", "bun x vercel --prod"],
  ["bunx at a version", "bunx vercel@latest deploy --prod"],
  ["npx", "npx vercel link"],
  ["a -c script", "bash -c 'vercel env pull'"],
  ["a pipe", "yes | vercel deploy --prod"],
  ["xargs, whose words the hook cannot read", "echo --prod | xargs vercel"],
  ["a program in a variable on a line naming vercel", "V=vercel; $V --prod"],
]

describe("a factory session's Vercel call that moves production or reads its secrets is refused", () => {
  test.each([...PRODUCTION, ...SECRETS, ...PREFIXES])("for a worker: %s", async (_, command) => {
    expect(await as("worker", command)).toContain(REFUSED)
  })

  test.each(PRODUCTION)("for a lead that is not Ops: %s", async (_, command) => {
    expect(await as("builder", command)).toContain(REFUSED)
  })

  test.each([
    ["an env pull xargs feeds", "echo env pull | xargs vercel"],
    ["a link xargs feeds", "echo link | xargs vercel"],
    ["an env pull xargs feeds after a production flag", "echo env pull | xargs vercel --prod"],
    ["a subcommand in xargs' replace string", "echo env | xargs -I{} vercel {} pull"],
    ["a link in xargs' replace string", "echo link | xargs -I{} vercel {}"],
    ["a subcommand in a spaced replace string", "echo env | xargs -I % vercel % pull"],
    ["a subcommand in BSD xargs' -J string", "echo env | xargs -J % vercel % pull"],
    ["a production deploy xargs feeds", "echo demo | xargs vercel deploy --prod"],
  ])("for the Ops lead, words xargs feeds: %s", async (_, command) => {
    expect(await as("ops", command)).toContain(REFUSED)
  })

  test.each(SECRETS)("for the Ops lead too: %s", async (_, command) => {
    expect(await as("ops", command)).toContain(REFUSED)
  })

  test("the reason names Ops' ship as the route to production", async () => {
    expect(await as("worker", "vercel --prod")).toContain("ship:merge")
  })
})

describe("the Ops lead's production moves", () => {
  test.each(PRODUCTION.filter(([, command]) => !command.includes("$")))(
    "pass: %s",
    async (_, command) => {
      expect(await as("ops", command)).toBeUndefined()
    },
  )

  test.each([
    ["with the role as a prefix", "PLAYGROUND_ROLE=lead vercel --prod"],
    ["with the role exported", "export PLAYGROUND_ROLE=lead; vercel --prod"],
    ["with the role through env", "env PLAYGROUND_ROLE=lead vercel --prod"],
    [
      "with the role in a -c script",
      "bash -c 'PLAYGROUND_ROLE=lead vercel promote demo-abc.vercel.app'",
    ],
    ["after a source", "source ./roles.sh && vercel --prod"],
    ["after a dot", ". ./roles.sh && vercel rollback"],
  ])("lose the pass %s", async (_, command) => {
    expect(await as("ops", command)).toContain(REFUSED)
  })
})

describe("a read, a preview and a help run", () => {
  test.each([
    ["whoami", "vercel whoami"],
    ["ls", "vercel ls"],
    ["list of production", "vercel list --environment production"],
    ["inspect", "vercel inspect demo-abc.vercel.app"],
    ["logs", "vercel logs demo-abc.vercel.app"],
    ["logs of production", "vercel logs -e production"],
    ["logs of production by the log alias", "vercel log --environment production"],
    [
      "logs with more options than the readings bound",
      "vercel logs demo --since 1h --until 2h --limit 5 --json --follow --level error --query x",
    ],
    ["an env list in table format", "vercel env ls --format table"],
    ["a redeploy to preview by its letter", "vercel redeploy demo-abc.vercel.app -e preview"],
    ["an integration list", "vercel integration ls"],
    ["a bare preview deploy", "vercel"],
    ["a preview deploy", "vercel deploy --yes"],
    ["a preview by its environment", "vercel deploy --environment preview"],
    ["a redeploy to preview", "vercel redeploy demo-abc.vercel.app --environment preview"],
    ["an env list", "vercel env ls"],
    ["an integration add that keeps the env off disk", "vercel integration add neon --no-env-pull"],
    [
      "VERCEL.md's api read",
      "vercel api --raw /v6/deployments?projectId=demo | grep -o '{.*' | jq",
    ],
    ["an api read", "vercel api /v2/user"],
    ["an api GET named", "vercel api /v9/projects/demo -X GET"],
    ["an api endpoint list", "vercel api list"],
    ["a promote status", "vercel promote status"],
    ["a rollback status", "vercel rollback status demo"],
    ["an alias list", "vercel alias list"],
    ["a rolling release inspect", "vercel rolling-release inspect"],
    ["help", "vercel --help"],
    ["a subcommand's help", "vercel deploy --prod --help"],
    ["the version", "vercel --version"],
    ["an echo", "echo vercel --prod"],
    ["a commit message", 'git commit -m "vercel --prod"'],
    ["a program in a variable beside a file named Vercel", '"$BUN" test tests/x/VERCEL.test.ts'],
  ])("for a worker: %s", async (_, command) => {
    expect(await as("worker", command)).toBeUndefined()
  })
})
