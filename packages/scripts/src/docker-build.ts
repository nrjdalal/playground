// run-slot.sh's docker build reader and runner, on the hooks' own reading (scripts/hooks/docker-build.ts, past shell.ts's wrappers): `kind -- <command>` prints run, each, refuse <why> or none, and `each -- <command>` runs a compose build one service at a time.
import {
  atOnce,
  BUILD_TAKES,
  buildName,
  DOCKERS,
  type DockerBuild,
  dockerBuild,
  portlessCompose,
  positionals,
} from "../../../scripts/hooks/docker-build"
import { parse, program, type Word } from "../../../scripts/hooks/shell"

// The wrappers in front of docker that can drop or change its environment, and with it run-slot's BUILDX_BUILDER: sudo and doas reset it, and env clears, unsets or splits it with its own options.
const RESETS = new Set(["doas", "sudo"])

type Found = { build: DockerBuild; front: string[]; services: Word[] }

// The build the command runs, past the wrappers and assignments the hooks read past, with the place of its program in argv and the words in front of it, if any.
export function read(argv: string[]): Found | undefined {
  const words: Word[] = argv.map((value) => ({ quoted: false, value }))
  const top = parse({ redirects: [], scope: 0, words })
  for (const reading of [top, ...top.also]) {
    const name = program(reading.first?.value ?? "")
    const compose = portlessCompose(name, reading.args)
    if (!DOCKERS.has(name) && !compose) continue
    const build = compose
      ? dockerBuild(compose, true)
      : dockerBuild(reading.args, name === "docker-compose")
    if (!build) continue
    const at = argv.length - reading.args.length - 1
    return { build, front: argv.slice(0, at), services: positionals(build.rest, BUILD_TAKES) }
  }
}

// Why run-slot cannot hold this build to its capped builder, or undefined: a builder of its own, BuildKit turned off (the legacy builder reads no BUILDX_BUILDER), or a wrapper that drops the environment run-slot sets.
function uncapped(argv: string[], { front }: Found): string | undefined {
  if (
    argv.some((word) => word === "--builder" || /^(?:--builder=|BUILDX_BUILDER(?:=|$))/.test(word))
  )
    return "names its own builder"
  if (argv.some((word) => /^DOCKER_BUILDKIT(?:=(?!1$)|$)/.test(word)))
    return "turns BuildKit off, whose legacy builder runs uncapped"
  let wrapper = ""
  for (const word of front) {
    const name = program(word)
    if (RESETS.has(name)) return `runs under ${name}, which resets the environment`
    if (name === "env") wrapper = "env"
    else if (!word.startsWith("-") && !/^[A-Za-z_]\w*=/.test(word)) wrapper = name
    else if (wrapper === "env" && word.startsWith("-"))
      return `runs under env ${word}, which can drop the environment`
  }
}

// run: one image at a time as it is; each: a compose build that names no service or several, built one at a time; refuse: a build that builds its images at once, or one run-slot cannot cap.
export function kind(argv: string[]): string {
  const found = read(argv)
  if (!found) return "none"
  const { build, services } = found
  const why = uncapped(argv, found)
  // run-slot runs every build in its capped builder (BUILDX_BUILDER), which these would leave
  if (why)
    return `refuse run-slot.sh refuses ${buildName(build)} that ${why}: run-slot runs every docker build in playground-capped, whose memory cap keeps a build from filling the Docker VM, so run it bare, with no --builder, BUILDX_BUILDER, DOCKER_BUILDKIT, sudo, doas or env option in front`
  const fix = atOnce(build)
  if (fix) return `refuse run-slot.sh refuses ${buildName(build)}: ${fix}`
  if (build.kind === "image" || services.length === 1) return "run"
  if (subAt(argv, build) === undefined)
    return `refuse run-slot.sh refuses ${buildName(build)} it cannot split by service: name one service, or run it with no env -S in front`
  return "each"
}

// Where the subcommand sits in argv, when argv ends in its words as typed, so each can run argv up to it once per service; env -S's split words leave it unknown.
function subAt(argv: string[], build: DockerBuild): number | undefined {
  const sub = argv.length - build.rest.length - 1
  if (argv[sub] !== build.sub) return
  return build.rest.every((word, k) => argv[sub + 1 + k] === word.value) ? sub : undefined
}

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")

// Builds each service of a compose build in turn, the named ones or else every one `config --services` lists, and stops at the first that fails.
export async function each(argv: string[]): Promise<number> {
  const found = read(argv)
  if (!found) return 2
  const { build, services } = found
  const sub = subAt(argv, build)
  if (sub === undefined) return 2
  const prefix = argv.slice(0, sub + 1)
  const named = new Set(services)
  const options = build.rest.filter((word) => !named.has(word)).map((word) => word.value)
  let list = services.map((word) => word.value)
  if (list.length === 0) {
    const config = Bun.spawnSync([...prefix.slice(0, -1), "config", "--services"], {
      stderr: "inherit",
      stdin: "ignore",
    })
    if (config.exitCode !== 0) return config.exitCode ?? 1
    list = config.stdout.toString().split("\n").filter(Boolean)
  }
  for (const [k, service] of list.entries()) {
    const start = Date.now()
    console.error(`docker-build: building ${service} (${k + 1} of ${list.length}) at ${stamp()}`)
    const step = Bun.spawnSync([...prefix, ...options, service], {
      stderr: "inherit",
      stdin: "ignore",
      stdout: "inherit",
    })
    console.error(
      `docker-build: ${service} ended rc=${step.exitCode} at ${stamp()} after ${Math.round((Date.now() - start) / 1000)}s`,
    )
    if (step.exitCode !== 0) return step.exitCode ?? 1
  }
  return 0
}

if (import.meta.main) {
  const [mode, dash, ...argv] = process.argv.slice(2)
  if (dash !== "--" || (mode !== "kind" && mode !== "each")) {
    console.error("usage: docker-build.ts kind|each -- <command>")
    process.exit(2)
  }
  if (mode === "kind") console.log(kind(argv))
  else process.exit(await each(argv))
}
