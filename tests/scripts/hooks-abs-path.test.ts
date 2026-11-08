import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const FACTORY = join("scripts", "factory-settings.json")
const PROJECT = join(".claude", "settings.json")

type Hook = {
  hooks: { args?: string[]; command: string; onFailure?: string; timeout?: number }[]
  matcher?: string
}

const entries = async (file: string) => {
  const settings = (await Bun.file(join(root, file)).json()) as {
    hooks: Record<string, Hook[]>
  }
  return Object.entries(settings.hooks).flatMap(([event, list]) =>
    list.flatMap((entry) =>
      entry.hooks.map((hook) => ({
        args: hook.args,
        command: hook.command,
        event,
        matcher: entry.matcher,
      })),
    ),
  )
}
// Each hook's text, an exec-form hook's args after its program.
const commands = async (file: string) =>
  (await entries(file)).map((e) => [e.command, ...(e.args ?? [])].join(" "))
// The shell-form hooks alone, the exec form's one entry left out; the project file's two hooks of its own (no-release-comment, no-linear-ticket) cd to the session's own folder on purpose.
const shellEntries = async (file: string) => (await entries(file)).filter((e) => !e.args)
const factoryCommands = async (file: string) =>
  (await shellEntries(file))
    .map((e) => e.command)
    .filter((c) => !c.startsWith('cd "$CLAUDE_PROJECT_DIR" && '))

// A command that hangs on $HOME breaks wherever HOME is another folder: a PreToolUse guard then refuses every factory call, and any other hook goes quiet.
describe("no factory hook command hangs on HOME", () => {
  for (const file of [FACTORY, PROJECT])
    test(`${file} holds no $HOME, \${HOME} or ~ in a hook command`, async () => {
      for (const command of await commands(file)) expect(command).not.toMatch(/\$\{HOME\}|\$HOME|~/)
    })
})

// Claude Code runs a handler defined in more than one settings file once only when its command is the same string, so a session loading both files runs each guard once.
describe("the two settings files carry one command per factory hook", () => {
  test("every factory hook is in .claude/settings.json byte for byte, with its event and matcher", async () => {
    const project = await entries(PROJECT)
    for (const hook of await entries(FACTORY)) expect(project).toContainEqual(hook)
  })

  test("every factory command in both files is the one resolver, differing only in the hook it runs", async () => {
    const shapes = new Set(
      [...(await factoryCommands(FACTORY)), ...(await factoryCommands(PROJECT))].map((c) =>
        c
          .replaceAll(/scripts\/hooks\/(bundled\/)?[\w-]+\.([jt]s)/g, "scripts/hooks/$1<hook>.$2")
          .replaceAll(/"[\w-]+: /g, '"<hook>: '),
      ),
    )
    expect(shapes.size).toBe(2)
    for (const shape of shapes) {
      expect(shape).toStartWith('R="${PLAYGROUND_REPO}";')
      expect(shape).toContain("--git-common-dir")
    }
    expect((await factoryCommands(PROJECT)).length).toBe((await factoryCommands(FACTORY)).length)
  })

  // Claude Code blocks a call only on exit 2, so a guard that crashes (exit 1) or whose script is gone (exit 0) let every call through; a Stop hook at exit 2 would loop its session, so the rest stay open.
  test("every PreToolUse wrapper, and only those, refuses on a crash and, under a role, on a missing script", async () => {
    for (const file of [FACTORY, PROJECT])
      for (const { command, event } of await shellEntries(file)) {
        const name = command.match(/scripts\/hooks\/(?:bundled\/)?([\w-]+)\.[jt]s/)?.[1]
        const closed = [
          `|| { [ -z "$PLAYGROUND_ROLE" ] && exit 0; echo "${name}: `,
          `; c=$?; [ $c = 0 ] || [ $c = 2 ] || { echo "${name}: crashed (exit $c)`,
        ]
        for (const part of closed)
          if (event === "PreToolUse") expect(command).toContain(part)
          else expect(command).not.toContain(part)
        if (event !== "PreToolUse") expect(command).toContain('.ts" ] || exit 0; cd -P')
      }
  })

  // A PreToolUse guard runs its bundle, which imports nothing at run time, so a missing or damaged node_modules cannot crash it, and its source while the checkout holds no bundle (a main checkout not yet shipped one); every other hook runs its source.
  test("every PreToolUse wrapper runs its guard's bundle, else its source, and every other its source", async () => {
    for (const file of [FACTORY, PROJECT])
      for (const { command, event } of await shellEntries(file)) {
        const name = command.match(/scripts\/hooks\/(?:bundled\/)?([\w-]+)\.[jt]s/)?.[1]
        if (event === "PreToolUse") {
          expect(command).toContain(
            `{ s=scripts/hooks/bundled/${name}.js; [ -f "$R/$s" ] || s=scripts/hooks/${name}.ts; [ -f "$R/$s" ]; } || {`,
          )
          expect(command).toContain('cd -P "$R" && bun --no-env-file "$s"; c=$?;')
        } else
          for (const [path] of command.matchAll(/scripts\/hooks\/[\w/-]+\.[jt]s/g))
            expect(path).toMatch(/^scripts\/hooks\/[\w-]+\.ts$/)
      }
  })

  // Every Bash guard runs in guards.ts's one process, started with no shell; onFailure blocks the call on a timeout or a start that fails, and --config=/dev/null keeps the session folder's bunfig.toml preload from running.
  test("each file runs the Bash guards through one exec-form entry, and no other PreToolUse entry hears Bash", async () => {
    for (const file of [FACTORY, PROJECT]) {
      const pre = (await entries(file)).filter((e) => e.event === "PreToolUse")
      const exec = pre.filter((e) => e.args)
      expect(exec.map((e) => ({ command: e.command, matcher: e.matcher }))).toEqual([
        { command: "bun", matcher: "^Bash$" },
      ])
      expect(exec[0]!.args!.slice(0, 3)).toEqual(["--no-env-file", "--config=/dev/null", "-e"])
      expect(exec[0]!.args![3]).toContain(
        '["scripts/hooks/bundled/guards.js", "scripts/hooks/guards.ts"]',
      )
      for (const e of pre.filter((e) => !e.args))
        expect({ matcher: e.matcher, hears: new RegExp(e.matcher ?? "").test("Bash") }).toEqual({
          matcher: e.matcher,
          hears: false,
        })
      const settings = (await Bun.file(join(root, file)).json()) as {
        hooks: { PreToolUse: Hook[] }
      }
      const [hook] = settings.hooks.PreToolUse.flatMap((e) => e.hooks).filter((h) => h.args)
      expect({ onFailure: hook!.onFailure, timeout: hook!.timeout }).toEqual({
        onFailure: "block",
        timeout: 15,
      })
    }
  })

  // A skill's frontmatter registers a guard for a session outside this checkout, so it fails closed the same way.
  test("the playbook skill's no-linear-ticket wrapper runs the bundle and fails closed", async () => {
    const text = await Bun.file(
      join(root, "extensions", "core", "skills", "playbook", "SKILL.md"),
    ).text()
    const front = Bun.YAML.parse(text.split("---\n")[1]!) as {
      hooks: { PreToolUse: Hook[] }
    }
    const [command] = front.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command))
    expect(command).toContain(
      '{ s=scripts/hooks/bundled/no-linear-ticket.js; [ -f "$PLAYGROUND_REPO/$s" ] || s=scripts/hooks/no-linear-ticket.ts; [ -f "$PLAYGROUND_REPO/$s" ]; } || { [ -z "$PLAYGROUND_ROLE" ] && exit 0; echo "no-linear-ticket: ',
    )
    expect(command).toContain(
      'bun --no-env-file "$s"; c=$?; [ $c = 0 ] || [ $c = 2 ] || { echo "no-linear-ticket: crashed (exit $c)',
    )
    expect(command).toEndWith("exit $c")
  })

  // The command runs nothing when its script is missing, so a renamed or removed hook would turn its guard off with no word.
  test("every factory command checks and runs the same hook script, and that script exists", async () => {
    for (const command of [
      ...(await factoryCommands(FACTORY)),
      ...(await factoryCommands(PROJECT)),
    ]) {
      const paths = [...command.matchAll(/scripts\/hooks\/(?:bundled\/)?([\w-]+)\.[jt]s/g)]
      expect(paths).toHaveLength(2)
      expect(paths[1]![1]).toBe(paths[0]![1])
      for (const [path] of paths) expect(existsSync(join(root, path))).toBe(true)
      expect(existsSync(join(root, "scripts", "hooks", `${paths[0]![1]}.ts`))).toBe(true)
    }
  })
})

// Each case runs the real hook as Claude Code does, the shell form under each shell it may use and the exec form with no shell, in scratch folders whose stub guards print the folder they ran from.
describe("the command finds the checkout", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "hooks-917-")))
  afterAll(() => rmSync(scratch, { force: true, recursive: true }))
  // A shell-form guard runs its file as a script, and guards.js is a module whose hook() the exec form's launcher calls, so each stub takes the body for its form.
  const SHELL_HOOK = "no-main-checkout"
  const stub = (dir: string, script: string, module: string, bundled = true) => {
    const at = (file: string) =>
      join(dir, "scripts", "hooks", ...(bundled ? ["bundled", `${file}.js`] : [`${file}.ts`]))
    mkdirSync(join(at(SHELL_HOOK), ".."), { recursive: true })
    writeFileSync(at(SHELL_HOOK), script)
    writeFileSync(at("guards"), `export const hook = async () => { ${module} }\n`)
    return dir
  }
  const printing = (dir: string) =>
    stub(dir, "console.log(process.cwd())\n", "console.log(process.cwd()); return 0")
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd, stderr: "ignore", stdout: "ignore" }).exitCode
  // A scratch repo whose own stubs are committed, and a worktree of it, which holds a copy.
  const main = printing(join(scratch, "main"))
  git(main, "init", "-q", "-b", "main")
  git(main, "add", ".")
  git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x")
  const worktree = join(scratch, "wt")
  git(main, "worktree", "add", "-q", "-b", "side", worktree)
  const outside = printing(join(scratch, "outside"))
  const elsewhere = printing(join(scratch, "elsewhere"))
  const empty = join(scratch, "empty")
  mkdirSync(empty)
  // Stub guards that crash and refuse, and a Stop hook that crashes.
  const crashing = stub(join(scratch, "crashing"), "process.exit(1)\n", 'throw new Error("broken")')
  mkdirSync(join(crashing, "scripts", "hooks"), { recursive: true })
  writeFileSync(join(crashing, "scripts", "hooks", "no-chat-question.ts"), "process.exit(1)\n")
  const refusing = stub(join(scratch, "refusing"), "process.exit(2)\n", "return 2")
  // A checkout with the guards' source and no bundle, as the main checkout is until a ship brings the bundles, and one with both.
  const source = (dir: string) =>
    stub(dir, 'console.log("source")\n', 'console.log("source"); return 0', false)
  const sourceOnly = source(join(scratch, "source-only"))
  const both = stub(
    source(join(scratch, "both")),
    'console.log("bundle")\n',
    'console.log("bundle"); return 0',
  )

  const hookOf = async (file: string, hook: string) => {
    const found = (await entries(file)).find((e) =>
      hook === "guards"
        ? e.args !== undefined
        : new RegExp(`scripts/hooks/(bundled/)?${hook}\\.[jt]s`).test(e.command) &&
          e.event !== "SessionStart",
    )
    if (!found) throw new Error(`${file} registers no ${hook} hook`)
    return found
  }
  // The shell form under a shell, the exec form spawned with its args as Claude Code spawns it.
  const run = async (
    file: string,
    shell: string,
    cwd: string,
    env: Record<string, string>,
    hook: string,
  ) => {
    const found = await hookOf(file, hook)
    const proc = Bun.spawn(
      found.args ? [found.command, ...found.args] : [shell, "-c", found.command],
      {
        cwd,
        // the ceiling keeps git from finding a repository above the scratch folders
        env: {
          ...process.env,
          GIT_CEILING_DIRECTORIES: scratch,
          PLAYGROUND_REPO: "",
          PLAYGROUND_ROLE: "",
          ...env,
        },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      },
    )
    return {
      code: await proc.exited,
      stderr: await new Response(proc.stderr).text(),
      stdout: (await new Response(proc.stdout).text()).trim(),
    }
  }

  const FORMS = [FACTORY, PROJECT].flatMap((file) => [
    ...["bash", "/bin/sh"].map((shell) => ({
      file,
      hook: SHELL_HOOK,
      label: `${file}, ${shell}`,
      shell,
    })),
    { file, hook: "guards", label: `${file}, the Bash guards' exec form`, shell: "" },
  ])
  for (const { file, hook, label, shell } of FORMS) {
    const go = (cwd: string, env: Record<string, string>) => run(file, shell, cwd, env, hook)

    test(`${label}: from a worktree it runs the main checkout's copy`, async () => {
      expect(await go(worktree, { CLAUDE_PROJECT_DIR: worktree })).toEqual({
        code: 0,
        stderr: "",
        stdout: main,
      })
    })

    test(`${label}: when git cannot answer and PLAYGROUND_REPO is unset it runs nothing and exits 0`, async () => {
      expect(await go(outside, { CLAUDE_PROJECT_DIR: outside })).toEqual({
        code: 0,
        stderr: "",
        stdout: "",
      })
    })

    test(`${label}: PLAYGROUND_REPO, when set, names the checkout whatever the project folder`, async () => {
      expect(
        await go(worktree, { CLAUDE_PROJECT_DIR: worktree, PLAYGROUND_REPO: elsewhere }),
      ).toEqual({
        code: 0,
        stderr: "",
        stdout: elsewhere,
      })
    })

    test(`${label}: a PLAYGROUND_REPO of . or of a folder without the hook runs nothing and exits 0`, async () => {
      for (const repo of [".", empty])
        expect(await go(outside, { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: repo })).toEqual({
          code: 0,
          stderr: "",
          stdout: "",
        })
    })

    test(`${label}: a guard that crashes refuses with exit 2, naming the hook, the crash and the fix`, async () => {
      const { code, stderr } = await go(outside, {
        CLAUDE_PROJECT_DIR: outside,
        PLAYGROUND_REPO: crashing,
      })
      expect(code).toBe(2)
      expect(stderr).toContain(
        hook === "guards" ? "guards: crashed (Error: broken)" : `${hook}: crashed (exit 1)`,
      )
      expect(stderr).toContain(`bun install in ${crashing}`)
    })

    test(`${label}: a guard's own refusal stays exit 2`, async () => {
      expect(
        (await go(outside, { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: refusing })).code,
      ).toBe(2)
    })

    test(`${label}: a guard runs its bundle when the checkout holds one, else its source`, async () => {
      for (const [repo, stdout] of [
        [sourceOnly, "source"],
        [both, "bundle"],
      ] as const)
        expect(
          await go(outside, {
            CLAUDE_PROJECT_DIR: outside,
            PLAYGROUND_REPO: repo,
            PLAYGROUND_ROLE: "worker",
          }),
        ).toEqual({ code: 0, stderr: "", stdout })
    })

    test(`${label}: under PLAYGROUND_ROLE a missing script or an unresolved checkout refuses, naming the restore route`, async () => {
      for (const env of [
        { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: empty },
        { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: "." },
        { CLAUDE_PROJECT_DIR: empty, PLAYGROUND_REPO: "" },
      ]) {
        const { code, stderr } = await go(outside, { ...env, PLAYGROUND_ROLE: "worker" })
        expect(code).toBe(2)
        expect(stderr).toContain(`${hook}: `)
        expect(stderr).toContain(
          "ops-restore puts it back, else Ops by playbook LIFECYCLE.md, Restoring the main checkout",
        )
      }
    })
  }

  for (const file of [FACTORY, PROJECT]) {
    test(`${file}, bash: a Stop hook that crashes still lets the session stop`, async () => {
      const { code } = await run(
        file,
        "bash",
        outside,
        { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: crashing, PLAYGROUND_ROLE: "worker" },
        "no-chat-question",
      )
      expect(code).toBe(1)
    })

    // bun runs the bunfig.toml preload of the folder it starts in, and the exec form starts in the session's folder, an outside PR's clone included, so its --config=/dev/null keeps that preload from running in every Bash hook.
    test(`${file}: the Bash guards' exec form runs no bunfig.toml preload from the session's folder`, async () => {
      const clone = join(scratch, `preload-${file.replaceAll("/", "-")}`)
      const marker = join(clone, "preload-ran")
      mkdirSync(clone)
      writeFileSync(join(clone, "bunfig.toml"), 'preload = ["./pre.ts"]\n')
      writeFileSync(
        join(clone, "pre.ts"),
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")\n`,
      )
      Bun.spawnSync(["bun", "--no-env-file", "-e", "0"], {
        cwd: clone,
        stderr: "ignore",
        stdout: "ignore",
      })
      expect(existsSync(marker)).toBe(true)
      rmSync(marker)
      expect(
        await run(file, "", clone, { CLAUDE_PROJECT_DIR: clone, PLAYGROUND_REPO: main }, "guards"),
      ).toEqual({
        code: 0,
        stderr: "",
        stdout: main,
      })
      expect(existsSync(marker)).toBe(false)
    })
  }
})
