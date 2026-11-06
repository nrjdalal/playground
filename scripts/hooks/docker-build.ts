// The docker and docker-compose calls that build an image, read once for the hooks (no-mac-web-build, no-unslotted-run) and for run-slot.sh (packages/scripts/src/docker-build.ts), so each reads the same forms.
import { program, type Word } from "./shell"

export const DOCKERS = new Set(["docker", "docker-compose"])
// Options that take the next word as their value: docker's own before its subcommand, compose's before build, create, run or up, and those of compose build, create, run and up, one set for all four (so `-p` is run's publish here and compose's project name above).
export const DOCKER_TAKES = new Set([
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
export const COMPOSE_TAKES = new Set([
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
export const SERVICE_TAKES = new Set([
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
// compose build's own options that take the next word as their value (docker compose build --help), where --pull is a flag
export const BUILD_TAKES = new Set([
  "--build-arg",
  "--builder",
  "--memory",
  "--provenance",
  "--sbom",
  "--ssh",
  "-m",
])

// The words after the options that `takes` names, with each value skipped; an attached value (--file=x) is one word.
export function positionals(args: Word[], takes: Set<string>): Word[] {
  const out: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (takes.has(v)) k++
    else if (!v.startsWith("-") || v === "-") out.push(args[k])
  }
  return out
}

// The subcommand after docker's own options, and the words after it.
export function subcommand(args: Word[], takes: Set<string>): { rest: Word[]; sub?: Word } {
  let k = 0
  while (k < args.length && args[k].value.startsWith("-")) k += takes.has(args[k].value) ? 2 : 1
  return { rest: args.slice(k + 1), sub: args[k] }
}

export const help = (args: Word[]) => args.some((a) => a.value === "-h" || a.value === "--help")

// An image build: `image` for docker build and its aliases (one image), `bake` for bake (docker bake, buildx bake), and `compose` for compose build, a compose up, create or run that builds a missing image (each one without --no-build), or a compose watch, which builds and rebuilds its images as files change, with the subcommand and the words after it.
export type DockerBuild = { kind: "bake" | "compose" | "image"; rest: Word[]; sub: string }

function composeBuild(args: Word[]): DockerBuild | undefined {
  const found = subcommand(args, COMPOSE_TAKES)
  // compose alpha's experimental subcommands, watch among them on an older compose
  const { rest, sub } = found.sub?.value === "alpha" ? subcommand(found.rest, new Set()) : found
  if (!sub || help(rest)) return
  if (sub.value === "watch") return { kind: "compose", rest, sub: "watch" }
  if (!["build", "create", "run", "up"].includes(sub.value)) return
  if (rest.some((a) => a.value === "--no-build")) return
  return { kind: "compose", rest, sub: sub.value }
}

// The image build a docker or docker-compose call runs, if any; --help runs none.
export function dockerBuild(args: Word[], compose: boolean): DockerBuild | undefined {
  if (compose) return composeBuild(args)
  const { rest, sub } = subcommand(args, DOCKER_TAKES)
  if (!sub) return
  if (sub.value === "compose") return composeBuild(rest)
  const image = (words: Word[]): DockerBuild | undefined =>
    help(words) ? undefined : { kind: "image", rest: words, sub: "build" }
  if (sub.value === "build") return image(rest)
  // docker bake, the docker CLI's own alias for buildx bake
  if (sub.value === "bake") return help(rest) ? undefined : { kind: "bake", rest, sub: "bake" }
  // the docker CLI forwards builder whole to buildx, so builder reads as buildx: build or b one image, bake or its alias f a bake
  if (["builder", "buildx", "image"].includes(sub.value)) {
    const inner = subcommand(rest, new Set(["--builder"]))
    if (inner.sub?.value === "build" || inner.sub?.value === "b") return image(inner.rest)
    if (
      sub.value !== "image" &&
      ["bake", "f"].includes(inner.sub?.value ?? "") &&
      !help(inner.rest)
    )
      return { kind: "bake", rest: inner.rest, sub: "bake" }
  }
}

// The build as a refusal or a fix names it.
export const buildName = (build: DockerBuild): string =>
  build.kind === "image"
    ? "a docker build"
    : build.kind === "bake"
      ? "docker buildx bake"
      : `docker compose ${build.sub}`

// Why a build that builds its images at once is refused even under run-slot, with its fix, or undefined for one run-slot runs: a bake builds its targets at once, and a compose up, create, run or watch each missing image at once.
export function atOnce(build: DockerBuild): string | undefined {
  if (build.kind === "bake")
    return "it builds its targets at once in the one Docker VM: build each image with docker build, one run-slot run at a time"
  if (build.kind === "image" || build.sub === "build") return
  const what =
    build.sub === "watch"
      ? "it builds and rebuilds its images"
      : "without --no-build it builds each missing image"
  return `${what} at once in the one Docker VM: build first with run-slot.sh <your name> -- docker compose build, which builds one service at a time, then start it with docker compose up --no-build`
}

// The compose words a portless call passes on to docker compose (`portless compose up`, portless 0.16's compose support), by name or through bunx, npx or bun x past their options and a versioned portless@x, else undefined.
export function portlessCompose(name: string, args: Word[]): Word[] | undefined {
  let words = args
  if (name === "bun") {
    if (args[0]?.value !== "x") return
    words = args.slice(1)
  }
  if (name !== "portless") {
    if (!["bun", "bunx", "npx"].includes(name)) return
    let k = 0
    while (k < words.length && words[k].value.startsWith("-"))
      k += ["--package", "-p"].includes(words[k].value) ? 2 : 1
    if (program(words[k]?.value ?? "").replace(/@.*$/, "") !== "portless") return
    words = words.slice(k + 1)
  }
  return words[0]?.value === "compose" ? words.slice(1) : undefined
}
