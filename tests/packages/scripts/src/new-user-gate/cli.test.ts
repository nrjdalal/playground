import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
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

  test("with the box's startup files, every stand-in resolves to the stubs folder in a plain and a login zsh", () => {
    for (const rc of [".zshenv", ".zprofile"]) writeFileSync(join(home, rc), zshStartup(box))
    expect(strayStandIns(box, home, names)).toEqual([])
  })

  test("the box's startup sends the profile read and ops-usage's probe to a closed loopback port", () => {
    expect(zshStartup(box)).toContain("export PLAYGROUND_PROFILE_URL=http://127.0.0.1:9/profile\n")
    expect(zshStartup(box)).toContain(
      "export PLAYGROUND_PROBE_URL=http://127.0.0.1:9/v1/messages\n",
    )
  })
})
