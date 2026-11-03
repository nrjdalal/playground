import { describe, expect, test } from "bun:test"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { isBuiltin } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BUNDLED,
  entries,
  FIX,
  HOOKS,
  ROOT,
  stale,
} from "../../../../packages/scripts/src/hooks-bundle"

test("every bundle in scripts/hooks/bundled is what a fresh build of its source writes", async () => {
  const drift = await stale(ROOT)
  expect(drift, `stale: ${drift.join(", ")}; ${FIX}`).toEqual([])
})

test("scripts/hooks/bundled holds one bundle per PreToolUse guard and per worker, and nothing else", async () => {
  const names = (await entries(ROOT)).map((name) => `${name}.js`).sort()
  expect(readdirSync(join(ROOT, BUNDLED)).sort()).toEqual(names)
})

// A guard that imports another guard keeps that guard's main block live when both are entry points of one build, and the imported block then reads stdin first and judges the call by its own rules.
test("each guard bundle runs one main block, its own, and the worker bundle none", async () => {
  for (const name of await entries(ROOT)) {
    const text = readFileSync(join(ROOT, BUNDLED, `${name}.js`), "utf8")
    const blocks = text.match(/\bif \(import\.meta\.main\)/g)?.length ?? 0
    expect({ blocks, name }).toEqual({ blocks: name.endsWith("-worker") ? 0 : 1, name })
  }
})

// Each call goes in as stdin to the bundle as its wrapper runs it and to its source, which judge it as data; the forms are this test's own, none from the refused-forms fixture.
describe("a bundle run as its wrapper runs it gives its source's verdict", () => {
  const worktree = join(ROOT, ".claude", "worktrees", "a")
  const call = (cwd: string, command: string) =>
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      tool_input: { command },
      tool_name: "Bash",
    })
  test.each([
    [
      "no-ours-merge",
      "an ours merge",
      call(ROOT, "git merge -s ours origin/canary"),
      2,
      "no-ours-merge hook refuses",
    ],
    ["no-ours-merge", "a stash, which no-stash judges", call(ROOT, "git stash"), 0, ""],
    [
      "no-unslotted-run",
      "a worktree's suite with no slot",
      call(worktree, `bun run --cwd ${worktree} test`),
      2,
      "no-unslotted-run hook refuses",
    ],
  ])("%s on %s", async (name, _, raw, code, says) => {
    for (const file of [join(BUNDLED, `${name}.js`), join(HOOKS, `${name}.ts`)]) {
      const proc = Bun.spawn(["bun", "--no-env-file", file], {
        cwd: ROOT,
        env: { ...process.env, PLAYGROUND_REPO: "", PLAYGROUND_ROLE: "worker" },
        stderr: "pipe",
        stdin: new Blob([raw]),
        stdout: "pipe",
      })
      const exit = await proc.exited
      const stderr = await new Response(proc.stderr).text()
      expect({ code: exit, file, refusal: stderr.includes(says) }).toEqual({
        code,
        file,
        refusal: true,
      })
      if (!says) expect(stderr).toBe("")
    }
  })
})

// A main checkout made in a scratch folder outside any repo, as the factory's sits, holding the bundle: with PLAYGROUND_REPO unset, as cmux restores a session, the bundle finds that checkout from its own folder, as the source does from its own, so an ask note there runs and the same note from another folder is refused.
test("no-desktop-owner-app's bundle finds the main checkout it sits in, with PLAYGROUND_REPO unset", async () => {
  const main = realpathSync(mkdtempSync(join(tmpdir(), "hooks-bundle-main-")))
  expect(Bun.spawnSync(["git", "-C", main, "init", "-q"]).exitCode).toBe(0)
  mkdirSync(join(main, BUNDLED), { recursive: true })
  mkdirSync(join(main, "api", "hono", "src", "bin"), { recursive: true })
  mkdirSync(join(main, "elsewhere"))
  writeFileSync(join(main, "scripts", "spawn.sh"), "#!/bin/sh\n")
  writeFileSync(join(main, "api", "hono", "src", "bin", "dashboard-ask.ts"), "")
  writeFileSync(
    join(main, "package.json"),
    `${JSON.stringify({ scripts: { ask: "bun api/hono/src/bin/dashboard-ask.ts" } })}\n`,
  )
  copyFileSync(
    join(ROOT, BUNDLED, "no-desktop-owner-app.js"),
    join(main, BUNDLED, "no-desktop-owner-app.js"),
  )
  const note = (cwd: string) =>
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      tool_input: { command: `bun run ask x "note; agent-desktop 1.0 ok"` },
      tool_name: "Bash",
    })
  const run = async (cwd: string) => {
    const proc = Bun.spawn(
      ["bun", "--no-env-file", join(main, BUNDLED, "no-desktop-owner-app.js")],
      {
        cwd: main,
        env: { ...process.env, PLAYGROUND_REPO: "", PLAYGROUND_ROLE: "worker" },
        stderr: "pipe",
        stdin: new Blob([note(cwd)]),
        stdout: "pipe",
      },
    )
    return { code: await proc.exited, stderr: await new Response(proc.stderr).text() }
  }
  expect(await run(main)).toEqual({ code: 0, stderr: "" })
  const elsewhere = await run(join(main, "elsewhere"))
  expect(elsewhere.code).toBe(2)
  expect(elsewhere.stderr).toContain("no-desktop-owner-app")
})

// A bundle that imports only Bun's and Node's own modules reaches no node_modules, so a missing or damaged install cannot crash it.
test("every bundle imports nothing but Bun's and Node's own modules", () => {
  for (const file of readdirSync(join(ROOT, BUNDLED))) {
    const text = readFileSync(join(ROOT, BUNDLED, file), "utf8")
    const specifiers = [
      ...text.matchAll(/^\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/gm),
      ...text.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
      ...text.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]!)
    expect(
      specifiers.filter((s) => !isBuiltin(s) && !s.startsWith("bun:") && s !== "bun"),
      file,
    ).toEqual([])
  }
})

// Each bundle copied to a folder with no node_modules above it, as a damaged install leaves the checkout, starts and allows an empty call.
test("every bundled guard runs on {} with no node_modules reachable and exits 0", async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "hooks-bundle-")))
  const bundled = join(scratch, BUNDLED)
  mkdirSync(bundled, { recursive: true })
  for (const file of readdirSync(join(ROOT, BUNDLED)))
    copyFileSync(join(ROOT, BUNDLED, file), join(bundled, file))
  expect(() => Bun.resolveSync("zod", bundled)).toThrow()
  for (const name of await entries(ROOT)) {
    if (name.endsWith("-worker")) continue
    const proc = Bun.spawn(["bun", "--no-env-file", join(bundled, `${name}.js`)], {
      cwd: scratch,
      env: { ...process.env, PLAYGROUND_ROLE: "" },
      stderr: "pipe",
      stdin: new Blob(["{}"]),
      stdout: "pipe",
    })
    const code = await proc.exited
    expect({ code, name, stderr: await new Response(proc.stderr).text() }).toEqual({
      code: 0,
      name,
      stderr: "",
    })
  }
}, 60_000)

// A scratch checkout holding hooks-bundle's own source and one guard, so `bun run hooks:bundle` runs there as it does in the repo, its ROOT that checkout; a merge left uncommitted puts MERGE_HEAD in place, as a merge of canary that stops for its conflicts does.
describe("hooks:bundle during a merge (#673)", () => {
  const env = {
    ...process.env,
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_AUTHOR_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
  }
  const checkout = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hooks-bundle-merge-")))
    const git = (...args: string[]) => {
      const proc = Bun.spawnSync(["git", "-C", root, ...args], { env })
      if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
    }
    for (const file of ["hooks-bundle.ts", "ops-tick/guard-probe.ts", "write-atomic.ts"]) {
      const to = join(root, "packages", "scripts", "src", file)
      mkdirSync(join(to, ".."), { recursive: true })
      copyFileSync(join(ROOT, "packages", "scripts", "src", file), to)
    }
    mkdirSync(join(root, HOOKS), { recursive: true })
    writeFileSync(
      join(root, "scripts", "factory-settings.json"),
      `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "bun scripts/hooks/bundled/a-guard.js" }] }] } })}\n`,
    )
    writeFileSync(join(root, HOOKS, "a-guard.ts"), 'console.log("a")\n')
    writeFileSync(join(root, HOOKS, "no-extensions-write-worker.ts"), "export {}\n")
    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("commit", "-q", "--no-verify", "-m", "start")
    const merging = () => {
      git("checkout", "-q", "-b", "side")
      writeFileSync(join(root, "side.txt"), "side\n")
      git("add", "-A")
      git("commit", "-q", "--no-verify", "-m", "side")
      git("checkout", "-q", "main")
      git("merge", "-q", "--no-commit", "--no-ff", "side")
    }
    const run = (...args: string[]) => {
      const proc = Bun.spawnSync(
        [
          "bun",
          "--no-env-file",
          join(root, "packages", "scripts", "src", "hooks-bundle.ts"),
          ...args,
        ],
        { cwd: root, env },
      )
      return { code: proc.exitCode, stderr: proc.stderr.toString() }
    }
    const written = () => readdirSync(join(root, BUNDLED)).sort()
    return { git, merging, root, run, written }
  }

  test("with a merge in progress it exits non-zero, writes no file and names committing the merge first", () => {
    const { merging, root, run } = checkout()
    merging()
    const { code, stderr } = run()
    expect(code).toBe(1)
    expect(stderr).toContain("a merge is in progress")
    expect(stderr).toContain(
      "commit the merge first, taking canary's bundles in scripts/hooks/bundled as they are, then run `bun run hooks:bundle` again and commit the rebuild on its own",
    )
    expect(() => readdirSync(join(root, BUNDLED))).toThrow()
  })

  test("with no merge in progress it writes each bundle, as before", () => {
    const { run, written } = checkout()
    expect(run().code).toBe(0)
    expect(written()).toEqual(["a-guard.js", "no-extensions-write-worker.js"])
  })

  test("write mode removes a bundle no build writes, a removed guard's, so --check passes after it (#694)", () => {
    const { root, run, written } = checkout()
    expect(run().code).toBe(0)
    writeFileSync(join(root, BUNDLED, "gone-guard.js"), "old\n")
    expect(run("--check").stderr).toContain("gone-guard.js")
    expect(run().code).toBe(0)
    expect(written()).toEqual(["a-guard.js", "no-extensions-write-worker.js"])
    expect(run("--check")).toEqual({ code: 0, stderr: "" })
  })

  test("--check runs during a merge as before: fresh bundles pass, a stale one is named", () => {
    const { git, merging, root, run } = checkout()
    expect(run().code).toBe(0)
    git("add", "-A")
    git("commit", "-q", "--no-verify", "-m", "bundles")
    merging()
    expect(run("--check")).toEqual({ code: 0, stderr: "" })
    writeFileSync(join(root, BUNDLED, "a-guard.js"), "stale\n")
    const stale = run("--check")
    expect(stale.code).toBe(1)
    expect(stale.stderr).toContain(`stale in ${BUNDLED}: a-guard.js`)
  })
})
