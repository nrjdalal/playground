import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  commandOf,
  COMMANDS,
  probe,
  type Probe,
} from "../../../../../../api/hono/src/lib/system/probe"

// One argument of the kind each probe takes, so every argv can be built.
const SAMPLE: Partial<Record<Probe, unknown>> = {
  cwds: 501,
  socketHolder: "/Users/n/.orbstack/run/docker.sock",
  sockets: 501,
  starts: [9919, 11239],
}
const argvOf = (name: Probe): string[] =>
  (commandOf as (name: Probe, ...args: unknown[]) => string[])(
    name,
    ...(name in SAMPLE ? [SAMPLE[name]] : []),
  )

describe("commandOf", () => {
  test("every probe is a fixed argv: a program and its flags, never a shell", () => {
    const shells = new Set(["bash", "sh", "zsh", "env", "xargs"])
    for (const name of Object.keys(COMMANDS) as Probe[]) {
      const argv = argvOf(name)
      expect(shells.has(argv[0] ?? "")).toBe(false)
      expect(argv.some((arg) => arg === "-c")).toBe(false)
    }
  })

  test("only reads: sysctl is never handed a value to set, and memory_pressure, which can simulate pressure, is not run", () => {
    const all = (Object.keys(COMMANDS) as Probe[]).flatMap(argvOf)
    expect(
      commandOf("sysctl")
        .slice(1)
        .every((arg) => !arg.includes("=") && arg !== "-w"),
    ).toBe(true)
    expect(all).not.toContain("memory_pressure")
    expect(commandOf("containerStats")).toContain("--no-stream")
  })

  test("a uid is a whole number and a socket an absolute path, so neither can become a flag", () => {
    expect(commandOf("cwds", 501)).toContain("501")
    expect(() => commandOf("cwds", -1)).toThrow("cannot take")
    expect(() => commandOf("cwds", 1.5)).toThrow("cannot take")
    expect(() => commandOf("socketHolder", "-r")).toThrow("cannot take")
    expect(() => commandOf("socketHolder", "relative/docker.sock")).toThrow("cannot take")
    expect(() => commandOf("socketHolder", "/a\nb")).toThrow("cannot take")
  })

  test("a start-time read takes whole-number pids alone, at least one", () => {
    expect(commandOf("starts", [9919, 11239])).toEqual([
      "ps",
      "-o",
      "pid=,lstart=",
      "-p",
      "9919,11239",
    ])
    expect(() => commandOf("starts", [])).toThrow("cannot take")
    expect(() => commandOf("starts", [-1])).toThrow("cannot take")
    expect(() => commandOf("starts", [1.5])).toThrow("cannot take")
    expect(() => commandOf("starts", ["-A" as unknown as number])).toThrow("cannot take")
  })
})

// A command that traps TERM, or a child holding its stdout open, must not hold a probe past its timeout: the kill is bounded
test("probe() settles when its command traps TERM, killed after a short grace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-fake-"))
  const path = process.env.PATH
  const live = process.env.PLAYGROUND_LIVE_READS
  try {
    writeFileSync(join(dir, "ps"), "#!/bin/sh\ntrap '' TERM\nsleep 20 &\nwait\n")
    chmodSync(join(dir, "ps"), 0o755)
    process.env.PATH = `${dir}:${path}`
    process.env.PLAYGROUND_LIVE_READS = "1"
    const started = Date.now()
    const error = await probe("starts", [1]).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("ps -o ran past 5s")
    expect(Date.now() - started).toBeLessThan(15_000)
  } finally {
    process.env.PATH = path
    if (live === undefined) delete process.env.PLAYGROUND_LIVE_READS
    else process.env.PLAYGROUND_LIVE_READS = live
    rmSync(dir, { force: true, recursive: true })
  }
}, 30_000)
