// run-slot.sh's docker build reader and runner, on the hooks' own reading (scripts/hooks/docker-build.ts): `kind -- <command>` prints run, each, refuse <why> or none, and `each -- <command>` runs a compose build one service at a time.
import {
  BUILD_TAKES,
  buildName,
  DOCKERS,
  dockerBuild,
  portlessCompose,
  positionals,
} from "../../../scripts/hooks/docker-build"
import { program, type Word } from "../../../scripts/hooks/shell"

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

// The command's words past any env and VAR=x before its program, and the build it runs, if any.
export function read(argv: string[]) {
  let at = 0
  while (at < argv.length && (argv[at] === "env" || ASSIGN.test(argv[at]))) at++
  const name = program(argv[at] ?? "")
  const words: Word[] = argv.slice(at + 1).map((value) => ({ quoted: false, value }))
  const compose = portlessCompose(name, words)
  if (!DOCKERS.has(name) && !compose) return
  const build = compose ? dockerBuild(compose, true) : dockerBuild(words, name === "docker-compose")
  if (!build) return
  // the subcommand's place in argv: its words are the last ones, so it sits just before them
  const sub = argv.length - build.rest.length - 1
  return { build, prefix: argv.slice(0, sub + 1), services: positionals(build.rest, BUILD_TAKES) }
}

// run: one image at a time as it is; each: a compose build that names no service or several, built one at a time; refuse: a build that builds its images at once.
export function kind(argv: string[]): string {
  const found = read(argv)
  if (!found) return "none"
  const { build, services } = found
  // run-slot runs every build in its capped builder (BUILDX_BUILDER), which a builder of the build's own would leave
  if (argv.some((word) => word === "--builder" || /^(?:--builder=|BUILDX_BUILDER=)/.test(word)))
    return `refuse run-slot.sh refuses ${buildName(build)} that names its own builder: run-slot runs every docker build in playground-capped, whose memory cap keeps a build from filling the Docker VM, so leave out --builder and BUILDX_BUILDER`
  if (build.kind === "image") return "run"
  if (build.kind === "bake")
    return "refuse run-slot.sh refuses docker buildx bake, which builds its targets at once in the one Docker VM: build each image with docker build, one run-slot run at a time"
  if (build.sub !== "build")
    return `refuse run-slot.sh refuses ${buildName(build)} without --no-build, which builds each missing image at once in the one Docker VM: build first with run-slot.sh <your name> -- docker compose build, which builds one service at a time, then run docker compose ${build.sub} --no-build`
  return services.length === 1 ? "run" : "each"
}

const at = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")

// Builds each service of a compose build in turn, the named ones or else every one `config --services` lists, and stops at the first that fails.
export async function each(argv: string[]): Promise<number> {
  const found = read(argv)
  if (!found) return 2
  const { build, prefix, services } = found
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
    console.error(`docker-build: building ${service} (${k + 1} of ${list.length}) at ${at()}`)
    const step = Bun.spawnSync([...prefix, ...options, service], {
      stderr: "inherit",
      stdin: "ignore",
      stdout: "inherit",
    })
    console.error(
      `docker-build: ${service} ended rc=${step.exitCode} at ${at()} after ${Math.round((Date.now() - start) / 1000)}s`,
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
