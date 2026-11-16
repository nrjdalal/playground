import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { OLD } from "../session-names"
import {
  bin,
  execLine,
  launchOf,
  lw,
  paneRun,
  placing,
  root,
  scratch,
  spawn,
  TOKEN,
  transcript,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them.
setDefaultTimeout(40_000)

// A fake ssh ahead of spawn-fake's bin: it logs each call's words, keeps the copy's tar stream, and runs the -tt call's remote command in bash, as the other machine's shell would.
const sshBin = join(scratch, "ssh-bin")
mkdirSync(sshBin, { recursive: true })
writeFileSync(
  join(sshBin, "ssh"),
  `#!/bin/bash
printf '%s\\037' "$@" >> "$HOME/ssh.calls"; echo >> "$HOME/ssh.calls"
case " $* " in *" -tt "*) exec bash -c "\${!#}" ;; *) cat > "$HOME/ssh.stdin" ;; esac
`,
)
chmodSync(join(sshBin, "ssh"), 0o755)
const sshCalls = (home: string) =>
  readFileSync(join(home, "ssh.calls"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x1f").slice(0, -1))

const key = (home: string) => {
  writeFileSync(join(home, "key"), "fake key\n")
}
const probe = ["probe", "probe-far", OLD.ops, "b.md"]
const ssh = ["--ssh", "pride@spark-bravo", "--key", "{home}/key"]

describe("--remote-control and --ssh are a probe's start alone", () => {
  test.each([
    ["--remote-control", ["--remote-control", "rc-a"]],
    ["--ssh", ssh],
    ["--key", ["--key", "{home}/key"]],
  ])("%s is refused in every mode but probe, naming the flag and the mode", async (flag, words) => {
    for (const [mode, args] of [
      ["worker", ["worker", "worker-brave-otter", "b.md"]],
      ["runner", ["runner", "runner-calm-heron", "b.md"]],
      ["column", ["column", "probe", "probe-x", "worker-y", "w1:p2", "b.md"]],
      ["resume", ["resume", OLD.ops, root, "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"]],
    ] as const) {
      const r = await spawn([...args, ...words], [], {}, undefined, undefined, key)
      expect(r.code).toBe(2)
      expect(r.err).toContain(`${flag} is for a probe's start (spawn.sh probe), not a ${mode}'s`)
      expect(placing(r)).toEqual([])
    }
  })
})

describe("--remote-control", () => {
  test("passes Claude Code's --remote-control <name> and keeps the probe's row", async () => {
    const r = await spawn([...probe, "--remote-control", "rc-a"], [])
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain(" --dangerously-skip-permissions --remote-control rc-a ")
    expect(r.roster).toContain("kind=probe")
    expect(execLine(r, "probe-far")).toEndWith(" --remote-control rc-a")
  })

  test.each([["Bad Name"], ["--ssh"], ["a;b"]])("refuses the name %p", async (name) => {
    const r = await spawn([...probe, "--remote-control", name], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--remote-control")
    expect(placing(r)).toEqual([])
  })
})

describe("--ssh runs the probe's claude on another machine", () => {
  test("the pane copies the settings and skills into one remote folder, then runs claude there under ssh -tt", async () => {
    const email = "spare@example.com"
    const r = await spawn([...probe, ...ssh, "--account", email], [], {}, undefined, undefined, key)
    expect(r.code).toBe(0)
    expect(r.roster).toContain("kind=probe")
    const launch = launchOf(r)
    const remote = launch.match(/mkdir -m 700 (\/tmp\/playground-probe-far\.[A-Za-z0-9]{6})/)?.[1]
    expect(remote).toBeDefined()
    expect(launch).not.toContain(TOKEN)

    const pane = await paneRun(r, { PATH: `${sshBin}:${bin}:${process.env.PATH}` })
    expect(pane.code).toBe(0)
    const calls = sshCalls(r.home)
    const opts = ["-i", join(r.home, "key"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"]
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual([
      ...opts,
      "pride@spark-bravo",
      `mkdir -m 700 ${remote} && tar -xf - -C ${remote}`,
    ])
    expect(calls[1]?.slice(0, -1)).toEqual([...opts, "-tt", "pride@spark-bravo"])
    const command = calls[1]?.at(-1) ?? ""
    expect(command).toStartWith(`cd ${root} && export TMPDIR=${remote} PLAYGROUND_REPO=`)
    expect(command).toContain(
      `tk="$(security find-generic-password -s playground-claude-oauth -a ${email} -w)"`,
    )

    // The copy holds two names, each relative, so nothing lands outside the remote folder.
    const listed = Bun.spawnSync(["tar", "-tf", join(r.home, "ssh.stdin")]).stdout.toString()
    const entries = listed.split("\n").filter(Boolean)
    expect(entries.every((e) => !e.startsWith("/") && !e.split("/").includes(".."))).toBe(true)
    const tops = [...new Set(entries.map((e) => e.split("/")[0]))].sort()
    expect(tops).toHaveLength(2)
    expect(tops.some((t) => /^factory-settings-sandbox-.*\.json$/.test(t ?? ""))).toBe(true)

    // The remote shell ran claude with its settings and skills from that folder, the token in no word.
    const args = readFileSync(join(r.home, "claude.args"), "utf8")
    expect(args).toContain(`--settings ${remote}/factory-settings-sandbox-`)
    expect(args).toMatch(new RegExp(`--plugin-dir ${remote}/[0-9a-f]+ `))
    expect(args).not.toContain(TOKEN)
    expect(readFileSync(join(r.home, "ssh.calls"), "utf8")).not.toContain(TOKEN)
    expect([r.out, r.err, ...(r.roster ?? [])].join("\n")).not.toContain(TOKEN)
    expect(execLine(r, "probe-far")).toEndWith(
      ` --account ${email} --ssh pride@spark-bravo --key ${join(r.home, "key")}`,
    )
  })

  test.each([
    ["an option for a host", ["--ssh", "-oProxyCommand=x@h", "--key", "{home}/key"], "--ssh"],
    ["a host with no user", ["--ssh", "spark-bravo", "--key", "{home}/key"], "--ssh"],
    ["a host with a space", ["--ssh", "a b@h", "--key", "{home}/key"], "--ssh"],
    ["a host with a shell word", ["--ssh", "u@h;id", "--key", "{home}/key"], "--ssh"],
    ["a relative key", ["--ssh", "u@h", "--key", "key"], "--key"],
    ["a missing key", ["--ssh", "u@h", "--key", "{home}/none"], "--key"],
    ["a folder for a key", ["--ssh", "u@h", "--key", "{home}"], "--key"],
    ["--ssh with no --key", ["--ssh", "u@h"], "--ssh needs --key"],
    ["--key with no --ssh", ["--key", "{home}/key"], "--key needs --ssh"],
  ])("refuses %s before any pane opens", async (_, words, says) => {
    const r = await spawn([...probe, ...words], [], {}, undefined, undefined, key)
    expect(r.code).toBe(2)
    expect(r.err).toContain(says)
    expect(placing(r)).toEqual([])
    expect(existsSync(lw(r.home, "launch", "probe-far.sh"))).toBe(false)
  })
})

describe("restore leaves a remote probe down", () => {
  test("a record carrying --ssh or --remote-control is skipped with its reason", async () => {
    const sid = "eeeeeeee-0000-4000-8000-0000000000e1"
    const r = await spawn(["restore"], [], {}, undefined, undefined, (home) => {
      for (const dir of ["resume", "runtimes", "backends"])
        mkdirSync(lw(home, dir), { recursive: true })
      for (const [name, extra] of [
        ["probe-far", "--ssh u@h --key /k"],
        ["probe-rc", "--remote-control rc-a"],
      ]) {
        writeFileSync(
          lw(home, "resume", `${name}.sh`),
          `#!/bin/bash\n# server: playground\nexec /x/scripts/spawn.sh resume ${name} ${root} ${sid} ${extra}\n`,
        )
        writeFileSync(lw(home, "runtimes", name), "herdr\n")
      }
      transcript(home, sid)
    })
    const reason =
      "it started with --ssh or --remote-control, a probe's start alone, so restore leaves it down"
    expect(r.out).toBe(`skipped probe-far: ${reason}\nskipped probe-rc: ${reason}\n`)
    expect(placing(r)).toEqual([])
  })
})
