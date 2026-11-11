import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const scratch = mkdtempSync(join(tmpdir(), "hc-trial-"))
// Each world's socket folder sits in the user's temp folder, outside the scratch folder, so each goes with it.
afterAll(() => {
  for (let n = 1; n <= worlds; n++) {
    const made = join(scratch, `world-${n}`, "runtime-dir")
    if (existsSync(made))
      rmSync(readFileSync(made, "utf8").trim(), { force: true, recursive: true })
  }
  rmSync(scratch, { force: true, recursive: true })
})

// A fake herdr-core that logs each call's words, so a refused call shows as no line.
const FAKE = `#!/bin/bash
printf '%s\\n' "$*" >> "$(dirname "$0")/../calls"
exit 0
`
let worlds = 0
const makeWorld = () => {
  const world = join(scratch, `world-${++worlds}`)
  mkdirSync(join(world, "bin"), { recursive: true })
  writeFileSync(join(world, "bin", "herdr-core"), FAKE)
  chmodSync(join(world, "bin", "herdr-core"), 0o755)
  writeFileSync(
    join(world, "pin"),
    `${new Bun.CryptoHasher("sha256").update(FAKE).digest("hex")}\n`,
  )
  copyFileSync(join(root, "scripts", "hc-trial.sh"), join(world, "hc"))
  chmodSync(join(world, "hc"), 0o755)
  return world
}
const hc = async (world: string, ...args: string[]) => hcWith(world, {}, ...args)
const hcWith = async (world: string, extra: Record<string, string>, ...args: string[]) => {
  const proc = Bun.spawn([join(world, "hc"), ...args], {
    env: { ...process.env, ...extra },
    stderr: "pipe",
    stdout: "pipe",
  })
  return { code: await proc.exited, err: await new Response(proc.stderr).text() }
}
const calls = (world: string) =>
  existsSync(join(world, "calls")) ? readFileSync(join(world, "calls"), "utf8") : ""

describe("the trial world's wrapper hashes its binary against the pin before every call (#1715)", () => {
  test("a call runs while the binary hashes to its pin, and reuses the socket folder it made", async () => {
    const world = makeWorld()
    expect(await hc(world, "ls")).toEqual({ code: 0, err: "" })
    const runtime = readFileSync(join(world, "runtime-dir"), "utf8")
    expect(await hc(world, "get", "t1")).toEqual({ code: 0, err: "" })
    expect(calls(world)).toBe("ls\nget t1\n")
    expect(readFileSync(join(world, "runtime-dir"), "utf8")).toBe(runtime)
  })

  test("a binary changed after a call that ran is refused at the next call, and never runs", async () => {
    const world = makeWorld()
    expect((await hc(world, "ls")).code).toBe(0)
    writeFileSync(join(world, "bin", "herdr-core"), `${FAKE}# swapped\n`)
    const r = await hc(world, "send", "t1", "hi")
    expect(r.code).toBe(1)
    expect(r.err).toContain("not its pin")
    expect(calls(world)).toBe("ls\n")
  })

  test("a world with no pin is refused", async () => {
    const world = makeWorld()
    rmSync(join(world, "pin"))
    const r = await hc(world, "ls")
    expect(r.code).toBe(1)
    expect(r.err).toContain("(none in")
    expect(calls(world)).toBe("")
  })
})

describe("the trial world's wrapper runs a start, an update or another machine only for spawn.sh's start (#1715)", () => {
  test.each([
    ["a start", ["run", "--bg", "claude"]],
    ["a start behind an option", ["--json", "run", "bash"]],
    ["an update", ["update"]],
    ["another machine", ["machine", "add", "vps"]],
    ["the API over stdin", ["connect"]],
    ["exec on another machine", ["exec", "--on", "vps", "ls"]],
    ["exec on another machine by its joined option", ["exec", "--on=vps", "ls"]],
  ])("%s with no start word is refused, and never runs", async (_, args) => {
    const world = makeWorld()
    const r = await hc(world, ...args)
    expect(r.code).toBe(1)
    expect(r.err).toContain("only spawn.sh probe")
    expect(calls(world)).toBe("")
  })

  test("a start runs once with the word spawn.sh wrote, which it then removes, and a second try is refused", async () => {
    const world = makeWorld()
    writeFileSync(join(world, "start"), "w0rd\n")
    expect(await hcWith(world, { HC_TRIAL_START: "w0rd" }, "run", "bash")).toEqual({
      code: 0,
      err: "",
    })
    expect(existsSync(join(world, "start"))).toBe(false)
    expect((await hcWith(world, { HC_TRIAL_START: "w0rd" }, "run", "bash")).code).toBe(1)
    expect(calls(world)).toBe("run bash\n")
  })

  test("a start with a word other than the one written is refused, and the word is gone", async () => {
    const world = makeWorld()
    writeFileSync(join(world, "start"), "w0rd\n")
    expect((await hcWith(world, { HC_TRIAL_START: "guess" }, "run", "bash")).code).toBe(1)
    expect(existsSync(join(world, "start"))).toBe(false)
    expect(calls(world)).toBe("")
  })

  test("the binary takes the shell basics alone of its caller's environment", async () => {
    const world = makeWorld()
    writeFileSync(
      join(world, "bin", "herdr-core"),
      `#!/bin/bash\nenv | sort > "$(dirname "$0")/../env"\n`,
    )
    writeFileSync(
      join(world, "pin"),
      `${new Bun.CryptoHasher("sha256").update(readFileSync(join(world, "bin", "herdr-core"))).digest("hex")}\n`,
    )
    expect(
      (
        await hcWith(
          world,
          { ANTHROPIC_API_KEY: "k", HERDR_PANE_ID: "w1:p1", PLAYGROUND_ROLE: "worker" },
          "ls",
        )
      ).code,
    ).toBe(0)
    const names = readFileSync(join(world, "env"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(0, line.indexOf("=")))
      .filter((name) => name !== "_" && name !== "PWD" && name !== "SHLVL")
    expect(names).toEqual([
      "HC_SESSION",
      "HOME",
      "LANG",
      "LOGNAME",
      "PATH",
      "SHELL",
      "SSH_CONNECTION",
      "TERM",
      "USER",
      "XDG_CONFIG_HOME",
      "XDG_RUNTIME_DIR",
      "XDG_STATE_HOME",
    ])
  })
})
