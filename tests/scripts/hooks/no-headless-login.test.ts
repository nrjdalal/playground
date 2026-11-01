import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { accountSettings } from "../../../packages/settings/src/accounts"
import { settingsFor } from "../../../packages/settings/src/settings"
import { check, KEYCHAIN_SERVICE } from "../../../scripts/hooks/no-headless-login"
import { OLD_NAMES } from "../../session-names"
import { storeWith } from "./render-set"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-headless-login.ts")
const slackLink = join(root, "scripts", "hooks", "no-bare-slack-link.ts")
const SHAPE =
  'tk="$(security find-generic-password -s playground-claude-oauth -a a@b.c -w)"; CLAUDE_CODE_OAUTH_TOKEN="$tk" PLAYGROUND_ROLE=worker env -u CLAUDE_CONFIG_DIR -u ANTHROPIC_API_KEY claude -p "score it"'

let dir: string
let home: string
let config: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "headless-"))
  home = join(dir, "home")
  config = join(dir, "config")
  await mkdir(join(config, "playground", "resume"), { recursive: true })
  await mkdir(join(config, "sessions"), { recursive: true })
  storeWith(join(config, "playground"), {}, { "sessions.aliases": OLD_NAMES })
  await writeFile(
    join(config, "sessions", "1.json"),
    JSON.stringify({ name: "dispatcher", sessionId: "s-dispatcher" }),
  )
  await writeFile(
    join(config, "sessions", "2.json"),
    JSON.stringify({ name: "worker-picked", sessionId: "s-picked" }),
  )
  await writeFile(
    join(config, "playground", "resume", "worker-picked.sh"),
    "# server: factory\n# account: picked@example.com\nexec scripts/spawn.sh resume worker-picked /x 1234\n",
  )
  await writeFile(
    join(config, "playground", "resume", "dispatcher.sh"),
    "exec scripts/spawn.sh resume dispatcher /x 1234 --account nd@example.com\n",
  )
})

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

const input = (command: string, sessionId = "s-other") =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: { command },
    tool_name: "Bash",
  })
const worker = {
  CLAUDE_CONFIG_DIR: "/nonexistent",
  HOME: "/nonexistent",
  PLAYGROUND_ROLE: "worker",
}
const restored = () => ({
  CLAUDE_CONFIG_DIR: config,
  PLAYGROUND_DATA_DIR: join(config, "playground"),
  HOME: home,
})

describe("a factory session's headless claude that would bill this machine's login is refused, with the shape", () => {
  test.each([
    "claude -p 'score it'",
    "arr=($(claude -p hi))",
    "claude --print 'score it'",
    "claude --model claude-opus-5-5 -p hi",
    "cd /tmp && claude -p hi",
    "env -u ANTHROPIC_API_KEY claude -p hi",
    "OTHER=1 claude -p hi",
    "CLAUDE_CODE_OAUTH_TOKEN= claude -p hi",
    "bash -c 'claude -p hi'",
    "for i in 1 2; do claude -p hi; done",
  ])("%s", async (command) => {
    const reason = await check(input(command), worker)
    expect(reason).toContain("no-headless-login hook refuses a headless claude")
    expect(reason).toContain('CLAUDE_CODE_OAUTH_TOKEN="$tk" PLAYGROUND_ROLE=worker env -u')
  })

  test("the shape names the session's own account from its resume record, and its role", async () => {
    const reason = await check(input("claude -p hi", "s-dispatcher"), restored())
    expect(reason).toContain("-a nd@example.com -w")
    expect(reason).toContain("PLAYGROUND_ROLE=dispatcher")
  })

  test("the shape names a login spawn.sh's usage gate picked, from the record's account line (PG-2137)", async () => {
    expect(await check(input("claude -p hi", "s-picked"), restored())).toContain(
      "-a picked@example.com -w",
    )
  })

  test("the shape reads the token from usage.keychainService, its default with no extensions", async () => {
    expect(KEYCHAIN_SERVICE).toBe(
      accountSettings.get(settingsFor([], "me"), "usage.keychainService"),
    )
    expect(await check(input("claude -p hi"), worker)).toContain(
      `find-generic-password -s ${KEYCHAIN_SERVICE} -a`,
    )
    const data = storeWith(join(dir, "data"), {}, { "usage.keychainService": "made-up-service" })
    expect(await check(input("claude -p hi"), { ...worker, PLAYGROUND_DATA_DIR: data })).toContain(
      "find-generic-password -s made-up-service -a",
    )
  })

  test("with no resume record, the account is left for the session to fill", async () => {
    expect(await check(input("claude -p hi"), worker)).toContain("-a <your --account> -w")
  })

  test("a session whose role is not in its environment must set it too", async () => {
    const command = 'tk=x; CLAUDE_CODE_OAUTH_TOKEN="$tk" claude -p hi'
    expect(await check(input(command, "s-dispatcher"), restored())).toContain(
      "does not set PLAYGROUND_ROLE",
    )
    expect(await check(input(command), worker)).toBeUndefined()
  })
})

describe("a headless claude that sets the token, or a command that only names one, runs", () => {
  test.each([
    SHAPE,
    'export CLAUDE_CODE_OAUTH_TOKEN="$tk"; claude -p hi',
    'CLAUDE_CODE_OAUTH_TOKEN="$tk" claude -p hi',
    'env CLAUDE_CODE_OAUTH_TOKEN="$tk" claude --print hi',
    'echo "claude -p hi"',
    "grep -n 'claude -p' scripts/spawn.sh",
    "cat > /tmp/x.sh <<'EOF'\nclaude -p hi\nEOF",
    "claude -n worker-x",
    "claude --resume abc",
    "claude --version",
  ])("%s", async (command) => {
    expect(await check(input(command), worker)).toBeUndefined()
  })

  test("a session outside the factory runs a bare headless claude", async () => {
    expect(
      await check(input("claude -p hi"), {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
        HOME: home,
      }),
    ).toBe(undefined)
  })

  test("another tool, or input it cannot read, runs", async () => {
    expect(
      await check(
        JSON.stringify({ tool_input: { file_path: "claude" }, tool_name: "Read" }),
        worker,
      ),
    ).toBeUndefined()
    expect(await check("not json", worker)).toBeUndefined()
  })
})

// dispatcher's headless Slack post sent a url-only link on 23 Oct and no-bare-slack-link passed it, since the run had no role.
describe("a headless run started in the refusal's shape carries its parent's role to the hooks", () => {
  const post = JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "s-headless",
    tool_input: {
      blocks: [
        {
          elements: [
            {
              elements: [{ type: "link", url: "https://github.com/acme/app/pull/12" }],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
      channel: "C0EXAMPLE02",
      text: "Please review",
    },
    tool_name: "mcp__slack-shared__chat_post_message",
  })

  // Runs a command under a fake security and claude, the fake claude saving the role it was started with.
  async function headlessRole(command: string): Promise<string> {
    const bin = await mkdtemp(join(dir, "bin-"))
    const saved = join(bin, "role")
    await writeFile(join(bin, "security"), "#!/bin/sh\necho fake-token\n")
    await writeFile(join(bin, "claude"), `#!/bin/sh\nprintf '%s' "$PLAYGROUND_ROLE" > ${saved}\n`)
    await chmod(join(bin, "security"), 0o755)
    await chmod(join(bin, "claude"), 0o755)
    const proc = Bun.spawn(["bash", "-c", command], {
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    })
    expect(await proc.exited).toBe(0)
    return Bun.file(saved).text()
  }

  async function slackHook(role: string): Promise<[number, string]> {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== "PLAYGROUND_ROLE"),
    )
    const proc = Bun.spawn(["bun", "--no-env-file", slackLink], {
      env: {
        ...env,
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
        ...(role ? { PLAYGROUND_ROLE: role } : {}),
      },
      stderr: "pipe",
      stdin: new Blob([post]),
    })
    return [await proc.exited, await new Response(proc.stderr).text()]
  }

  test("a url-only link from a run in the shape is refused by no-bare-slack-link", async () => {
    const reason = (await check(input("claude -p 'post it'", "s-dispatcher"), restored())) ?? ""
    const shape = reason.slice(reason.indexOf("Run it as: ") + "Run it as: ".length)
    const role = await headlessRole(shape.replace("claude -p ...", "claude -p 'post it'"))
    expect(role).toBe("dispatcher")
    const [code, stderr] = await slackHook(role)
    expect(code).toBe(2)
    expect(stderr).toContain("no-bare-slack-link hook refused")
  })

  test("the same post from a run with no role passes, as before", async () => {
    const role = await headlessRole("claude -p 'post it'")
    expect(role).toBe("")
    expect((await slackHook(role))[0]).toBe(0)
  })
})

test("the script exits 2 with the reason on stderr", async () => {
  const proc = Bun.spawn(["bun", "--no-env-file", script], {
    env: { ...process.env, ...worker },
    stderr: "pipe",
    stdin: new Blob([input("claude -p hi")]),
  })
  expect(await proc.exited).toBe(2)
  expect(await new Response(proc.stderr).text()).toContain("no-headless-login hook refuses")
})
