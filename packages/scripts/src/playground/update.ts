// playground update: the release skill's step 5 as one script, then the Dashboard's roll.
import { basename, join } from "node:path"

import { CORE_SKILLS } from "./orgs"
import { unlinked } from "./unlinked"

// A step's argv run to its end; `show` streams its output to the terminal instead of keeping it.
export type Run = (argv: string[], show?: boolean) => Promise<{ code: number; out: string }>

export const spawnRun: Run = async (argv, show = false) => {
  const proc = Bun.spawn(argv, {
    stdio: ["inherit", show ? "inherit" : "pipe", show ? "inherit" : "pipe"],
  })
  const out = show ? "" : await new Response(proc.stdout as ReadableStream).text()
  return { code: await proc.exited, out }
}

const MANIFEST = /(^|\/)(bun\.lock|package\.json)$/
const PACKAGE = /(^|\/)package\.json$/

// What the merge changed asks for: an install for a lockfile or a package.json, a build for a package with a dist (packages/scripts runs from source).
export const updateSteps = (changed: string[]) => ({
  build: changed.some(
    (path) => path.startsWith("packages/") && !path.startsWith("packages/scripts/"),
  ),
  install: changed.some((path) => MANIFEST.test(path)),
  // each changed skill's folder, A to Z by name, which a live session reads the new text from (the release rule)
  skills: [
    ...new Set(
      changed.flatMap((path) =>
        CORE_SKILLS.flatMap((root) => path.match(new RegExp(`^${root}/[^/]+(?=/)`))?.[0] ?? []),
      ),
    ),
  ].sort((a, b) => basename(a).localeCompare(basename(b))),
})

// With a tag, the checkout's main is moved to that release instead, back or on, and the Dashboard, which rolls on its own branch, is left as it is; a plain update later moves it on to origin/main again.
// `done` holds the commit the last finished update reached, or, for a run with no record, the reflog's last fast-forward onto origin/main, else where that run started, so a run after one cut short past its fast-forward still installs, builds and restarts what that merge changed.
export const runUpdate = async (
  repo: string,
  run: Run,
  roll: () => Promise<number>,
  log: (line: string) => void = console.log,
  to?: string,
  done?: string,
): Promise<number> => {
  const git = (...args: string[]) => run(["git", "-C", repo, ...args])
  // a step whose output the terminal shows, named before it runs and again when it fails
  const shown = async ([name, argv]: [string, string[]]): Promise<boolean> => {
    log(`playground update: ${name}`)
    if ((await run(argv, true)).code === 0) return true
    log(`playground update: ${name} failed; fix it and run playground update again`)
    return false
  }
  const head = (await git("rev-parse", "HEAD")).out.trim()
  const recorded =
    done && (await Bun.file(done).exists()) ? (await Bun.file(done).text()).trim() : ""
  // with no record, the reflog's last fast-forward merge onto origin/main is where the checkout's last update, or a hand merge, left it, so a reset made since outside update still reads as changed
  const merged =
    done && !recorded
      ? ((await git("reflog", "--format=%H %gs", "HEAD")).out
          .split("\n")
          .find((line) => line.endsWith(" merge origin/main: Fast-forward"))
          ?.split(" ")[0] ?? "")
      : ""
  if (done && !recorded)
    log(
      merged
        ? `playground update: no ${done} yet, so it reads what changed since the reflog's last fast-forward onto origin/main, ${merged.slice(0, 7)}`
        : `playground update: no ${done} yet and no fast-forward onto origin/main in the reflog, so it reads what changed since HEAD, ${head.slice(0, 7)}`,
    )
  const old =
    recorded && (await git("cat-file", "-e", `${recorded}^{commit}`)).code === 0
      ? recorded
      : merged || head
  if (done && old !== recorded) await Bun.write(done, `${old}\n`)
  const ok = { code: 0, out: "" }
  // a checkout left on another branch, such as one cloned while canary was the default, moves to main at origin/main when its tree is clean, and one on main fast-forwards
  let branch = ""
  const onMain = async () => {
    branch = (await git("branch", "--show-current")).out.trim()
    return branch === "main" ? ok : git("diff", "--quiet", "HEAD")
  }
  const move = async () => {
    if (branch === "main") return git("merge", "--ff-only", "-q", "origin/main")
    log(
      `playground update: on ${branch || "a detached HEAD"}, not main, so moving to main at origin/main`,
    )
    return git("checkout", "-q", "-B", "main", "origin/main")
  }
  const installArgv = [
    process.execPath,
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--cwd",
    repo,
  ]
  const target = to ? `refs/tags/${to}` : "origin/main"
  // every hook that runs its source (all but the bundled PreToolUse guards) and every ops job run this checkout's code the moment it moves, so a target that declares a dependency the checkout has not linked gets its changed manifests and that install first, while the code is still the old commit's (the install step after the move then finds it linked); a target that deletes a manifest, which the old code may still read, or a tree with edits of its own moves first as before
  const prelink = async (): ReturnType<Run> => {
    // a fast-forward stops on a checkout with commits of its own, so its manifests are staged only where it will move; a checkout -B moves over them either way
    const merges = !to && branch === "main"
    if (merges && (await git("merge-base", "--is-ancestor", "HEAD", target)).code !== 0) return ok
    if ((await git("diff", "--quiet", "HEAD")).code !== 0) return ok
    const lines = async (...args: string[]) => (await git(...args)).out.split("\n").filter(Boolean)
    const manifests: Record<string, string> = {}
    for (const path of await lines("ls-tree", "-r", "--name-only", target)) {
      if (!PACKAGE.test(path)) continue
      const shown = await git("show", `${target}:${path}`)
      if (shown.code !== 0) return shown
      manifests[path] = shown.out
    }
    const missing = await unlinked(repo, manifests)
    if (!missing.length) return ok
    const manifestsChanged = (await lines("diff", "--name-only", "HEAD", target)).filter((path) =>
      MANIFEST.test(path),
    )
    const deleted = await lines("diff", "--name-only", "--diff-filter=D", "HEAD", target)
    if (deleted.some((path) => MANIFEST.test(path))) return ok
    log(
      `playground update: install the new commit's dependencies before its code, since it declares ${missing.join(", ")}, which this checkout has not linked`,
    )
    if (manifestsChanged.length) {
      const staged = await git("checkout", target, "--", ...manifestsChanged)
      if (staged.code !== 0) return staged
    }
    const installed = await run(installArgv, true)
    // a failed install puts the old commit's manifests back, a manifest the old commit lacks removed, so the tree is clean for the next run
    if (installed.code !== 0 && manifestsChanged.length)
      await git(
        "restore",
        "-q",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        ...manifestsChanged,
      )
    return installed
  }
  const prelinked =
    "the checkout's files are as they were; fix the install and run playground update again"
  const steps: [string, () => ReturnType<Run>, string?][] = to
    ? [
        ["fetch origin main and its tags", () => git("fetch", "-q", "--tags", "origin", "main")],
        [
          "a checkout with no commits of its own",
          () => git("merge-base", "--is-ancestor", "HEAD", "origin/main"),
        ],
        ["link the new commit's dependencies", prelink, prelinked],
        [`check out ${to}`, () => git("checkout", "-q", "-B", "main", `refs/tags/${to}`)],
      ]
    : [
        ["fetch origin main", () => git("fetch", "-q", "origin", "main")],
        ["a tree with no uncommitted changes, off main", onMain],
        ["link the new commit's dependencies", prelink, prelinked],
        ["merge --ff-only origin/main, or move to main there", move],
      ]
  for (const [name, step, state = "the checkout is as it was"] of steps)
    if ((await step()).code !== 0) {
      log(`playground update: ${name} failed; ${state}`)
      return 1
    }
  // link-skills.sh first, as the release skill's step 5 runs it: every later step and every ops job reads the data folder it links
  const linkSkills: [string, string[]] = [
    "link-skills",
    ["bash", join(repo, "scripts", "link-skills.sh")],
  ]
  if (!(await shown(linkSkills))) return 1
  const changed = (await git("diff", "--name-only", old, "HEAD")).out.split("\n").filter(Boolean)
  const { build, install, skills } = updateSteps(changed)
  if (skills.length)
    log(
      `playground update: skills changed: ${skills.map((folder) => basename(folder)).join(", ")}; a running session's Skill tool serves the copy it started with, so a live session reads each one's files here: ${skills.map((folder) => `${join(repo, folder)}/`).join(", ")}; send each lead these folders, for the lead to have each of its live checkers read the new text there (release)`,
    )
  const turbo = join(repo, "node_modules", ".bin", "turbo")
  const restart = join(repo, "packages", "scripts", "src", "ops-restart", "cli.ts")
  const after: [string, string[]][] = []
  if (install) after.push(["install", installArgv])
  if (build)
    after.push([
      "build",
      [
        "env",
        "NODE_ENV=production",
        "SKIP_ENV_VALIDATION=true",
        turbo,
        "run",
        "build",
        "--filter=./packages/*",
        "--cwd",
        repo,
      ],
    ])
  after.push(["ops-restart", [process.execPath, "--no-env-file", restart, repo, old, "HEAD"]])
  for (const step of after) if (!(await shown(step))) return 1
  if (done) await Bun.write(done, (await git("rev-parse", "HEAD")).out)
  if (!to) return roll()
  log(
    `playground update: at ${to}; the Dashboard rolls on its own, and playground update moves on to origin/main`,
  )
  return 0
}
