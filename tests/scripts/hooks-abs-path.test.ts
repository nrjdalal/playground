import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const FACTORY = join("scripts", "factory-settings.json")
const PROJECT = join(".claude", "settings.json")

type Hook = { hooks: { command: string }[]; matcher?: string }

const entries = async (file: string) => {
  const settings = (await Bun.file(join(root, file)).json()) as {
    hooks: Record<string, Hook[]>
  }
  return Object.entries(settings.hooks).flatMap(([event, list]) =>
    list.flatMap((entry) =>
      entry.hooks.map((hook) => ({
        command: hook.command,
        event,
        matcher: entry.matcher,
      })),
    ),
  )
}
const commands = async (file: string) => (await entries(file)).map((e) => e.command)
// The project file's two hooks of its own (no-release-comment, no-linear-ticket) cd to the session's own folder on purpose.
const factoryCommands = async (file: string) =>
  (await commands(file)).filter((c) => !c.startsWith('cd "$CLAUDE_PROJECT_DIR" && '))

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
          .replaceAll(/scripts\/hooks\/[\w-]+\.ts/g, "scripts/hooks/<hook>.ts")
          .replaceAll(/"[\w-]+: /g, '"<hook>: '),
      ),
    )
    expect(shapes.size).toBe(2)
    for (const shape of shapes) {
      expect(shape).toStartWith('R="${PLAYGROUND_REPO}";')
      expect(shape).toContain("--git-common-dir")
    }
    expect((await factoryCommands(PROJECT)).length).toBe((await commands(FACTORY)).length)
  })

  // Claude Code blocks a call only on exit 2, so a guard that crashes (exit 1) or whose script is gone (exit 0) let every call through; a Stop hook at exit 2 would loop its session, so the rest stay open.
  test("every PreToolUse wrapper, and only those, refuses on a crash and, under a role, on a missing script", async () => {
    for (const file of [FACTORY, PROJECT])
      for (const { command, event } of await entries(file)) {
        const name = command.match(/scripts\/hooks\/([\w-]+)\.ts/)?.[1]
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

  // The command runs nothing when its script is missing, so a renamed or removed hook would turn its guard off with no word.
  test("every factory command checks and runs the same hook script, and that script exists", async () => {
    for (const command of [
      ...(await factoryCommands(FACTORY)),
      ...(await factoryCommands(PROJECT)),
    ]) {
      const names = [...command.matchAll(/scripts\/hooks\/([\w-]+)\.ts/g)].map((m) => m[1])
      expect(names).toHaveLength(2)
      expect(names[1]).toBe(names[0])
      expect(existsSync(join(root, "scripts", "hooks", `${names[0]}.ts`))).toBe(true)
    }
  })
})

// Each case runs the real command under the shells Claude Code may use, in scratch folders whose hooks/no-stash.ts prints the folder it ran from.
describe("the command finds the checkout", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "hooks-917-")))
  afterAll(() => rmSync(scratch, { force: true, recursive: true }))
  const withHook = (dir: string, body = "console.log(process.cwd())\n", hook = "no-stash") => {
    mkdirSync(join(dir, "scripts", "hooks"), { recursive: true })
    writeFileSync(join(dir, "scripts", "hooks", `${hook}.ts`), body)
    return dir
  }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd, stderr: "ignore", stdout: "ignore" }).exitCode
  // A scratch repo whose own hooks/no-stash.ts is committed, and a worktree of it, which holds a copy.
  const main = withHook(join(scratch, "main"))
  git(main, "init", "-q", "-b", "main")
  git(main, "add", ".")
  git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x")
  const worktree = join(scratch, "wt")
  git(main, "worktree", "add", "-q", "-b", "side", worktree)
  const outside = withHook(join(scratch, "outside"))
  const elsewhere = withHook(join(scratch, "elsewhere"))
  const empty = join(scratch, "empty")
  mkdirSync(empty)
  // Stub guards that crash and refuse, and a Stop hook that crashes.
  const crashing = withHook(join(scratch, "crashing"), "process.exit(1)\n")
  withHook(crashing, "process.exit(1)\n", "no-chat-question")
  const refusing = withHook(join(scratch, "refusing"), "process.exit(2)\n")

  const command = async (file: string, hook: string) => {
    const found = (await entries(file)).find(
      (e) => e.command.includes(`scripts/hooks/${hook}.ts`) && e.event !== "SessionStart",
    )
    if (!found) throw new Error(`${file} registers no ${hook} hook`)
    return found.command
  }
  const run = async (
    file: string,
    shell: string,
    cwd: string,
    env: Record<string, string>,
    hook = "no-stash",
  ) => {
    const proc = Bun.spawn([shell, "-c", await command(file, hook)], {
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
      stdout: "pipe",
    })
    return {
      code: await proc.exited,
      stderr: await new Response(proc.stderr).text(),
      stdout: (await new Response(proc.stdout).text()).trim(),
    }
  }

  for (const [file, shell] of [FACTORY, PROJECT].flatMap((f) =>
    ["bash", "/bin/sh"].map((s) => [f, s] as const),
  )) {
    test(`${file}, ${shell}: from a worktree it runs the main checkout's copy`, async () => {
      expect(await run(file, shell, worktree, { CLAUDE_PROJECT_DIR: worktree })).toEqual({
        code: 0,
        stderr: "",
        stdout: main,
      })
    })

    test(`${file}, ${shell}: when git cannot answer and PLAYGROUND_REPO is unset it runs nothing and exits 0`, async () => {
      expect(await run(file, shell, outside, { CLAUDE_PROJECT_DIR: outside })).toEqual({
        code: 0,
        stderr: "",
        stdout: "",
      })
    })

    test(`${file}, ${shell}: PLAYGROUND_REPO, when set, names the checkout whatever the project folder`, async () => {
      expect(
        await run(file, shell, worktree, {
          CLAUDE_PROJECT_DIR: worktree,
          PLAYGROUND_REPO: elsewhere,
        }),
      ).toEqual({ code: 0, stderr: "", stdout: elsewhere })
    })

    test(`${file}, ${shell}: a PLAYGROUND_REPO of . or of a folder without the hook runs nothing and exits 0`, async () => {
      for (const repo of [".", empty])
        expect(
          await run(file, shell, outside, {
            CLAUDE_PROJECT_DIR: outside,
            PLAYGROUND_REPO: repo,
          }),
        ).toEqual({ code: 0, stderr: "", stdout: "" })
    })

    test(`${file}, ${shell}: a PreToolUse guard that crashes refuses with exit 2, naming the hook, its code and the fix`, async () => {
      const { code, stderr } = await run(file, shell, outside, {
        CLAUDE_PROJECT_DIR: outside,
        PLAYGROUND_REPO: crashing,
      })
      expect(code).toBe(2)
      expect(stderr).toContain("no-stash: crashed (exit 1)")
      expect(stderr).toContain(`bun install in ${crashing}`)
    })

    test(`${file}, ${shell}: a guard's own refusal stays exit 2`, async () => {
      const { code } = await run(file, shell, outside, {
        CLAUDE_PROJECT_DIR: outside,
        PLAYGROUND_REPO: refusing,
      })
      expect(code).toBe(2)
    })

    test(`${file}, ${shell}: a Stop hook that crashes still lets the session stop`, async () => {
      const { code } = await run(
        file,
        shell,
        outside,
        { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: crashing, PLAYGROUND_ROLE: "worker" },
        "no-chat-question",
      )
      expect(code).toBe(1)
    })

    test(`${file}, ${shell}: under PLAYGROUND_ROLE a missing script or an unresolved checkout refuses, naming the restore route`, async () => {
      for (const env of [
        { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: empty },
        { CLAUDE_PROJECT_DIR: outside, PLAYGROUND_REPO: "." },
        { CLAUDE_PROJECT_DIR: empty },
      ]) {
        const { code, stderr } = await run(file, shell, outside, {
          ...env,
          PLAYGROUND_ROLE: "worker",
        })
        expect(code).toBe(2)
        expect(stderr).toContain("no-stash: ")
        expect(stderr).toContain("Restoring the main checkout")
      }
    })
  }
})
