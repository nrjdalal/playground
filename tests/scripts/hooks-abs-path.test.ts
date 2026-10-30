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

// A hook that cannot start fails open, so a command that hangs on $HOME is off wherever HOME is another folder.
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
        c.replaceAll(/scripts\/hooks\/[\w-]+\.ts/g, "scripts/hooks/<hook>.ts"),
      ),
    )
    expect(shapes.size).toBe(1)
    const [shape] = shapes
    expect(shape).toStartWith('R="${PLAYGROUND_REPO}";')
    expect(shape).toContain("--git-common-dir")
    expect((await factoryCommands(PROJECT)).length).toBe((await commands(FACTORY)).length)
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
  const withHook = (dir: string) => {
    mkdirSync(join(dir, "scripts", "hooks"), { recursive: true })
    writeFileSync(join(dir, "scripts", "hooks", "no-stash.ts"), "console.log(process.cwd())\n")
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

  const command = async (file: string) => {
    const found = (await commands(file)).find((c) => c.endsWith("scripts/hooks/no-stash.ts"))
    if (!found) throw new Error(`${file} registers no no-stash hook`)
    return found
  }
  const run = async (file: string, shell: string, cwd: string, env: Record<string, string>) => {
    const proc = Bun.spawn([shell, "-c", await command(file)], {
      cwd,
      // the ceiling keeps git from finding a repository above the scratch folders
      env: {
        ...process.env,
        GIT_CEILING_DIRECTORIES: scratch,
        PLAYGROUND_REPO: "",
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
  }
})
