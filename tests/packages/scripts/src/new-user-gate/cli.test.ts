import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BOX_LOAD_MULT,
  capacityRefusals,
  leftForYou,
  report,
  scriptsGroup,
  strayStandIns,
  usageWords,
  zshStartup,
} from "../../../../../packages/scripts/src/new-user-gate/cli"
import { stubs } from "../../../../../packages/scripts/src/new-user-gate/stubs"

describe("the new-user gate's reads", () => {
  test("reads install.sh's Left for you lines, and none from a clean finish", () => {
    expect(
      leftForYou(
        "Playground needs git...\nLeft for you:\n  - node: brew install node\ninstall.sh exit 1",
      ),
    ).toEqual(["node: brew install node"])
    expect(leftForYou("Playground is ready.\ninstall.sh exit 0")).toEqual([])
  })

  test("takes a usage reading as shown, and No usage windows read as none", () => {
    expect(usageWords("Alpha\nClaude usage: week 12% left, 5-hour 80% left\n")).toBe(
      "week 12% left, 5-hour 80% left",
    )
    expect(usageWords("Alpha\nClaude usage: No usage windows read\n")).toBeNull()
    expect(usageWords("Alpha\nClaude usage: Not read yet\n")).toBeNull()
    expect(usageWords("Alpha")).toBeNull()
  })

  test("finds the Scripts group by its header, with or without its count, and not by a row's words", () => {
    expect(scriptsGroup("Alpha\nScripts\n2\nClaude usage readings")).toBe(true)
    expect(scriptsGroup("Alpha\nScripts 2\n")).toBe(true)
    expect(scriptsGroup("Alpha\nScripts2\n")).toBe(true)
    expect(scriptsGroup("Alpha is not running\nEvery agent's state is on the System page.")).toBe(
      false,
    )
    expect(scriptsGroup("Script · Failing · every minute")).toBe(false)
  })

  test("prints PASS or FAIL per step with its detail, then the count", () => {
    expect(
      report([
        { detail: "", name: "curl | bash exits 0", ok: true },
        { detail: "no usage reading", name: "Usage shows", ok: false },
      ]),
    ).toBe("PASS 1. curl | bash exits 0\nFAIL 2. Usage shows: no usage reading\n1 of 2 passed")
  })
})

describe("a step failed on spawn.sh's capacity gate", () => {
  // two rows as spawn.sh's gate_capacity writes them to capacity.jsonl: a pass, then the load refusal a box met at load 26.9
  const log = [
    JSON.stringify({
      at: "2026-10-31T01:30:00Z",
      detail: "",
      gate: "",
      readings: { load5: 9.1 },
      verdict: "pass",
    }),
    JSON.stringify({
      at: "2026-10-31T01:31:05Z",
      detail:
        "max(load1, load5) is 26.90 and 0 started in the last 5 minutes, at or over 11.25: 15, the 15 cores at PLAYGROUND_LOAD_MULT 1, less the 3.75 kept for small items (this start is medium); the CPU is 80% busy (top), 12 of the 15 cores, which with the starts is at or over 11.25 too. Wait for it to fall, or close a session that is done, and run it again.",
      gate: "load",
      readings: { load5: 26.9 },
      verdict: "refused",
    }),
    "not json",
  ].join("\n")

  test("names each refusal since the step began, by its gate and its words, and none from before it", () => {
    expect(capacityRefusals(log, "2026-10-31T01:31:00Z")).toEqual([
      expect.stringMatching(/^load gate: max\(load1, load5\) is 26\.90 .* at or over 11\.25/),
    ])
    expect(capacityRefusals(log, "2026-10-31T01:32:00Z")).toEqual([])
  })

  test("reads INCONCLUSIVE, not FAIL, and counts it apart", () => {
    expect(
      report([
        { detail: "", name: "curl | bash exits 0", ok: true },
        {
          detail: "spawn.sh's capacity gate refused a start (load gate: …)",
          inconclusive: true,
          name: "Alpha routes",
          ok: false,
        },
      ]),
    ).toBe(
      "PASS 1. curl | bash exits 0\nINCONCLUSIVE 2. Alpha routes: spawn.sh's capacity gate refused a start (load gate: …)\n1 of 2 passed, 1 inconclusive",
    )
  })
})

describe("the gate's stand-ins preflight", () => {
  const box = realpathSync(mkdtempSync(join(tmpdir(), "gate-preflight-")))
  afterAll(() => rmSync(box, { force: true, recursive: true }))
  const home = join(box, "h")
  mkdirSync(join(box, "stubs"), { recursive: true })
  mkdirSync(home, { recursive: true })
  const names = Object.keys(stubs(box, ""))
  for (const [name, text] of Object.entries(stubs(box, ""))) {
    writeFileSync(join(box, "stubs", name), text)
    chmodSync(join(box, "stubs", name), 0o755)
  }

  test("with no startup files, the box's zsh finds security outside the stubs folder, and the preflight names it", () => {
    const stray = strayStandIns(box, home, names)
    expect(stray.filter((line) => /^-l?c security\b/.test(line))).toHaveLength(2)
  })

  test("the box's startup relaxes spawn.sh's load gate by BOX_LOAD_MULT, read as a number over 1", () => {
    const set = Bun.spawnSync(
      ["zsh", "-c", `${zshStartup(box)}print -r -- $PLAYGROUND_LOAD_MULT`],
      {
        env: { HOME: home, PATH: "/usr/bin:/bin" },
      },
    )
    expect(set.stdout.toString().trim()).toBe(String(BOX_LOAD_MULT))
    expect(BOX_LOAD_MULT).toBeGreaterThan(1)
  })

  test("with the box's startup files, every stand-in resolves to the stubs folder in a plain and a login zsh", () => {
    for (const rc of [".zshenv", ".zprofile"]) writeFileSync(join(home, rc), zshStartup(box))
    expect(strayStandIns(box, home, names)).toEqual([])
  })
})
