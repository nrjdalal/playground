import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { bin, placing, root, spawn, type Spawned } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them.
setDefaultTimeout(40_000)

const NAME = "dispatcher"
const START = ["manager", NAME, "b.md", "--harness", "codex"]
const THREAD = "0f9a1c2e-3b4d-4e5f-8a6b-7c8d9e0f1a2b"

// A case's own fakes ahead of spawn-fake's: codex, which logs its argv and answers each app-server request with an empty result, and sleep, the wait's clock, which ticks at once, logging each tick, and lands the SessionStart beat at its first tick unless FAKE_NO_BEAT says the hooks never loaded.
const fakes = (home: string) => {
  const dir = join(home, "fakebin")
  mkdirSync(dir, { recursive: true })
  const write = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  write(
    "codex",
    `printf '%s\\n' "$*" >> "$HOME/codex.args"
[ "$1" = app-server ] || exit 0
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$HOME/codex-app-server.log"
  id=$(python3 -I -c 'import json, sys; print(json.loads(sys.argv[1]).get("id", ""))' "$line")
  [ -z "$id" ] || printf '{"id":%s,"result":{}}\\n' "$id"
done`,
  )
  write(
    "sleep",
    `echo "$*" >> "$HOME/sleep.calls"
[ -n "$FAKE_NO_BEAT" ] || [ -e "$HOME/beat.sent" ] && exit 0
: > "$HOME/beat.sent"
printf '{"session_id":"${THREAD}","source":"startup"}\\n' > "$PLAYGROUND_DATA_DIR/launch/${NAME}.beat"`,
  )
}

// Every case runs on a scratch data folder, the one place a Codex session starts before phase 3, unless it says LIVE_DATA.
const run = (args: string[], env: Record<string, string> = {}, pin?: string) =>
  spawn(
    args,
    [],
    {
      PATH: `{home}/fakebin:${bin}:${process.env.PATH}`,
      ...(env.LIVE_DATA ? {} : { SCRATCH_DATA: "1" }),
      ...env,
    },
    undefined,
    pin ? { backend: pin, name: NAME } : undefined,
    fakes,
  )

const data = (r: Spawned, ...parts: string[]) => join(r.home, "scratch-data", ...parts)
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null)
const launchText = (r: Spawned) => {
  const dir = data(r, "launch")
  const file = readdirSync(dir).find((f) => f.endsWith(".sh"))
  return file ? readFileSync(join(dir, file), "utf8") : ""
}

describe("spawn.sh --harness codex starts the dispatcher in Codex, failing closed", () => {
  test("hooks not loaded: start refused", async () => {
    const r = await run(START, { FAKE_NO_BEAT: "1" })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("spawn.sh refuses")
    expect(r.err).toContain("SessionStart")
    // the wait ran its whole 60 seconds on the fake clock, 120 ticks of 0.5, then ended the session it had started
    expect(read(join(r.home, "sleep.calls"))?.split("\n").filter(Boolean)).toEqual(
      Array(120).fill("0.5"),
    )
    expect(placing(r).some((c) => c[0] === "pane" && c[1] === "close" && c[2] === "w5:p1")).toBe(
      true,
    )
    expect(read(data(r, "backends", NAME))).toBeNull()
    expect(read(data(r, "resume", `${NAME}.sh`))).toBeNull()
    expect(readdirSync(data(r, "launch")).filter((f) => !f.endsWith(".herdr"))).toEqual([])
    expect(r.rosterLog ?? []).toEqual([])
  })

  test("a pane herdr will not close is refused in its own words, never read as closed", async () => {
    const r = await run(START, { FAKE_HERDR_CLOSE_FAIL: "1", FAKE_NO_BEAT: "1" })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "herdr would not close dispatcher's pane w5:p1, so the session may still run",
    )
    expect(r.err).not.toContain("is closed")
    expect(read(data(r, "backends", NAME))).toBeNull()
  })

  test("a start whose beat lands runs with hooks trusted, named, pinned and recorded", async () => {
    const r = await run(START)
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    const launch = launchText(r)
    expect(launch).toContain(`CODEX_HOME=${data(r, "codex")}`)
    expect(launch).toContain(`SPAWN_CODEX_BEAT=${data(r, "launch", `${NAME}.beat`)}`)
    expect(launch).toContain(
      `${join(r.home, "fakebin", "codex")} --dangerously-bypass-hook-trust "`,
    )
    expect(launch).not.toContain(" claude ")
    // the launch's own CODEX_HOME trusts the folder, keeps the login in a file, and its hooks write the beat whole, through a file moved into place
    expect(read(data(r, "codex", "config.toml"))).toContain(`[projects."`)
    expect(read(data(r, "codex", "hooks.json"))).toContain('mv \\"$f.tmp\\" \\"$f\\"')
    expect(read(join(r.home, "codex-app-server.log"))).toContain(
      `"method":"thread/name/set","params":{"name":"${NAME}","threadId":"${THREAD}"}`,
    )
    expect(read(data(r, "backends", NAME))).toBe("codex openai\n")
    expect(read(data(r, "resume", `${NAME}.sh`))).toContain(`/scripts/spawn.sh resume ${NAME} `)
    expect(read(data(r, "resume", `${NAME}.sh`))).toContain(` ${THREAD}\n`)
  })

  test("a resume from a codex pin resumes its thread with hooks trusted", async () => {
    const r = await run(["resume", NAME, root, THREAD], {}, "codex openai")
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(launchText(r)).toContain(
      `${join(r.home, "fakebin", "codex")} resume --dangerously-bypass-hook-trust ${THREAD} "`,
    )
    expect(read(data(r, "backends", NAME))).toBe("codex openai\n")
  })

  // No factory guard reaches a Codex session until phase 3 wires them into its hooks, so the live data folder takes no Codex start or resume.
  test.each([
    ["a start", START, undefined],
    ["a resume", ["resume", NAME, root, THREAD], "codex openai"],
  ])("refuses %s on the live data folder, naming phase 3", async (_, args, pin) => {
    const r = await run(args, { LIVE_DATA: "1" }, pin)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("spawn.sh refuses")
    expect(r.err).toContain("phase 3")
    expect(placing(r)).toEqual([])
    expect(read(join(r.home, "codex.args"))).toBeNull()
  })

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md", "--harness", "codex"]],
    ["GLM", [...START, "--backend", "glm"]],
    ["a second account", [...START, "--account", "second@example.org"]],
    ["a Claude model", [...START, "--model", "opus"]],
  ])("refuses %s in Codex", async (_, args) => {
    const r = await run(args)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("Codex")
    expect(read(join(r.home, "codex.args"))).toBeNull()
  })
})
