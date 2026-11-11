import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { bin, lw, placing, root, spawn, type Spawned } from "./spawn-fake"

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
printf '{"session_id":"${THREAD}","source":"startup"}\\n' > "$HOME/.playground/launch/${NAME}.beat"`,
  )
}

const run = (args: string[], env: Record<string, string> = {}, pin?: string) =>
  spawn(
    args,
    [],
    { PATH: `{home}/fakebin:${bin}:${process.env.PATH}`, ...env },
    undefined,
    pin ? { backend: pin, name: NAME } : undefined,
    fakes,
  )

const read = (r: Spawned, ...parts: string[]) => {
  const path = join(r.home, ...parts)
  return existsSync(path) ? readFileSync(path, "utf8") : null
}
const launchText = (r: Spawned) => {
  const dir = lw(r.home, "launch")
  const file = readdirSync(dir).find((f) => f.endsWith(".sh"))
  return file ? readFileSync(join(dir, file), "utf8") : ""
}

describe("spawn.sh --harness codex starts the dispatcher in Codex, failing closed", () => {
  test("hooks not loaded: start refused", async () => {
    const r = await run(START, { FAKE_NO_BEAT: "1" })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("spawn.sh refuses")
    expect(r.err).toContain("SessionStart")
    // the wait ran its whole length on the fake clock, then ended the session it had started
    expect(read(r, "sleep.calls")?.split("\n").filter(Boolean).length).toBeGreaterThan(1)
    expect(placing(r).some((c) => c[0] === "pane" && c[1] === "close" && c[2] === "w5:p1")).toBe(
      true,
    )
    expect(read(r, ".playground", "backends", NAME)).toBeNull()
    expect(read(r, ".playground", "resume", `${NAME}.sh`)).toBeNull()
    expect(readdirSync(lw(r.home, "launch")).filter((f) => !f.endsWith(".herdr"))).toEqual([])
    expect(r.rosterLog ?? []).toEqual([])
  })

  test("a start whose beat lands runs with hooks trusted, named, pinned and recorded", async () => {
    const r = await run(START)
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    const launch = launchText(r)
    expect(launch).toContain(`CODEX_HOME=${lw(r.home, "codex")}`)
    expect(launch).toContain(`PLAYGROUND_CODEX_BEAT=${lw(r.home, "launch", `${NAME}.beat`)}`)
    expect(launch).toContain(
      `${join(r.home, "fakebin", "codex")} --dangerously-bypass-hook-trust "`,
    )
    expect(launch).not.toContain(" claude ")
    // the launch's own CODEX_HOME trusts the folder, keeps the login in a file, and its hooks write the beat
    expect(read(r, ".playground", "codex", "config.toml")).toContain(`[projects."`)
    expect(read(r, ".playground", "codex", "hooks.json")).toContain("PLAYGROUND_CODEX_BEAT")
    expect(read(r, "codex-app-server.log")).toContain(
      `"method":"thread/name/set","params":{"name":"${NAME}","threadId":"${THREAD}"}`,
    )
    expect(read(r, ".playground", "backends", NAME)).toBe("codex openai\n")
    expect(read(r, ".playground", "resume", `${NAME}.sh`)).toContain(
      `/scripts/spawn.sh resume ${NAME} `,
    )
    expect(read(r, ".playground", "resume", `${NAME}.sh`)).toContain(` ${THREAD}\n`)
  })

  test("a resume from a codex pin resumes its thread with hooks trusted", async () => {
    const r = await run(["resume", NAME, root, THREAD], {}, "codex openai")
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(launchText(r)).toContain(
      `${join(r.home, "fakebin", "codex")} resume --dangerously-bypass-hook-trust ${THREAD} "`,
    )
    expect(read(r, ".playground", "backends", NAME)).toBe("codex openai\n")
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
    expect(read(r, "codex.args")).toBeNull()
  })
})
