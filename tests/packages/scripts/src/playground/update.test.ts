import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  type Run,
  runUpdate,
  spawnRun,
  updateSteps,
} from "../../../../../packages/scripts/src/playground/update"

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "playground-update-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

describe("updateSteps", () => {
  test("a lockfile or a package.json changed installs", () => {
    expect(updateSteps(["bun.lock"]).install).toBe(true)
    expect(updateSteps(["api/hono/package.json"]).install).toBe(true)
    expect(updateSteps(["README.md", "package.json.bak"]).install).toBe(false)
  })

  test("the skills a merge changed are each one folder, once, A to Z by name, for a live session to read the new text from", () => {
    expect(
      updateSteps([
        "extensions/core/skills/pr/SKILL.md",
        "extensions/core/skills/code-review-loop/scripts/state.py",
        "extensions/core/skills/code-review-loop/SKILL.md",
        "skills/zerostarter/ui-verify/SKILL.md",
        "skills/playground/README.md",
        "skills/playground/inbox/SKILL.md",
        "extensions/core/rules/ci.md",
      ]).skills,
    ).toEqual([
      "extensions/core/skills/code-review-loop",
      "skills/playground/inbox",
      "extensions/core/skills/pr",
      "skills/zerostarter/ui-verify",
    ])
    expect(updateSteps(["README.md"]).skills).toEqual([])
  })

  test("a package with a dist changed builds; packages/scripts runs from source", () => {
    expect(updateSteps(["packages/db/src/schema/claude.ts"]).build).toBe(true)
    expect(updateSteps(["packages/scripts/src/playground/update.ts"]).build).toBe(false)
    expect(updateSteps(["api/hono/src/main.ts"]).build).toBe(false)
  })
})

// A run that answers each argv from the script given, by its first matching word, and records every call.
const fakeRun = (answers: Record<string, { code?: number; out?: string }> = {}) => {
  const calls: string[][] = []
  // the checkout is on main unless the script says otherwise
  const script: typeof answers = { "--show-current": { out: "main\n" }, ...answers }
  const run: Run = async (argv) => {
    calls.push(argv)
    const hit = Object.entries(script).find(([word]) => argv.includes(word))
    return { code: hit?.[1].code ?? 0, out: hit?.[1].out ?? "" }
  }
  return { calls, run }
}

describe("runUpdate", () => {
  const repo = "/repo"
  const quiet = () => {}

  test("nothing changed: fetch, merge, link-skills first (every later step reads the data folder it links), ops-restart, then the roll, with no install or build", async () => {
    const { calls, run } = fakeRun({ "rev-parse": { out: "old\n" } })
    let rolled = 0
    const code = await runUpdate(repo, run, async () => (rolled++, 0), quiet)
    expect(code).toBe(0)
    expect(rolled).toBe(1)
    expect(calls).toEqual([
      ["git", "-C", repo, "rev-parse", "HEAD"],
      ["git", "-C", repo, "fetch", "-q", "origin", "main"],
      ["git", "-C", repo, "branch", "--show-current"],
      ["git", "-C", repo, "merge", "--ff-only", "-q", "origin/main"],
      ["bash", `${repo}/scripts/link-skills.sh`],
      ["git", "-C", repo, "diff", "--name-only", "old", "HEAD"],
      [
        process.execPath,
        "--no-env-file",
        `${repo}/packages/scripts/src/ops-restart/cli.ts`,
        repo,
        "old",
        "HEAD",
      ],
    ])
  })

  test("a merge that changed a skill names it and the folder in the checkout a live session reads it from; one that changed none says nothing of skills", async () => {
    const said: string[] = []
    const { run } = fakeRun({
      diff: { out: "extensions/core/skills/pr/SKILL.md\nskills/zerostarter/dev/SKILL.md\n" },
    })
    expect(
      await runUpdate(
        repo,
        run,
        async () => 0,
        (l) => said.push(l),
      ),
    ).toBe(0)
    expect(said).toContain(
      `playground update: skills changed: dev, pr; a running session's Skill tool serves the copy it started with, so a live session reads each one's files here: ${repo}/skills/zerostarter/dev/, ${repo}/extensions/core/skills/pr/; send each lead these folders, for the lead to have each of its live checkers read the new text there (release)`,
    )
    const quietSaid: string[] = []
    expect(
      await runUpdate(
        repo,
        fakeRun().run,
        async () => 0,
        (l) => quietSaid.push(l),
      ),
    ).toBe(0)
    expect(quietSaid.some((l) => l.includes("skills changed"))).toBe(false)
  })

  test("a changed lockfile and package install and build before the restart", async () => {
    const { calls, run } = fakeRun({ diff: { out: "bun.lock\npackages/db/src/index.ts\n" } })
    expect(await runUpdate(repo, run, async () => 0, quiet)).toBe(0)
    expect(calls).toContainEqual([
      process.execPath,
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--cwd",
      repo,
    ])
    expect(calls).toContainEqual([
      "env",
      "NODE_ENV=production",
      "SKIP_ENV_VALIDATION=true",
      `${repo}/node_modules/.bin/turbo`,
      "run",
      "build",
      "--filter=./packages/*",
      "--cwd",
      repo,
    ])
  })

  test("a run after one cut short past its fast-forward diffs from the commit the last finished update reached, and records the new one once its steps pass", async () => {
    const done = join(scratch, "fake-update-head")
    writeFileSync(done, "old\n")
    const { calls, run } = fakeRun({
      diff: { out: "bun.lock\npackages/db/src/index.ts\n" },
      "rev-parse": { out: "new\n" },
    })
    expect(await runUpdate(repo, run, async () => 0, quiet, undefined, done)).toBe(0)
    expect(calls).toContainEqual(["git", "-C", repo, "diff", "--name-only", "old", "HEAD"])
    expect(calls.some((argv) => argv.includes("install"))).toBe(true)
    expect(calls.some((argv) => argv.includes("build"))).toBe(true)
    expect(calls.find((argv) => argv.includes("--no-env-file"))?.slice(-2)).toEqual(["old", "HEAD"])
    expect(readFileSync(done, "utf8")).toBe("new\n")
  })

  test("a recorded commit the checkout lacks diffs from HEAD, and a failed step leaves the record as it was", async () => {
    const done = join(scratch, "fake-update-head-gone")
    writeFileSync(done, "gone\n")
    const { calls, run } = fakeRun({ "cat-file": { code: 128 }, "rev-parse": { out: "new\n" } })
    expect(await runUpdate(repo, run, async () => 0, quiet, undefined, done)).toBe(0)
    expect(calls).toContainEqual(["git", "-C", repo, "diff", "--name-only", "new", "HEAD"])
    writeFileSync(done, "old\n")
    const failed = fakeRun({ "rev-parse": { out: "new\n" }, "--no-env-file": { code: 1 } })
    expect(await runUpdate(repo, failed.run, async () => 0, quiet, undefined, done)).toBe(1)
    expect(readFileSync(done, "utf8")).toBe("old\n")
  })

  test("a merge that is not a fast-forward stops the update, names the step, and rolls nothing", async () => {
    const { calls, run } = fakeRun({ merge: { code: 128 } })
    const said: string[] = []
    let rolled = false
    const code = await runUpdate(
      repo,
      run,
      async () => ((rolled = true), 0),
      (l) => said.push(l),
    )
    expect(code).toBe(1)
    expect(rolled).toBe(false)
    expect(calls.at(-1)).toContain("merge")
    expect(said.at(-1)).toContain("merge")
  })

  test("--to fetches the tags, checks the checkout has no commits of its own, moves main to the tag, and rolls nothing", async () => {
    const { calls, run } = fakeRun({ "rev-parse": { out: "old\n" } })
    const said: string[] = []
    let rolled = false
    const code = await runUpdate(
      repo,
      run,
      async () => ((rolled = true), 0),
      (l) => said.push(l),
      "v0.0.20",
    )
    expect(code).toBe(0)
    expect(rolled).toBe(false)
    expect(calls.slice(1, 4)).toEqual([
      ["git", "-C", repo, "fetch", "-q", "--tags", "origin", "main"],
      ["git", "-C", repo, "merge-base", "--is-ancestor", "HEAD", "origin/main"],
      ["git", "-C", repo, "checkout", "-q", "-B", "main", "refs/tags/v0.0.20"],
    ])
    expect(said.at(-1)).toStartWith("playground update: at v0.0.20; the Dashboard rolls on its own")
  })

  test("--to on a checkout with commits of its own stops before it moves anything", async () => {
    const { calls, run } = fakeRun({ "merge-base": { code: 1 } })
    expect(await runUpdate(repo, run, async () => 0, quiet, "v0.0.20")).toBe(1)
    expect(calls.some((argv) => argv.includes("checkout"))).toBe(false)
  })

  test("the roll's own code is the update's", async () => {
    const { run } = fakeRun()
    expect(await runUpdate(repo, run, async () => 3, quiet)).toBe(3)
  })
})

test("runUpdate fast-forwards a real checkout onto origin/main and runs its own link-skills and ops-restart", async () => {
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key]
  process.env.GIT_CONFIG_NOSYSTEM = "1"
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env })
  const origin = join(scratch, "origin")
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  const marks = join(scratch, "marks")
  write(join(origin, "scripts", "link-skills.sh"), `echo linked >> ${marks}\n`)
  write(
    join(origin, "packages", "scripts", "src", "ops-restart", "cli.ts"),
    `require("node:fs").appendFileSync(${JSON.stringify(marks)}, "restart " + process.argv.slice(3).join(" ") + "\\n")\n`,
  )
  git(scratch, "init", "-q", "-b", "main", origin)
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "one")
  const checkout = join(scratch, "checkout")
  git(scratch, "clone", "-q", origin, checkout)
  write(join(origin, "README.md"), "two\n")
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "two")
  const head = git(origin, "rev-parse", "HEAD").stdout.toString().trim()
  const old = git(checkout, "rev-parse", "HEAD").stdout.toString().trim()

  expect(
    await runUpdate(
      checkout,
      spawnRun,
      async () => 0,
      () => {},
    ),
  ).toBe(0)
  expect(git(checkout, "rev-parse", "HEAD").stdout.toString().trim()).toBe(head)
  expect(readFileSync(marks, "utf8")).toBe(`linked\nrestart ${old} HEAD\n`)
})

test("a real update cut short after its fast-forward is finished by the next run, which restarts from the commit the last finished update reached", async () => {
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env })
      .stdout.toString()
      .trim()
  const origin = join(scratch, "rerun-origin")
  const marks = join(scratch, "rerun-marks")
  const cut = join(scratch, "rerun-cut")
  const done = join(scratch, "rerun-update-head")
  mkdirSync(join(origin, "scripts"), { recursive: true })
  mkdirSync(join(origin, "packages", "scripts", "src", "ops-restart"), { recursive: true })
  writeFileSync(join(origin, "scripts", "link-skills.sh"), "true\n")
  // an ops-restart that fails while the cut file exists, standing in for an update cut short after its fast-forward
  writeFileSync(
    join(origin, "packages", "scripts", "src", "ops-restart", "cli.ts"),
    `const fs = require("node:fs"); if (fs.existsSync(${JSON.stringify(cut)})) process.exit(1); fs.appendFileSync(${JSON.stringify(marks)}, "restart " + process.argv.slice(3).join(" ") + "\\n")\n`,
  )
  git(scratch, "init", "-q", "-b", "main", origin)
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "one")
  const checkout = join(scratch, "rerun-checkout")
  git(scratch, "clone", "-q", origin, checkout)
  const one = git(checkout, "rev-parse", "HEAD")
  const update = () =>
    runUpdate(
      checkout,
      spawnRun,
      async () => 0,
      () => {},
      undefined,
      done,
    )

  expect(await update()).toBe(0)
  writeFileSync(join(origin, "README.md"), "two\n")
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "two")
  const two = git(origin, "rev-parse", "HEAD")
  writeFileSync(cut, "")
  expect(await update()).toBe(1)
  expect(git(checkout, "rev-parse", "HEAD")).toBe(two)
  rmSync(cut)
  expect(await update()).toBe(0)
  expect(readFileSync(marks, "utf8")).toBe(`restart ${one} HEAD\nrestart ${one} HEAD\n`)
  expect(readFileSync(done, "utf8").trim()).toBe(two)
})

test("runUpdate --to moves a real checkout's main back to a tag, and a plain update moves it on again", async () => {
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env })
      .stdout.toString()
      .trim()
  const origin = join(scratch, "to-origin")
  mkdirSync(join(origin, "scripts"), { recursive: true })
  mkdirSync(join(origin, "packages", "scripts", "src", "ops-restart"), { recursive: true })
  writeFileSync(join(origin, "scripts", "link-skills.sh"), "true\n")
  writeFileSync(join(origin, "packages", "scripts", "src", "ops-restart", "cli.ts"), "\n")
  git(scratch, "init", "-q", "-b", "main", origin)
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "one")
  git(origin, "tag", "v0.0.1")
  const one = git(origin, "rev-parse", "HEAD")
  writeFileSync(join(origin, "README.md"), "two\n")
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "two")
  const two = git(origin, "rev-parse", "HEAD")
  const checkout = join(scratch, "to-checkout")
  git(scratch, "clone", "-q", origin, checkout)

  expect(
    await runUpdate(
      checkout,
      spawnRun,
      async () => 0,
      () => {},
      "v0.0.1",
    ),
  ).toBe(0)
  expect([git(checkout, "rev-parse", "HEAD"), git(checkout, "branch", "--show-current")]).toEqual([
    one,
    "main",
  ])
  expect(
    await runUpdate(
      checkout,
      spawnRun,
      async () => 0,
      () => {},
    ),
  ).toBe(0)
  expect(git(checkout, "rev-parse", "HEAD")).toBe(two)
})

describe("runUpdate on a checkout left on another branch", () => {
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env })
      .stdout.toString()
      .trim()
  // an origin whose main moved on after the clone, and a checkout on canary with a commit main lacks
  const setup = (name: string) => {
    const origin = join(scratch, `${name}-origin`)
    mkdirSync(join(origin, "scripts"), { recursive: true })
    mkdirSync(join(origin, "packages", "scripts", "src", "ops-restart"), { recursive: true })
    writeFileSync(join(origin, "scripts", "link-skills.sh"), "true\n")
    writeFileSync(join(origin, "packages", "scripts", "src", "ops-restart", "cli.ts"), "\n")
    writeFileSync(join(origin, "README.md"), "one\n")
    git(scratch, "init", "-q", "-b", "main", origin)
    git(origin, "add", ".")
    git(origin, "commit", "-q", "-m", "one")
    const checkout = join(scratch, `${name}-checkout`)
    git(scratch, "clone", "-q", origin, checkout)
    git(checkout, "checkout", "-q", "-b", "canary")
    writeFileSync(join(checkout, "canary.txt"), "canary\n")
    git(checkout, "add", ".")
    git(checkout, "commit", "-q", "-m", "canary")
    writeFileSync(join(origin, "README.md"), "two\n")
    git(origin, "commit", "-q", "-am", "two")
    return { checkout, main: git(origin, "rev-parse", "HEAD") }
  }

  test("a clean one moves to main at origin/main and says so", async () => {
    const { checkout, main } = setup("canary-clean")
    const said: string[] = []
    expect(
      await runUpdate(
        checkout,
        spawnRun,
        async () => 0,
        (l) => said.push(l),
      ),
    ).toBe(0)
    expect([git(checkout, "branch", "--show-current"), git(checkout, "rev-parse", "HEAD")]).toEqual(
      ["main", main],
    )
    expect(said).toContain(
      "playground update: on canary, not main, so moving to main at origin/main",
    )
  })

  test("one with uncommitted changes is refused and left as it was", async () => {
    const { checkout } = setup("canary-dirty")
    writeFileSync(join(checkout, "README.md"), "mine\n")
    const head = git(checkout, "rev-parse", "HEAD")
    expect(
      await runUpdate(
        checkout,
        spawnRun,
        async () => 0,
        () => {},
      ),
    ).toBe(1)
    expect([git(checkout, "branch", "--show-current"), git(checkout, "rev-parse", "HEAD")]).toEqual(
      ["canary", head],
    )
    expect(readFileSync(join(checkout, "README.md"), "utf8")).toBe("mine\n")
  })
})

test("a run cut short after its fast-forward with no record yet is finished by the next run, which restarts from where the first one started", async () => {
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env })
      .stdout.toString()
      .trim()
  const origin = join(scratch, "first-origin")
  const marks = join(scratch, "first-marks")
  const cut = join(scratch, "first-cut")
  const done = join(scratch, "first-update-head")
  mkdirSync(join(origin, "scripts"), { recursive: true })
  mkdirSync(join(origin, "packages", "scripts", "src", "ops-restart"), { recursive: true })
  writeFileSync(join(origin, "scripts", "link-skills.sh"), "true\n")
  writeFileSync(
    join(origin, "packages", "scripts", "src", "ops-restart", "cli.ts"),
    `const fs = require("node:fs"); if (fs.existsSync(${JSON.stringify(cut)})) process.exit(1); fs.appendFileSync(${JSON.stringify(marks)}, "restart " + process.argv.slice(3).join(" ") + "\\n")\n`,
  )
  git(scratch, "init", "-q", "-b", "main", origin)
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "one")
  const checkout = join(scratch, "first-checkout")
  git(scratch, "clone", "-q", origin, checkout)
  const one = git(checkout, "rev-parse", "HEAD")
  const update = () =>
    runUpdate(
      checkout,
      spawnRun,
      async () => 0,
      () => {},
      undefined,
      done,
    )
  writeFileSync(join(origin, "README.md"), "two\n")
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "two")
  writeFileSync(cut, "")
  expect(await update()).toBe(1)
  rmSync(cut)
  expect(await update()).toBe(0)
  expect(readFileSync(marks, "utf8")).toBe(`restart ${one} HEAD\n`)
})

test("with no record, a checkout reset past its last fast-forward reads what changed since that fast-forward, and says so", async () => {
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env })
      .stdout.toString()
      .trim()
  const origin = join(scratch, "reset-origin")
  const marks = join(scratch, "reset-marks")
  const done = join(scratch, "reset-update-head")
  mkdirSync(join(origin, "scripts"), { recursive: true })
  mkdirSync(join(origin, "packages", "scripts", "src", "ops-restart"), { recursive: true })
  writeFileSync(join(origin, "scripts", "link-skills.sh"), "true\n")
  writeFileSync(
    join(origin, "packages", "scripts", "src", "ops-restart", "cli.ts"),
    `require("node:fs").appendFileSync(${JSON.stringify(marks)}, "restart " + process.argv.slice(3).join(" ") + "\\n")\n`,
  )
  git(scratch, "init", "-q", "-b", "main", origin)
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "one")
  const checkout = join(scratch, "reset-checkout")
  git(scratch, "clone", "-q", origin, checkout)
  writeFileSync(join(origin, "README.md"), "two\n")
  git(origin, "add", ".")
  git(origin, "commit", "-q", "-m", "two")
  git(checkout, "fetch", "-q", "origin", "main")
  git(checkout, "merge", "--ff-only", "-q", "origin/main")
  const two = git(checkout, "rev-parse", "HEAD")
  writeFileSync(join(origin, "README.md"), "three\n")
  git(origin, "commit", "-q", "-am", "three")
  git(checkout, "fetch", "-q", "origin", "main")
  git(checkout, "reset", "-q", "--keep", "origin/main")
  const lines: string[] = []

  expect(
    await runUpdate(
      checkout,
      spawnRun,
      async () => 0,
      (line) => lines.push(line),
      undefined,
      done,
    ),
  ).toBe(0)
  expect(readFileSync(marks, "utf8")).toBe(`restart ${two} HEAD\n`)
  expect(lines).toContain(
    `playground update: no ${done} yet, so it reads what changed since the reflog's last fast-forward onto origin/main, ${two.slice(0, 7)}`,
  )
  expect(readFileSync(done, "utf8").trim()).toBe(git(checkout, "rev-parse", "HEAD"))
})
