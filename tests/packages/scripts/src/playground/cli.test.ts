import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/playground/cli.ts")
const dir = mkdtempSync(join(tmpdir(), "dispatcher-cli-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

describe("the shebang", () => {
  test("a .env in the folder dispatcher runs from reaches neither it nor the ops-herdr it starts", async () => {
    await Bun.write(join(dir, ".env"), "PLAYGROUND_HERDR_DIR=/scratch/x\n")
    const child = join(dir, "child.ts")
    await Bun.write(child, 'console.log(`child ${process.env.PLAYGROUND_HERDR_DIR ?? "unset"}`)\n')
    // a stand-in for cli.ts under its own first line, started the way ~/.bun/bin/playground starts it: through a symlink, with the .env's folder as its cwd
    const shebang = readFileSync(CLI, "utf8").split("\n")[0]
    const parent = join(dir, "parent.ts")
    await Bun.write(
      parent,
      `${shebang}\nconsole.log(\`parent \${process.env.PLAYGROUND_HERDR_DIR ?? "unset"}\`)\nconst run = Bun.spawnSync([process.execPath, "--no-env-file", ${JSON.stringify(child)}])\nprocess.stdout.write(run.stdout)\n`,
    )
    chmodSync(parent, 0o755)
    const link = join(dir, "dispatcher")
    symlinkSync(parent, link)
    const run = Bun.spawnSync([link], {
      cwd: dir,
      env: { HOME: dir, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    })
    expect(run.stdout.toString()).toBe("parent unset\nchild unset\n")
  })
})

describe("bare dispatcher", () => {
  // a copy of the dispatcher folder and the portless-ca.ts, store's rendered.ts, herdr pin, data-dir.ts and the dev stack's proxy.ts it imports in a scratch repo, with ops-herdr, up.py's python3 (its body given) and every command the probes run stubbed, so nothing real starts; a case adds stubs and repo files of its own
  const dispatcher = async (
    python3: string,
    more: Record<string, string> = {},
    files: Record<string, string> = {},
    words: string[] = [],
  ) => {
    // dispatcher finds its repo by realpath, which on macOS puts /private before tmpdir's /var
    const root = mkdtempSync(join(realpathSync(dir), "bare-"))
    const repo = join(root, "repo")
    const src = join(repo, "packages", "scripts", "src")
    cpSync(dirname(CLI), join(src, "playground"), { recursive: true })
    cpSync(join(dirname(CLI), "..", "portless-ca.ts"), join(src, "portless-ca.ts"))
    cpSync(
      join(dirname(CLI), "../../../../api/hono/src/lib/dev/proxy.ts"),
      join(repo, "api/hono/src/lib/dev/proxy.ts"),
    )
    cpSync(
      join(dirname(CLI), "../../../settings/src/rendered.ts"),
      join(repo, "packages/settings/src/rendered.ts"),
    )
    for (const file of ["pin.ts", "pin.json"])
      cpSync(join(dirname(CLI), "../ops-herdr", file), join(src, "ops-herdr", file))
    cpSync(join(dirname(CLI), "../../../env/src"), join(repo, "packages/env/src"), {
      recursive: true,
    })
    symlinkSync(
      join(dirname(CLI), "..", "..", "node_modules"),
      join(repo, "packages", "scripts", "node_modules"),
    )
    await Bun.write(join(src, "ops-herdr", "cli.ts"), "")
    const bin = join(root, "bin")
    const stubs = {
      bunx: "exit 1",
      git: `printf 'worktree ${repo}\\nbranch refs/heads/live/dashboard\\n'`,
      python3,
      security: "exit 1",
      ...more,
    }
    for (const [name, body] of Object.entries(stubs)) {
      await Bun.write(join(bin, name), `#!/bin/sh\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    for (const [path, text] of Object.entries(files)) await Bun.write(join(repo, path), text)
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", join(src, "playground", "cli.ts"), ...words],
      {
        env: { HOME: root, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` },
        stderr: "pipe",
        stdout: "pipe",
      },
    )
    return { child, upPy: `python3 -I ${join(repo, "scripts", "ops", "up.py")}` }
  }

  test("outside cmux it still reaches the jobs step and runs up.py (#1394)", async () => {
    const { child, upPy } = await dispatcher('echo "python3 $*"')
    const deadline = setTimeout(() => child.kill(), 10_000)
    let out = ""
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) {
      out += decoder.decode(chunk)
      if (out.includes(`${upPy}\n`)) break
    }
    clearTimeout(deadline)
    child.kill()
    await child.exited
    expect(await new Response(child.stderr).text()).not.toContain("cmux terminal")
    expect(out).toContain(`Starting the Dashboard…\n${upPy}\n`)
  }, 15_000)

  // up.py's exit 3 says a job is down only because the pass runs outside cmux, so waiting for the Dashboard would only time out
  test("stops non-zero right after up.py exits 3, with no wait for the Dashboard", async () => {
    const { child, upPy } = await dispatcher('echo "python3 $*"; exit 3')
    let killed = false
    const deadline = setTimeout(() => {
      killed = true
      child.kill()
    }, 10_000)
    const code = await child.exited
    clearTimeout(deadline)
    const out = await new Response(child.stdout).text()
    const err = await new Response(child.stderr).text()
    expect(killed).toBe(false)
    expect(code).not.toBe(0)
    expect(out).toEndWith(`Starting the Dashboard…\n${upPy}\n`)
    expect(err).not.toContain("supervisor.log")
  }, 15_000)

  // On a fresh Mac spawn.sh printed a traceback before its refusal, and the run that exited 1 still closed on the Dashboard's own lines.
  test("names the dispatcher spawn.sh refused by its refusal line, last, and exits 1", async () => {
    const server = Bun.serve({ fetch: () => new Response("ok"), hostname: "127.0.0.1", port: 0 })
    const refusal = "spawn.sh refuses dispatcher: it cannot read the live sessions in /x"
    const { child } = await dispatcher(
      "exit 0",
      { bunx: `echo http://127.0.0.1:${server.port}`, open: "exit 0" },
      {
        "scripts/briefs/dispatcher.md": "brief\n",
        "scripts/spawn.sh": `echo 'Traceback (most recent call last):' >&2\necho '${refusal}' >&2\nexit 1\n`,
      },
    )
    const deadline = setTimeout(() => child.kill(), 10_000)
    const code = await child.exited
    clearTimeout(deadline)
    server.stop(true)
    const out = await new Response(child.stdout).text()
    const err = await new Response(child.stderr).text()
    expect(code).toBe(1)
    expect(err).toContain(`playground: ${refusal}\n`)
    expect(err).not.toContain("Traceback")
    expect(out).toEndWith(`Left for you:\n  - The dispatcher didn't start: ${refusal}\n`)
  }, 15_000)

  // The servers Playground started had no stop of the user's own, so a pair that restored another herdr setup's layout stayed up
  test("herdr stop hands ops-herdr its stop-all, which reaches only the sockets in Playground's herdr folder, and keeps its exit", async () => {
    const log = join(mkdtempSync(join(realpathSync(dir), "log-")), "log")
    writeFileSync(log, "")
    const { child } = await dispatcher(
      "exit 0",
      {},
      {
        "packages/scripts/src/ops-herdr/cli.ts": `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(log)}, \`ops-herdr \${process.argv.slice(2).join(" ")}\\n\`)\nconsole.log("ops-herdr: stopped playground")\nprocess.exit(1)\n`,
      },
      ["herdr", "stop"],
    )
    const code = await child.exited
    expect(readFileSync(log, "utf8")).toBe("ops-herdr stop-all\n")
    expect(await new Response(child.stdout).text()).toBe("ops-herdr: stopped playground\n")
    expect(code).toBe(1)
  }, 15_000)
})

describe("a fresh machine", () => {
  // the real CLI on a data folder ext init left: the login and its empty scope, no policy.json yet
  const run = (data: string, words: string[]) =>
    Bun.spawnSync([process.execPath, "--no-env-file", CLI, ...words], {
      env: {
        HOME: dir,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        PLAYGROUND_DATA_DIR: data,
      },
      stderr: "pipe",
      stdout: "pipe",
    })
  const fresh = (name: string) => {
    const data = join(dir, name)
    mkdirSync(join(data, "extensions", "made-up-me"), { recursive: true })
    writeFileSync(join(data, "extensions", "login"), "made-up-me\n")
    return data
  }

  test("add reads the defaults from a root ext init stopped in, with no login or policy.json yet, and goes on to its own checks", () => {
    const data = join(dir, "stopped")
    mkdirSync(join(data, "extensions"), { recursive: true })
    const add = run(data, ["add", "made-up-worker"])
    expect(add.exitCode).toBe(1)
    expect(add.stderr.toString()).not.toContain("policy.json")
    expect(add.stderr.toString()).toContain("made-up-worker gives no kind")
  })

  test("herdr pin --check names the pinned herdr missing from HOME's data folder, exit 1", () => {
    const data = fresh("herdr")
    const check = run(data, ["herdr", "pin", "--check"])
    expect(check.exitCode).toBe(1)
    expect(check.stderr.toString().trim()).toBe(
      `herdr-pin: ${join(dir, ".playground", "bin", "herdr")} is missing; run playground herdr pin`,
    )
  })

  test("settings set writes the first policy.json, with no policy to read the session names from", () => {
    const data = fresh("fresh")
    const set = run(data, [
      "settings",
      "set",
      "factory.repo",
      "made-up-me/copy",
      "--reason",
      "first",
    ])
    expect(set.exitCode, set.stderr.toString()).toBe(0)
    expect(
      JSON.parse(readFileSync(join(data, "extensions", "policy.json"), "utf8")).values,
    ).toMatchObject({ "factory.repo": "made-up-me/copy" })
  })

  test("a policy.json that does not parse refuses in one line, and the settings set it names writes it again", () => {
    const data = fresh("broken")
    writeFileSync(join(data, "extensions", "policy.json"), "{")
    const refused = run(data, ["version"])
    expect(refused.exitCode).toBe(1)
    const said = refused.stderr.toString().trim()
    expect(said.split("\n")).toHaveLength(1)
    expect(said).toStartWith("playground: the extensions' policy.json does not parse (")
    expect(said).toContain("set a setting with playground settings set")
    const set = run(data, ["settings", "set", "factory.repo", "made-up-me/copy", "--reason", "fix"])
    expect(set.exitCode, set.stderr.toString()).toBe(0)
    expect(
      JSON.parse(readFileSync(join(data, "extensions", "policy.json"), "utf8")).values,
    ).toMatchObject({ "factory.repo": "made-up-me/copy" })
    expect(run(data, ["version"]).exitCode).toBe(0)
  })
})

describe("a word too many", () => {
  // each command and subcommand in a shape it takes, so one word more is the only thing wrong
  const SHAPES = [
    ["accounts", "add", "--provider", "glm", "--label", "made-up"],
    ["accounts", "list"],
    ["accounts", "remove", "made-up@example.com"],
    ["add", "made-up-worker"],
    ["alerts-wait", "builder"],
    ["doctor"],
    ["ext", "accept", "made-up", "skill", "key", "abc123"],
    ["ext", "add", "made-up", "made-up/repo"],
    ["ext", "add", "made-up", "made-up/repo", "--dry-run"],
    ["ext", "diff", "made-up", "skill", "key", "--from", "abc", "--to", "def"],
    ["ext", "export", "out"],
    ["ext", "import", "in", "--dry-run"],
    ["ext", "init"],
    ["ext", "link", "made-up", "acme"],
    ["ext", "list", "--kind", "skill"],
    ["ext", "put", "made-up", "skill", "key", "file", "--reason", "why"],
    ["ext", "reject", "made-up", "skill", "key", "abc123"],
    ["ext", "remove", "made-up"],
    ["ext", "score", "made-up", "skill", "key", "abc123", "5", "--reason", "why"],
    ["ext", "show", "made-up", "skill", "key"],
    ["ext", "sync", "made-up"],
    ["ext", "unlink", "made-up", "acme"],
    ["ext", "which", "skill", "--org", "acme"],
    ["ext", "which", "skill", "--repo", "dir"],
    ["ext", "why", "made-up", "skill", "key"],
    ["migrate", "--archive", "dir", "--pre-squash", "abc", "--org", "made-up", "--dry-run"],
    ["orgs", "home"],
    ["orgs", "resolve", "--repo", "dir"],
    ["page", "made-up.html", "--title", "a page", "--by", "made-up-worker"],
    ["rules", "gate"],
    ["settings", "get", "factory.repo"],
    ["settings", "import-jobs", "jobs.json", "--dry-run"],
    ["settings", "list"],
    ["settings", "reset", "factory.repo", "--reason", "why"],
    ["settings", "set", "factory.repo", "made-up/copy", "--reason", "why"],
    ["settings", "why", "factory.repo"],
    ["status"],
    ["sweep", "builder"],
    ["uninstall", "--purge"],
    ["update", "--to", "v1.0.0"],
    ["version"],
    ["view"],
  ]

  test("every command and subcommand refuses it with exit 2 and its usage line, before it runs", async () => {
    const data = join(dir, "too-many")
    mkdirSync(join(data, "extensions", "made-up-me"), { recursive: true })
    writeFileSync(join(data, "extensions", "login"), "made-up-me\n")
    const runs = await Promise.all(
      SHAPES.map(async (shape) => {
        const child = Bun.spawn([process.execPath, "--no-env-file", CLI, ...shape, "stray"], {
          env: {
            HOME: dir,
            PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
            PLAYGROUND_DATA_DIR: data,
          },
          stderr: "pipe",
          stdout: "pipe",
        })
        return { code: await child.exited, err: await new Response(child.stderr).text(), shape }
      }),
    )
    for (const { code, err, shape } of runs) {
      expect({ code, shape }).toEqual({ code: 2, shape })
      expect(err, shape.join(" ")).toContain(`takes no stray`)
      expect(err, shape.join(" ")).toContain(`usage: playground ${shape[0]}`)
    }
  }, 60_000)
})
