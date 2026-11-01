import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-desktop-owner-app"
import { storeWith } from "./render-set"

let scratch = ""
let guarded = ""
let freed = ""
let script = ""
let plain = ""

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "no-desktop-owner-app-"))
  guarded = storeWith(join(scratch, "guarded"), {
    "desktop-owner-apps.json": '["Helium", "Slack"]',
  })
  freed = storeWith(join(scratch, "freed"), { "desktop-owner-apps.json": '["Helium"]' })
  script = join(scratch, "run.sh")
  plain = join(scratch, "plain.sh")
  await Bun.write(script, "#!/bin/bash\nagent-desktop snapshot --app Slack -i\n")
  await Bun.write(plain, "#!/bin/bash\necho ready\n")
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

const bash = (command: string, data = guarded, environment: Record<string, string> = {}) =>
  check(
    JSON.stringify({
      cwd: scratch,
      hook_event_name: "PreToolUse",
      tool_input: { command },
      tool_name: "Bash",
    }),
    { PLAYGROUND_DATA_DIR: data, ...environment },
  )

describe("--headed", () => {
  test.each([
    ["on a ref action", "agent-desktop click @s8f3k2p9:e5 --headed"],
    ["before the command", "agent-desktop --headed snapshot --app Finder"],
    ["with a value", "agent-desktop hover @s8f3k2p9:e5 --headed=true"],
    ["behind bash -c", `bash -c 'agent-desktop click @s8f3k2p9:e5 --headed'`],
    ["behind env", "env agent-desktop click @s8f3k2p9:e5 --headed"],
    ["behind run-slot", "~/.playground/ops/run-slot.sh w -- agent-desktop click @s1:e5 --headed"],
    ["in a pipeline", "echo go | agent-desktop click @s8f3k2p9:e5 --headed | cat"],
    ["through npx", "npx -y agent-desktop@latest click @s8f3k2p9:e5 --headed"],
    ["by its path", "/opt/bin/agent-desktop click @s8f3k2p9:e5 --headed"],
  ])("is refused %s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-desktop-owner-app hook refused")
    expect(reason).toContain("--headed")
    expect(reason).toContain("! prefix")
  })
})

describe("an app on the list", () => {
  test.each([
    ["snapshot --app Slack", "agent-desktop snapshot --app Slack -i"],
    ["in another case", "agent-desktop snapshot --app sLaCk -i"],
    ["with .app", "agent-desktop snapshot --app Slack.app -i"],
    ["as --app=", "agent-desktop screenshot --app=Helium /abs/shot.png"],
    ["by its bundle path", "agent-desktop launch /Applications/Slack.app"],
    ["launch", "agent-desktop launch Slack --activate"],
    ["close-app", "agent-desktop close-app helium --force"],
    ["list-windows", "agent-desktop list-windows --app Slack"],
    ["behind bash -c", `bash -c "agent-desktop snapshot --app Slack"`],
    ["behind sh reading a pipe", "echo 'agent-desktop snapshot --app Slack' | sh"],
  ])("is refused: %s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-desktop-owner-app hook refused")
    expect(reason).toContain("desktop-owner-apps")
  })

  test("names both ways out", async () => {
    const reason = await bash("agent-desktop snapshot --app Slack")
    expect(reason).toContain("! prefix")
    expect(reason).toContain("take Slack off")
  })

  test("passes once the list no longer holds it", async () => {
    expect(await bash("agent-desktop snapshot --app Slack -i", freed)).toBeUndefined()
    expect(await bash("agent-desktop snapshot --app Helium -i", freed)).toContain(
      "no-desktop-owner-app hook refused",
    )
  })
})

describe("a session's own way out is refused", () => {
  const forms = (allow: string, call: string) => [
    ["an env var prefix", `AGENT_DESKTOP_ALLOW=${allow} ${call}`],
    ["export", `export AGENT_DESKTOP_ALLOW=${allow}; ${call}`],
    ["env", `env AGENT_DESKTOP_ALLOW=${allow} ${call}`],
    [
      "a file the session writes",
      `echo 'The owner: "${allow} is fine for this task"' > /abs/brief.md; ${call}`,
    ],
    [
      "the list file written in the same call",
      `echo '[]' > "$PLAYGROUND_DATA_DIR/extensions/hooks/desktop-owner-apps.json"; ${call}`,
    ],
  ]
  test.each([
    ...forms("headed", "agent-desktop click @s8f3k2p9:e5 --headed"),
    ...forms("Slack", "agent-desktop snapshot --app Slack"),
  ])("%s: %s", async (_, command) => {
    expect(await bash(command)).toContain("no-desktop-owner-app hook refused")
  })

  test.each([
    ["headed", "agent-desktop click @s8f3k2p9:e5 --headed"],
    ["Slack", "agent-desktop snapshot --app Slack"],
  ])("the hook's own environment: AGENT_DESKTOP_ALLOW=%s", async (allow, command) => {
    expect(await bash(command, guarded, { AGENT_DESKTOP_ALLOW: allow })).toContain(
      "no-desktop-owner-app hook refused",
    )
  })
})

// The documented limits of a text hook, pinned so the boundary stays visible: a follow-up write guard on the guard lists would close the first.
describe("what the hook does not reach", () => {
  test("a list edited in an earlier call is honoured", async () => {
    const edited = storeWith(join(scratch, "edited"), {
      "desktop-owner-apps.json": '["Helium", "Slack"]',
    })
    expect(await bash("agent-desktop snapshot --app Slack", edited)).toContain("hook refused")
    storeWith(edited, { "desktop-owner-apps.json": '["Helium"]' })
    expect(await bash("agent-desktop snapshot --app Slack", edited)).toBeUndefined()
  })

  test.each([
    ["a program word in a variable", '"$AD" click @s8f3k2p9:e5 --headed'],
    ["a renamed copy of the binary", "/abs/ad snapshot --app Slack"],
  ])("%s, in a call that never names agent-desktop, passes", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })
})

describe("what the hook cannot read is refused", () => {
  test.each([
    ["an app in a variable", `A=Slack; agent-desktop snapshot --app "$A"`],
    ["a flag in a variable", `F=--headed; agent-desktop click @s8f3k2p9:e5 $F`],
    ["a command substitution", "agent-desktop snapshot --app $(cat /abs/app)"],
    ["the program in a variable", `D=agent-desktop; $D click @s8f3k2p9:e5 --headed`],
    ["the program from which", "$(which agent-desktop) snapshot --app Slack"],
    ["xargs filling the arguments", "echo --headed | xargs agent-desktop click @s8f3k2p9:e5"],
    ["a batch", `agent-desktop batch '[{"command":"snapshot","args":["--app","Slack"]}]'`],
    ["a window picked by id", "agent-desktop snapshot --app Finder --window-id 4242"],
    ["a notification action", "agent-desktop notification-action 1 Reply"],
    ["snapshot with no --app", "agent-desktop snapshot -i --compact"],
    ["press with no --app", "agent-desktop press cmd+c"],
    ["focus-window by title alone", "agent-desktop focus-window --title general"],
    ["list-notifications with no --app", "agent-desktop list-notifications"],
    ["an interpreter that runs it", `python3 -c "import os; os.system('agent-desktop --headed')"`],
    [
      "a script written in the same call",
      "echo 'agent-desktop --headed' > /abs/x.sh; bash /abs/x.sh",
    ],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toContain("no-desktop-owner-app hook refused")
  })

  test("a script file that names a listed app", async () => {
    expect(await bash(`bash ${script}`)).toContain("Slack")
    expect(await bash(`source ${script}`)).toContain("no-desktop-owner-app hook refused")
  })
})

describe("passes", () => {
  test.each([
    ["snapshot --app Finder", "agent-desktop snapshot --app Finder --skeleton -i --compact"],
    ["a ref action", "agent-desktop click @s8f3k2p9:e5"],
    ["type into a ref", `agent-desktop type @s8f3k2p9:e5 "Slack is busy"`],
    ["a snapshot under a ref", "agent-desktop snapshot --root @s8f3k2p9:e3 -i --compact"],
    ["wait on a ref", "agent-desktop wait --element @s8f3k2p9:e9 --predicate actionable"],
    ["launch Finder", "agent-desktop launch Finder --activate"],
    ["list-apps", "agent-desktop list-apps"],
    ["the version", "agent-desktop version"],
    ["its docs", "agent-desktop skills get desktop"],
    ["permissions", "agent-desktop permissions"],
    ["a commit naming it", `git commit -m "docs: agent-desktop --headed is refused"`],
    ["an unrelated script", `bash ${join(tmpdir(), "missing-dir", "x.sh")}`],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("a script file with no agent-desktop in it", async () => {
    expect(await bash(`bash ${plain}`)).toBeUndefined()
  })

  test("an empty list guards no app, and --headed stays refused", async () => {
    const none = storeWith(join(scratch, "none"), { "desktop-owner-apps.json": "[]" })
    expect(await bash("agent-desktop snapshot --app Slack", none)).toBeUndefined()
    expect(await bash("agent-desktop click @s8f3k2p9:e5 --headed", none)).toContain("--headed")
  })

  test("a store whose set lacks the list refuses, naming the file and Ops", async () => {
    const missing = storeWith(join(scratch, "missing"), {})
    const reason = await bash("agent-desktop snapshot --app Finder", missing)
    expect(reason).toContain("hooks/desktop-owner-apps.json")
    expect(reason).toContain("route it to Ops")
    expect(reason).not.toContain("ext import")
  })

  test("a call that is not agent-desktop never reads the list", async () => {
    const broken = storeWith(join(scratch, "broken"), { "desktop-owner-apps.json": "{" })
    expect(await bash("ls -la", broken)).toBeUndefined()
    expect(await bash("agent-desktop snapshot --app Finder", broken)).toContain(
      "desktop-owner-apps.json",
    )
  })
})
