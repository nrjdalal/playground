// PreToolUse hook: refuses a web image build on the Mac while the live dashboard's Postgres runs in the same Docker VM, since a tester's web build on 21 Oct took the VM past its memory and its out-of-memory killer took every Postgres in it, the dashboard's included.
import { join } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { fromFactory } from "./role"
import {
  type Env,
  knownVariables,
  lex,
  marked,
  PRINTERS,
  program,
  run,
  type Visit,
  type Word,
} from "./shell"

const DOCKERS = new Set(["docker", "docker-compose"])
// Options that take the next word as their value: docker's own before its subcommand, compose's before build, create, run or up, and those of compose build, create, run and up, one set for all four (so `-p` is run's publish here and compose's project name above).
const DOCKER_TAKES = new Set([
  "--config",
  "--context",
  "--host",
  "--log-level",
  "--tlscacert",
  "--tlscert",
  "--tlskey",
  "-c",
  "-H",
  "-l",
])
const COMPOSE_TAKES = new Set([
  "--ansi",
  "--env-file",
  "--file",
  "--parallel",
  "--profile",
  "--progress",
  "--project-directory",
  "--project-name",
  "-f",
  "-p",
])
const SERVICE_TAKES = new Set([
  "--attach",
  "--build-arg",
  "--builder",
  "--cap-add",
  "--cap-drop",
  "--entrypoint",
  "--env",
  "--env-from-file",
  "--exit-code-from",
  "--label",
  "--memory",
  "--name",
  "--no-attach",
  "--progress",
  "--publish",
  "--pull",
  "--scale",
  "--ssh",
  "--timeout",
  "--user",
  "--volume",
  "--wait-timeout",
  "--workdir",
  "-e",
  "-l",
  "-m",
  "-p",
  "-t",
  "-u",
  "-v",
  "-w",
])
// docker inspect is killed past this, well inside the hook's registered 15s, since a hook past its limit lets the call through and a Docker VM wedged by memory is the case this hook is for; a second later the read gives up even on pipes the killed process left open.
export const INSPECT_TIMEOUT_MS = 8_000
const WEB_DOCKERFILE = "web/next/Dockerfile"
const ROUTE =
  "Build the web image on the box instead: commit, then from the checkout run bash ~/.playground/ops/runner-host/ci.sh web HEAD, which builds HEAD's tree there and never on the Mac. The api image still builds here (docker compose build api)."

// The words after the options that `takes` names, with each value skipped; an attached value (--file=x) is one word.
function positionals(args: Word[], takes: Set<string>): Word[] {
  const out: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (takes.has(v)) k++
    else if (!v.startsWith("-") || v === "-") out.push(args[k])
  }
  return out
}

// The subcommand after docker's own options, and the words after it.
function subcommand(args: Word[], takes: Set<string>): { rest: Word[]; sub?: Word } {
  let k = 0
  while (k < args.length && args[k].value.startsWith("-")) k += takes.has(args[k].value) ? 2 : 1
  return { rest: args.slice(k + 1), sub: args[k] }
}

const help = (args: Word[]) => args.some((a) => a.value === "-h" || a.value === "--help")

// compose build, or a compose up, create or run that builds web's missing image (every one without --no-build, since docker-compose.yml names no image), when it names no service, web among them, or a service the hook cannot read; run's first word is its one service.
function composeBuild(args: Word[]): string | undefined {
  const { rest, sub } = subcommand(args, COMPOSE_TAKES)
  if (!sub || help(rest)) return
  if (!["build", "create", "run", "up"].includes(sub.value)) return
  if (rest.some((a) => a.value === "--no-build")) return
  const words = positionals(rest, SERVICE_TAKES)
  const services = sub.value === "run" ? words.slice(0, 1) : words
  if (services.length === 0 || services.some((s) => s.value === "web" || marked(s.value)))
    return `docker compose ${sub.value} of the web image`
}

// The Dockerfile -f or --file names, attached or as the next word.
function dockerfile(args: Word[]): Word | undefined {
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "-f" || v === "--file") return args[k + 1]
    const attached = /^(?:-f|--file=)(.+)$/.exec(v)?.[1]
    if (attached) return { ...args[k], value: attached }
  }
}

// docker build, buildx build, builder build or image build with web's Dockerfile, or one the hook cannot read.
function imageBuild(args: Word[]): string | undefined {
  if (help(args)) return
  const file = dockerfile(args)
  if (!file) return
  const path = file.value.replace(/^\.\//, "")
  if (marked(path) || path === WEB_DOCKERFILE || path.endsWith(`/${WEB_DOCKERFILE}`))
    return `docker build -f ${WEB_DOCKERFILE}`
}

// What web image build a docker or docker-compose call runs, if any.
function webBuild(args: Word[], compose: boolean): string | undefined {
  if (compose) return composeBuild(args)
  const { rest, sub } = subcommand(args, DOCKER_TAKES)
  if (!sub) return
  if (sub.value === "compose") return composeBuild(rest)
  if (sub.value === "build") return imageBuild(rest)
  if (["builder", "buildx", "image"].includes(sub.value)) {
    const inner = subcommand(rest, new Set(["--builder"]))
    if (inner.sub?.value === "build" || inner.sub?.value === "b") return imageBuild(inner.rest)
  }
}

// The live dashboard's Postgres, as the dashboard supervisor last wrote its name to dashboard-db: a reason to refuse when it runs or when the hook cannot tell, undefined when the named container is stopped or gone.
async function dashboardRuns(
  what: string,
  environment: Record<string, string | undefined>,
): Promise<string | undefined> {
  const cannot = (why: string) =>
    `no-mac-web-build hook refuses ${what}: ${why}, so it cannot tell whether the live dashboard's Postgres runs in this Mac's Docker VM, where a web image build's memory takes the VM's out-of-memory killer to the dashboard's database. ${ROUTE}`
  let name: string
  try {
    name = (
      await Bun.file(join(dataDirOf(environment), "ops", "dashboard", "dashboard-db")).text()
    ).trim()
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT")
      return cannot("there is no dashboard-db in the dashboard supervisor's state folder")
    return cannot(`dashboard-db could not be read (${error})`)
  }
  if (!name)
    return cannot(
      "dashboard-db names no container, which the supervisor writes both when the dashboard has none and when its lookup failed",
    )
  const docker = Bun.which("docker", { PATH: environment.PATH ?? "" })
  if (!docker) return cannot("there is no docker on PATH to ask")
  const p = Bun.spawn([docker, "inspect", "-f", "{{.State.Running}}", name], {
    env: { HOME: environment.HOME, PATH: environment.PATH },
    stderr: "pipe",
    stdout: "pipe",
    timeout: INSPECT_TIMEOUT_MS,
  })
  const answer = await Promise.race([
    Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]),
    new Promise<undefined>((done) =>
      setTimeout(() => done(undefined), INSPECT_TIMEOUT_MS + 1000).unref(),
    ),
  ])
  if (!answer || p.signalCode)
    return cannot(`docker inspect ${name} gave no answer in ${INSPECT_TIMEOUT_MS / 1000}s`)
  const [out, err, code] = answer
  if (code === 0 && out.trim() === "false") return
  if (code !== 0 && /no such (?:object|container)/i.test(err)) return
  if (code === 0 && out.trim() === "true")
    return `no-mac-web-build hook refuses ${what}: the live dashboard's Postgres (${name}) runs in this Mac's Docker VM, and a web image build peaks past the VM's memory, so its out-of-memory killer takes the dashboard's database. ${ROUTE}`
  return cannot(
    `docker inspect ${name} answered ${(err || out).trim().slice(0, 200) || `exit ${code}`}`,
  )
}

const visit: Visit = async (_cmd, { args, first, name }, env) => {
  const judge = async (words: Word[], compose: boolean) => {
    const what = webBuild(words, compose)
    return what ? dashboardRuns(what, env.process) : undefined
  }
  if (DOCKERS.has(name)) return judge(args, name === "docker-compose")
  if (first && (first.unknown || marked(first.value)) && webBuild(args, false))
    return judge(args, false)
  if (PRINTERS.has(name) || name === "ssh") return
  const nested = args.findIndex(
    (a, j) =>
      DOCKERS.has(program(a.value)) &&
      webBuild(args.slice(j + 1), program(a.value) === "docker-compose"),
  )
  if (nested !== -1)
    return judge(args.slice(nested + 1), program(args[nested].value) === "docker-compose")
}

const BARE = (command: string) => command.replace(/[\\'"]/g, "")

// A build or compose named anywhere, since compose up, create and run build a missing image too.
const BUILDS = /build|compose/

// The cheap first look: quotes gone so bu'ild still counts; $'...' can spell any word, so it always counts.
const candidate = (command: string): boolean => command.includes("$'") || BUILDS.test(BARE(command))

const buildCall = (command: string): boolean =>
  /\bdocker/.test(BARE(command)) && BUILDS.test(BARE(command))

async function inspect(raw: string, environment: Record<string, string | undefined>) {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = undefined
  }
  if (typeof payload !== "object" || payload === null)
    return buildCall(raw)
      ? "no-mac-web-build hook could not parse its input, which reads as a docker build, so it refuses the call."
      : undefined
  const { cwd, tool_input: toolInput, tool_name: tool } = payload as Record<string, unknown>
  if (tool !== "Bash") return
  const command = (toolInput as { command?: unknown } | null)?.command
  if (typeof command !== "string" || !candidate(command)) return
  const directory = typeof cwd === "string" ? cwd : undefined
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit)
}

// Fails closed only on a call that reads as a docker build: an error on any other call lets it run, so a parser bug cannot block every Bash command.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch (error) {
    let command = raw
    try {
      const parsed = JSON.parse(raw) as { tool_input?: { command?: unknown } }
      if (typeof parsed.tool_input?.command === "string") command = parsed.tool_input.command
    } catch {}
    if (!buildCall(command)) return
    return `no-mac-web-build hook could not read this call (${error}), which reads as a docker build, so it refuses it. Split it into plain commands and run them again.`
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
