// playground update: the release skill's step 5 as one script, then the Dashboard's roll.
import { basename, join } from "node:path"

import { CORE_SKILLS } from "./orgs"

// A step's argv run to its end; `show` streams its output to the terminal instead of keeping it.
export type Run = (argv: string[], show?: boolean) => Promise<{ code: number; out: string }>

export const spawnRun: Run = async (argv, show = false) => {
  const proc = Bun.spawn(argv, {
    stdio: ["inherit", show ? "inherit" : "pipe", show ? "inherit" : "pipe"],
  })
  const out = show ? "" : await new Response(proc.stdout as ReadableStream).text()
  return { code: await proc.exited, out }
}

// What the merge changed asks for: an install for a lockfile or a package.json, a build for a package with a dist (packages/scripts runs from source).
export const updateSteps = (changed: string[]) => ({
  build: changed.some(
    (path) => path.startsWith("packages/") && !path.startsWith("packages/scripts/"),
  ),
  install: changed.some((path) => /(^|\/)(bun\.lock|package\.json)$/.test(path)),
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
// `done` holds the commit the last finished update reached, so a run after one cut short past its fast-forward still installs, builds and restarts what that merge changed.
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
  const old =
    recorded && (await git("cat-file", "-e", `${recorded}^{commit}`)).code === 0 ? recorded : head
  // a checkout left on another branch, such as one cloned while canary was the default, moves to main when its tree is clean, so the merge below lands on main
  const onMain = async () => {
    const branch = (await git("branch", "--show-current")).out.trim()
    if (branch === "main") return { code: 0, out: "" }
    const clean = await git("diff", "--quiet", "HEAD")
    if (clean.code !== 0) return clean
    log(
      `playground update: on ${branch || "a detached HEAD"}, not main, so moving to main at origin/main`,
    )
    return git("checkout", "-q", "-B", "main", "origin/main")
  }
  const steps: [string, () => ReturnType<Run>][] = to
    ? [
        ["fetch origin main and its tags", () => git("fetch", "-q", "--tags", "origin", "main")],
        [
          "a checkout with no commits of its own",
          () => git("merge-base", "--is-ancestor", "HEAD", "origin/main"),
        ],
        [`check out ${to}`, () => git("checkout", "-q", "-B", "main", `refs/tags/${to}`)],
      ]
    : [
        ["fetch origin main", () => git("fetch", "-q", "origin", "main")],
        ["move to main, on a tree with no uncommitted changes", onMain],
        ["merge --ff-only origin/main", () => git("merge", "--ff-only", "-q", "origin/main")],
      ]
  for (const [name, step] of steps)
    if ((await step()).code !== 0) {
      log(`playground update: ${name} failed; the checkout is as it was`)
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
      `playground update: skills changed: ${skills.map((folder) => basename(folder)).join(", ")}; a running session's Skill tool serves the copy it started with, so a live session reads each one's files here: ${skills.map((folder) => `${join(repo, folder)}/`).join(", ")}`,
    )
  const turbo = join(repo, "node_modules", ".bin", "turbo")
  const restart = join(repo, "packages", "scripts", "src", "ops-restart", "cli.ts")
  const after: [string, string[]][] = []
  if (install)
    after.push([
      "install",
      [process.execPath, "install", "--frozen-lockfile", "--ignore-scripts", "--cwd", repo],
    ])
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
