import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

import {
  calls,
  canaryTree,
  cwdsOf,
  keyOf,
  parse,
  replay,
  resultPath,
  ROOT_READS,
  routed,
  store,
  stored,
  sweep,
  TAKES_MAIN,
  type Check,
} from "../../../../packages/scripts/src/hook-differential"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/hook-differential.ts")
const DIR = mkdtempSync(join(tmpdir(), "hook-differential-"))

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

// a home whose run-slot.sh stand-in logs each ticket it is asked for and answers `room` with 7 waiters
const home = (name: string) => {
  const at = join(DIR, name)
  mkdirSync(join(at, ".playground", "ops"), { recursive: true })
  const runSlot = join(at, ".playground", "ops", "run-slot.sh")
  writeFileSync(
    runSlot,
    `#!/bin/bash\nif [ "$1" = room ]; then echo "4 4 0 7"; exit 0; fi\necho "$*" >> "${at}/tickets"\n`,
  )
  chmodSync(runSlot, 0o755)
  return at
}

const start = (at: string, env: Record<string, string> = {}) => {
  const { RUN_SLOT_NICE: _, ...rest } = process.env
  return Bun.spawnSync(["bun", SCRIPT, "replay", "--canary", "HEAD", "--hook", "no-such-hook"], {
    cwd: join(import.meta.dir, "../../../.."),
    env: { ...rest, HOME: at, ...env },
    stderr: "pipe",
    stdout: "pipe",
  })
}

describe("a start of hook-differential", () => {
  test("a bare start of the replay takes a run-slot ticket and says so on stderr with the queue's depth", () => {
    const at = home("bare")
    const run = start(at)
    expect(readFileSync(join(at, "tickets"), "utf8")).toContain(
      `-- bun ${SCRIPT} replay --canary HEAD --hook no-such-hook`,
    )
    expect(run.stderr.toString()).toContain("queued through run-slot behind 7 waiting")
  })

  test("a start inside a run-slot ticket takes no second one", () => {
    const at = home("inside")
    start(at, { RUN_SLOT_NICE: "10" })
    expect(existsSync(join(at, "tickets"))).toBe(false)
  })

  test.each([
    ["a sweep with no --forms", ["sweep"]],
    ["a replay over hours that are not a positive number", ["replay", "--hours", "abc"]],
  ])("%s prints the usage and ends with 2", (_, mode) => {
    const run = Bun.spawnSync(
      ["bun", SCRIPT, ...mode, "--canary", "HEAD", "--hook", "no-extensions-write"],
      { env: { ...process.env, RUN_SLOT_NICE: "10" }, stderr: "pipe", stdout: "pipe" },
    )
    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain("usage: bun run hooks:differential")
  })
})

describe("canaryTree", () => {
  const recorder =
    (steps: string[], failing = "", onInstall = () => {}) =>
    (argv: string[], cwd: string) => {
      steps.push(`${cwd} :: ${argv.join(" ")}`)
      if (argv[0] === "bun") onInstall()
      return { exitCode: argv[0] === failing ? 1 : 0, stdout: new Uint8Array() }
    }

  test("unpacks the sha's whole tree into a folder of its own, installs it from its own lockfile with no install scripts, then renames it to the sha, once", () => {
    const base = join(DIR, "trees")
    const steps: string[] = []
    const dir = canaryTree({ base, root: "/repo", run: recorder(steps), sha: "abc" })
    expect(dir).toBe(join(base, "abc"))
    const build = steps[1]!.split(" :: ")[0]!
    expect(build).toStartWith(join(base, "abc."))
    expect(steps).toEqual([
      "/repo :: git archive abc",
      `${build} :: tar -x -C ${build}`,
      `${build} :: bun install --frozen-lockfile --ignore-scripts`,
    ])
    expect(existsSync(join(dir, ".installed"))).toBe(true)
    canaryTree({ base, root: "/repo", run: recorder(steps), sha: "abc" })
    expect(steps).toHaveLength(3)
  })

  test("a run whose sha another run installed first takes that tree", () => {
    const base = join(DIR, "race")
    const other = join(base, "abc")
    const finishFirst = () => {
      mkdirSync(other, { recursive: true })
      writeFileSync(join(other, ".installed"), "")
      writeFileSync(join(other, "other"), "")
    }
    const steps: string[] = []
    expect(
      canaryTree({ base, root: "/repo", run: recorder(steps, "", finishFirst), sha: "abc" }),
    ).toBe(other)
    expect(steps[2]).not.toStartWith(`${other} ::`)
    expect(existsSync(join(other, "other"))).toBe(true)
  })

  test("a failed install throws and leaves the tree to be installed again", () => {
    const base = join(DIR, "failed")
    const steps: string[] = []
    expect(() =>
      canaryTree({ base, root: "/repo", run: recorder(steps, "bun"), sha: "abc" }),
    ).toThrow("could not install abc")
    canaryTree({ base, root: "/repo", run: recorder(steps), sha: "abc" })
    expect(steps).toHaveLength(6)
  })
})

describe("routed", () => {
  const at = (env: Record<string, string | undefined>, runnable = true) =>
    routed({
      argv: ["bun", "x.ts"],
      cwd: "/r/.claude/worktrees/pg 1",
      env,
      executable: () => runnable,
      home: "/h",
    })

  test("a bare start takes a ticket named for its worktree", () => {
    expect(at({})).toEqual(["/h/.playground/ops/run-slot.sh", "hooks-pg-1", "--", "bun", "x.ts"])
  })

  test("a start inside a ticket, or with no executable run-slot.sh, runs as it is", () => {
    expect(at({ RUN_SLOT_NICE: "10" })).toEqual(["bun", "x.ts"])
    expect(at({}, false)).toEqual(["bun", "x.ts"])
  })
})

describe("sweep and replay", () => {
  // a hook that records every input it is given and allows a command only when it holds ALLOW
  const recorder =
    (seen: string[]): Check =>
    (raw) => {
      seen.push(raw)
      return JSON.parse(raw).tool_input.command.includes(" ALLOW") ? undefined : "refused"
    }
  const ran = join(DIR, "ran")
  const forms = [
    { command: `touch ${ran} ALLOW`, inClass: true },
    { command: `touch ${ran}`, inClass: false },
  ]

  test("each form reaches each hook only as data through check(), from the home, the data folder and a worktree, and none runs", async () => {
    const before: string[] = []
    const after: string[] = []
    const { counts } = await sweep(recorder(before), recorder(after), forms, "/h")
    expect(after.map((raw) => JSON.parse(raw))).toEqual(
      forms.flatMap(({ command }) =>
        cwdsOf("/h").map((cwd) => ({
          cwd,
          tool_input: { command },
          tool_name: "Bash",
        })),
      ),
    )
    expect(counts).toEqual({
      cases: 6,
      forms: 2,
      "newly allowed": { inClass: 0, outClass: 0 },
      "newly refused": { inClass: 0, outClass: 0 },
      same: 6,
    })
    expect(existsSync(ran)).toBe(false)
  })

  test("a form the head allows and canary refuses counts by its class", async () => {
    const refuseAll: Check = () => "refused"
    const { changed, counts } = await sweep(refuseAll, recorder([]), forms, "/h")
    expect(counts["newly allowed"]).toEqual({ inClass: 3, outClass: 0 })
    expect(changed).toEqual([])
  })

  test("the replay reads each made-up Bash call of the day's transcripts once, a sub-agent's included, and only as data", async () => {
    const projects = join(DIR, "projects")
    mkdirSync(join(projects, "p", "s", "subagents"), { recursive: true })
    const line = (command: string, timestamp: string, cwd = "/h/w") =>
      JSON.stringify({
        cwd,
        message: { content: [{ input: { command }, name: "Bash", type: "tool_use" }] },
        timestamp,
      })
    const now = new Date().toISOString()
    writeFileSync(
      join(projects, "p", "s.jsonl"),
      [
        line(`touch ${ran} ALLOW`, now),
        line(`touch ${ran} ALLOW`, now),
        line(`touch ${ran}`, "2000-01-01T00:00:00Z"),
        "not json",
      ].join("\n"),
    )
    writeFileSync(
      join(projects, "p", "s", "subagents", "a.jsonl"),
      line(`touch ${ran} ALLOW`, now, "/h/sub"),
    )
    const list = await calls(projects, Date.now() - 3600_000)
    expect(list.toSorted((x, y) => x.cwd.localeCompare(y.cwd))).toEqual([
      { command: `touch ${ran} ALLOW`, cwd: "/h/sub" },
      { command: `touch ${ran} ALLOW`, cwd: "/h/w" },
    ])
    const { counts } = await replay(() => "refused", recorder([]), list, "/h")
    expect(counts).toEqual({ calls: 2, "newly allowed": 2, "newly refused": 0, same: 0 })
  })
})

// A hook whose check() takes the main checkout reads it from its own folder when none is given, and canary's unpacked tree is no git checkout, so the differential hands both sides the head's (PG-996)
describe("a hook that takes the main checkout", () => {
  // refuses a command that names its main checkout; with none given, main is the folder it would read from its own tree
  const guard =
    (fallback: string): Check =>
    (raw, _env, main = fallback) =>
      JSON.parse(raw).tool_input.command.includes(`${main}/`) ? "refused" : undefined
  const canary = guard("/tmp/hook-differential/abc")
  const head = guard("/main")
  const forms = [{ command: "echo x > /main/f", inClass: false }]

  test("reads the head's main checkout on both sides, so a sweep and a replay count the same verdict as the same", async () => {
    const { changed, counts } = await sweep(canary, head, forms, "/h", "/main")
    expect(counts).toMatchObject({
      cases: 3,
      "newly allowed": { inClass: 0, outClass: 0 },
      "newly refused": { inClass: 0, outClass: 0 },
      same: 3,
    })
    expect(changed).toEqual([])
    const call = { command: "echo x > /main/f", cwd: "/h" }
    expect((await replay(canary, head, [call], "/h", "/main")).counts).toMatchObject({
      "newly refused": 0,
      same: 1,
    })
  })

  test("TAKES_MAIN names every hook whose check() takes the main checkout, and only those", async () => {
    const hooks = join(import.meta.dir, "../../../../scripts/hooks")
    const taking: string[] = []
    for await (const file of new Bun.Glob("*.ts").scan(hooks)) {
      const signature =
        /export (?:async )?function check\(([\s\S]*?)\)\s*:\s*(?:Promise|string)/.exec(
          await Bun.file(join(hooks, file)).text(),
        )?.[1]
      if (signature?.includes("main: string = mainCheckout("))
        taking.push(file.replace(/\.ts$/, ""))
    }
    expect(taking.length).toBeGreaterThan(0)
    expect([...TAKES_MAIN].sort()).toEqual(taking.sort())
  })
})

describe("a hook that reads beside its own copy", () => {
  // finds its checkout as packages/scripts/src/main-checkout.ts does: PLAYGROUND_REPO, else the folder above its own folder's git common dir, else its own folder
  const STUB = `import { dirname } from "node:path"
export const check = (raw) => {
  const git = Bun.spawnSync(["git", "-C", import.meta.dir, "rev-parse", "--path-format=absolute", "--git-common-dir"])
  const root = process.env.PLAYGROUND_REPO || (git.exitCode === 0 ? dirname(git.stdout.toString().trim()) : import.meta.dir)
  return JSON.parse(raw).tool_input.command.includes(root + "/") ? "refused" : undefined
}
`
  const copy = async (at: string) => {
    mkdirSync(join(at, "scripts", "hooks"), { recursive: true })
    writeFileSync(join(at, "scripts", "hooks", "stub.ts"), STUB)
    return (await import(join(at, "scripts", "hooks", "stub.ts"))).check as Check
  }

  test("reads the head's main checkout through PLAYGROUND_REPO on both sides, and the caller's value comes back after", async () => {
    const headRoot = realpathSync(mkdtempSync(join(DIR, "own-head-")))
    expect(Bun.spawnSync(["git", "init", "-q", headRoot]).exitCode).toBe(0)
    const head = await copy(headRoot)
    const canary = await copy(realpathSync(mkdtempSync(join(DIR, "own-canary-"))))
    const command = `echo x > ${headRoot}/f`
    const was = process.env.PLAYGROUND_REPO
    try {
      delete process.env.PLAYGROUND_REPO
      const swept = await sweep(
        canary,
        head,
        [{ command, inClass: false }],
        "/h",
        undefined,
        headRoot,
      )
      expect(swept.counts).toMatchObject({ "newly refused": { inClass: 0, outClass: 0 }, same: 3 })
      expect(swept.changed).toEqual([])
      expect(process.env.PLAYGROUND_REPO).toBeUndefined()
      process.env.PLAYGROUND_REPO = "/elsewhere"
      const replayed = await replay(
        canary,
        head,
        [{ command, cwd: "/h" }],
        "/h",
        undefined,
        headRoot,
      )
      expect(replayed.counts).toMatchObject({ "newly refused": 0, same: 1 })
      expect(process.env.PLAYGROUND_REPO).toBe("/elsewhere")
    } finally {
      if (was === undefined) delete process.env.PLAYGROUND_REPO
      else process.env.PLAYGROUND_REPO = was
    }
  })

  test("ROOT_READS names every file in the hooks' import graph that reads a path from its own folder, and only those", () => {
    const repo = join(import.meta.dir, "../../../..")
    const SPEC =
      /(?:^|\n)\s*(?:import|export)\b[^"'`]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g
    const OWN = /import\.meta\.(?:dir|dirname|filename|path|url)\b/
    const file = (base: string) =>
      [base, `${base}.ts`, join(base, "index.ts")].find(
        (c) => existsSync(c) && statSync(c).isFile(),
      )
    // a relative path from the importer, `@packages/<name>[/<sub>]` by its package's bun export else `src/<sub>`, and a package's own `@/<path>` under its `src`
    const target = (importer: string, spec: string): string | undefined => {
      if (spec.startsWith(".")) return file(resolve(dirname(importer), spec))
      const pkg = /^@packages\/([^/]+)(?:\/(.+))?$/.exec(spec)
      if (pkg) {
        const at = join(repo, "packages", pkg[1]!)
        const json = JSON.parse(readFileSync(join(at, "package.json"), "utf8")) as {
          exports?: Record<string, { bun?: string } | string>
        }
        const entry = json.exports?.[pkg[2] ? `./${pkg[2]}` : "."]
        const bun = typeof entry === "object" ? entry.bun : undefined
        return (bun && file(join(at, bun))) || file(join(at, "src", pkg[2] ?? "index"))
      }
      const own = /^@\/(.+)$/.exec(spec)
      const home = /^(.*\/packages\/[^/]+)\//.exec(importer)?.[1]
      return own && home ? file(join(home, "src", own[1]!)) : undefined
    }
    const seen = new Set<string>()
    const visit = (path: string) => {
      if (seen.has(path)) return
      seen.add(path)
      for (const m of readFileSync(path, "utf8").matchAll(SPEC)) {
        const found = target(path, (m[1] ?? m[2] ?? m[3])!)
        if (found) visit(found)
      }
    }
    const hooks = join(repo, "scripts", "hooks")
    for (const file of new Bun.Glob("*.ts").scanSync(hooks)) visit(join(hooks, file))
    const reading = [...seen]
      .filter((p) => OWN.test(readFileSync(p, "utf8")))
      .map((p) => relative(repo, p))
    expect(reading.length).toBeGreaterThan(0)
    expect(Object.keys(ROOT_READS).sort()).toEqual(reading.sort())
    for (const why of Object.values(ROOT_READS)) expect(why.length).toBeGreaterThan(0)
  })
})

describe("a stored result", () => {
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd, stderr: "pipe", stdout: "pipe" },
    )
      .stdout.toString()
      .trim()

  // a repo whose one hook allows a command holding ALLOW, and a forms module outside it
  const repo = (name: string) => {
    const root = join(DIR, name)
    mkdirSync(join(root, "scripts", "hooks"), { recursive: true })
    writeFileSync(join(root, "package.json"), `{"name":"t","private":true}\n`)
    writeFileSync(
      join(root, "scripts", "hooks", "x.ts"),
      `export const check = (raw: string) => (raw.includes("ALLOW") ? undefined : "refused")\n`,
    )
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "init")
    const forms = join(DIR, `${name}-forms.ts`)
    writeFileSync(forms, `export const forms = [{ command: "ls ALLOW", inClass: true }]\n`)
    return {
      forms,
      root,
      sha: git(root, "rev-parse", "HEAD"),
      tree: git(root, "rev-parse", "HEAD^{tree}"),
    }
  }

  const args = (forms: string, ...more: string[]) => [
    "sweep",
    "--forms",
    forms,
    "--canary",
    "HEAD",
    "--hook",
    "x",
    ...more,
  ]

  const run = (at: string, root: string, argv: string[], env: Record<string, string> = {}) => {
    const {
      CLAUDE_CONFIG_DIR: _c,
      PLAYGROUND_DATA_DIR: _d,
      RUN_SLOT_NICE: _r,
      ...rest
    } = process.env
    return Bun.spawnSync(["bun", SCRIPT, ...argv], {
      cwd: root,
      env: { ...rest, HOME: at, TMPDIR: DIR, ...env },
      stderr: "pipe",
      stdout: "pipe",
    })
  }

  const keyAt = (root: string, argv: string[], canary: string, at = DIR) =>
    keyOf({ canary, options: parse(argv)!, projects: join(at, "projects"), root })?.key

  test("a second run at the same key prints the first run's counts under its reused: line and starts no run-slot job", () => {
    const at = home("reused")
    const { forms, root, sha, tree } = repo("reused-repo")
    const first = run(at, root, args(forms), { RUN_SLOT_NICE: "10" })
    expect(first.exitCode).toBe(0)
    const counts = first.stdout.toString()
    expect(counts).toContain(`"hook":"x","cases":3`)
    const second = run(at, root, args(forms))
    const [line, ...rest] = second.stdout.toString().split("\n")
    const key = keyOf({
      canary: sha,
      options: parse(args(forms))!,
      projects: join(at, ".claude", "projects"),
      root,
    })!.key
    expect(line).toMatch(
      new RegExp(
        `^reused: ${key} from \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z, head ${tree}, canary ${sha}$`,
      ),
    )
    expect(rest.join("\n")).toBe(counts)
    expect(existsSync(join(at, "tickets"))).toBe(false)
  })

  test("a one-byte worktree change, a new canary sha, another forms blob and a newer transcript each move the key", () => {
    const { forms, root, sha } = repo("moved-repo")
    const original = keyAt(root, args(forms), sha)!
    expect(keyAt(root, args(forms), sha)).toBe(original)
    expect(keyAt(root, args(forms), "another")).not.toBe(original)
    const hook = join(root, "scripts", "hooks", "x.ts")
    writeFileSync(hook, `${readFileSync(hook, "utf8")} `)
    expect(keyAt(root, args(forms), sha)).toBeUndefined()
    git(root, "commit", "-qam", "one byte")
    const committed = keyAt(root, args(forms), sha)!
    expect(committed).not.toBe(original)
    writeFileSync(forms, `export const forms = [{ command: "ls ALLOW ", inClass: true }]\n`)
    expect(keyAt(root, args(forms), sha)).not.toBe(committed)
    const replayArgs = ["replay", "--canary", "HEAD", "--hook", "x"]
    const at = join(DIR, "moved")
    mkdirSync(join(at, "projects", "p"), { recursive: true })
    const transcript = join(at, "projects", "p", "s.jsonl")
    writeFileSync(transcript, "")
    utimesSync(transcript, 1_000, 1_000)
    const replayKey = keyAt(root, replayArgs, sha, at)
    expect(replayKey).toBeString()
    utimesSync(transcript, 2_000, 2_000)
    expect(keyAt(root, replayArgs, sha, at)).not.toBe(replayKey)
  })

  test.each([
    ["--fresh", ["--fresh"], new Date().toISOString()],
    ["a result over 24 h old", [], "2000-01-01T00:00:00.000Z"],
  ])("%s runs fresh through a run-slot ticket", async (_, more, iso) => {
    const at = home(`fresh-${more.length}`)
    const { forms, root, sha } = repo(`fresh-${more.length}-repo`)
    const key = keyOf({
      canary: sha,
      options: parse(args(forms))!,
      projects: join(at, ".claude", "projects"),
      root,
    })!
    await store(join(at, ".playground"), key, { changed: [], counts: ["stored"] })
    const path = resultPath(join(at, ".playground"), key.key)
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), at: iso }))
    const second = run(at, root, args(forms, ...more))
    expect(second.stdout.toString()).not.toContain("reused:")
    expect(readFileSync(join(at, "tickets"), "utf8")).toContain(`-- bun ${SCRIPT} sweep`)
  })

  test("a result is read back while it is under a day old", async () => {
    const data = join(DIR, "data")
    await store(
      data,
      { canary: "c", head: "h", input: "i", key: "k" },
      { changed: [], counts: ["a"] },
    )
    const at = Date.parse((await stored(data, "k"))!.at)
    expect((await stored(data, "k", at + 23 * 3600_000))?.counts).toEqual(["a"])
    expect(await stored(data, "k", at + 24 * 3600_000)).toBeUndefined()
  })

  test("a run after a committed one-byte change runs fresh through a run-slot ticket", () => {
    const at = home("committed")
    const { forms, root } = repo("committed-repo")
    expect(run(at, root, args(forms), { RUN_SLOT_NICE: "10" }).exitCode).toBe(0)
    const hook = join(root, "scripts", "hooks", "x.ts")
    writeFileSync(hook, `${readFileSync(hook, "utf8")} `)
    git(root, "commit", "-qam", "one byte")
    expect(run(at, root, args(forms)).stdout.toString()).not.toContain("reused:")
    expect(readFileSync(join(at, "tickets"), "utf8")).toContain(`-- bun ${SCRIPT} sweep`)
  })

  test("a run whose worktree changes while it runs stores nothing, so the next run at the clean head runs fresh", () => {
    const at = home("moved-mid-run")
    const { forms, root } = repo("moved-mid-run-repo")
    const hook = join(root, "scripts", "hooks", "x.ts")
    // canary's hook, imported mid-run, stands in for an edit made while the run is in flight
    writeFileSync(
      hook,
      `import { writeFileSync } from "node:fs"\nif (process.env.RACE_TARGET) writeFileSync(process.env.RACE_TARGET, "export const check = () => undefined\\n")\nexport const check = () => "refused"\n`,
    )
    git(root, "commit", "-qam", "canary")
    writeFileSync(
      hook,
      `export const check = (raw: string) => (raw.includes("ALLOW") ? undefined : "refused")\n`,
    )
    git(root, "commit", "-qam", "head")
    const sweepAt = (...more: string[]) =>
      args(forms, ...more).map((a) => (a === "HEAD" ? "HEAD~1" : a))
    const first = run(at, root, sweepAt(), { RACE_TARGET: hook, RUN_SLOT_NICE: "10" })
    expect(first.exitCode).toBe(0)
    expect(git(root, "status", "--porcelain")).not.toBe("")
    git(root, "checkout", "--", ".")
    expect(existsSync(join(at, ".playground", "hook-differential", "results"))).toBe(false)
    expect(run(at, root, sweepAt()).stdout.toString()).not.toContain("reused:")
    expect(readFileSync(join(at, "tickets"), "utf8")).toContain(`-- bun ${SCRIPT} sweep`)
  })
})
