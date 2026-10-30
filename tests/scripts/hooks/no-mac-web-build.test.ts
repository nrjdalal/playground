import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check, INSPECT_TIMEOUT_MS } from "../../../scripts/hooks/no-mac-web-build"

const root = join(import.meta.dir, "..", "..", "..")
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A scratch config folder with the dashboard supervisor's dashboard-db (`missing`, `unreadable` or the text to write) and a stub docker whose inspect answers as `answer` says, logging each call.
const dashboard = (
  answer: "error" | "gone" | "hung" | "running" | "stopped",
  db: string = "playground-dashboard-db",
) => {
  const dir = mkdtempSync(join(tmpdir(), "no-mac-web-build-"))
  dirs.push(dir)
  const state = join(dir, "config", "playground", "ops", "dashboard")
  mkdirSync(state, { recursive: true })
  if (db === "unreadable") mkdirSync(join(state, "dashboard-db"))
  else if (db !== "missing") writeFileSync(join(state, "dashboard-db"), db === "" ? "" : `${db}\n`)
  const bin = join(dir, "bin")
  mkdirSync(bin)
  const reply = {
    error: 'echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1',
    gone: 'echo "Error: No such object: ${@: -1}" >&2; exit 1',
    hung: "sleep 20",
    running: "echo true",
    stopped: "echo false",
  }[answer]
  writeFileSync(join(bin, "docker"), `#!/bin/bash\necho "$*" >> "${dir}/calls"\n${reply}\n`)
  chmodSync(join(bin, "docker"), 0o755)
  const environment = {
    CLAUDE_CONFIG_DIR: join(dir, "config"),
    PLAYGROUND_DATA_DIR: join(join(dir, "config"), "playground"),
    HOME: dir,
    PATH: `${bin}:/usr/bin:/bin`,
  }
  const bash = (command: string) =>
    check(
      JSON.stringify({
        cwd: root,
        hook_event_name: "PreToolUse",
        tool_input: { command },
        tool_name: "Bash",
      }),
      environment,
    )
  const calls = () =>
    existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8") : ""
  return { bash, calls }
}

describe("a web image build on the Mac is refused while the live dashboard's Postgres runs", () => {
  test.each([
    ["compose build with no service", "docker compose build"],
    ["compose build --no-cache", "docker compose build --no-cache"],
    ["compose build web", "docker compose build web"],
    ["web among the services", "docker compose build --no-cache api web"],
    ["compose options before build", "docker compose -f docker-compose.yml -p x build web"],
    ["compose up --build", "docker compose up --build"],
    ["compose up, which builds a missing image", "docker compose up"],
    ["compose up -d web", "docker compose up -d web"],
    ["compose create", "docker compose create"],
    ["compose run web", "docker compose run --rm -e X=1 web sh"],
    ["docker-compose", "docker-compose build web"],
    ["docker build -f", "docker build -f web/next/Dockerfile --secret id=dotenv,src=.env ."],
    ["docker build --file=./", "docker build --file=./web/next/Dockerfile ."],
    [
      "an absolute Dockerfile path",
      "docker build -f /x/dispatcher/web/next/Dockerfile /x/dispatcher",
    ],
    ["docker buildx build", "docker buildx build -f web/next/Dockerfile ."],
    ["docker image build", "docker image build -fweb/next/Dockerfile ."],
    ["after cd &&", "cd /tmp && docker compose build web"],
    ["through bash -c", "bash -c 'docker compose build web'"],
    ["through run-slot", "~/.playground/ops/run-slot.sh w -- docker compose build web"],
    ["through env", "env NODE_ENV=production docker compose build"],
    ["a service it cannot read", "docker compose build $SERVICE"],
    ["a Dockerfile it cannot read", "docker build -f $(cat which) ."],
  ])("%s", async (_, command) => {
    const { bash, calls } = dashboard("running")
    const reason = await bash(command)
    expect(reason).toContain("no-mac-web-build hook refuses")
    expect(reason).toContain("playground-dashboard-db")
    expect(reason).toContain("ci.sh web HEAD")
    expect(calls()).toBe("inspect -f {{.State.Running}} playground-dashboard-db\n")
  })
})

describe("every other build runs, and asks Docker nothing", () => {
  test.each([
    ["the api image alone", "docker compose build --no-cache api"],
    ["the api Dockerfile", "docker build -f api/hono/Dockerfile ."],
    ["a build sent to the box", "bash ~/.playground/ops/runner-host/ci.sh web HEAD"],
    ["a build over ssh", "ssh root@203.0.113.7 docker compose build web"],
    ["up with --no-build", "docker compose up -d --no-build web"],
    ["up of the api alone", "docker compose up -d api"],
    ["run of the api, web only in its command", "docker compose run --rm api echo web"],
    ["another docker call", "docker ps"],
    ["compose build's help", "docker compose build --help"],
    ["a printed command", "echo docker compose build web"],
    ["a commit message", "git commit -m 'docker compose build web'"],
  ])("%s", async (_, command) => {
    const { bash, calls } = dashboard("running")
    expect(await bash(command)).toBeUndefined()
    expect(calls()).toBe("")
  })
})

describe("the dashboard's container decides", () => {
  test.each([
    ["not running", "stopped" as const],
    ["gone", "gone" as const],
  ])("a web build runs when dashboard-db names a container that is %s", async (_, answer) => {
    expect(await dashboard(answer).bash("docker compose build web")).toBeUndefined()
  })

  test.each([
    ["missing", "running" as const, "missing", "no dashboard-db"],
    ["empty", "stopped" as const, "", "dashboard-db names no container"],
    ["unreadable", "stopped" as const, "unreadable", "dashboard-db could not be read"],
    [
      "named but Docker errs",
      "error" as const,
      "playground-dashboard-db",
      "Cannot connect to the Docker daemon",
    ],
  ])(
    "a dashboard-db that is %s refuses, since the hook cannot tell",
    async (_, answer, db, why) => {
      const reason = await dashboard(answer, db).bash("docker compose build web")
      expect(reason).toContain("no-mac-web-build hook refuses")
      expect(reason).toContain(why)
      expect(reason).toContain("ci.sh web HEAD")
    },
  )

  test("with no docker on PATH it refuses, since it cannot ask", async () => {
    const dir = mkdtempSync(join(tmpdir(), "no-mac-web-build-"))
    dirs.push(dir)
    mkdirSync(join(dir, "playground", "ops", "dashboard"), { recursive: true })
    writeFileSync(
      join(dir, "playground", "ops", "dashboard", "dashboard-db"),
      "playground-dashboard-db\n",
    )
    const raw = JSON.stringify({
      cwd: root,
      tool_input: { command: "docker compose build web" },
      tool_name: "Bash",
    })
    const reason = await check(raw, {
      CLAUDE_CONFIG_DIR: dir,
      PLAYGROUND_DATA_DIR: join(dir, "playground"),
      HOME: dir,
      PATH: join(dir, "none"),
    })
    expect(reason).toContain("no docker on PATH")
  })

  // The stub's sleep outlives the killed bash and holds its pipes, so this reaches the read's backstop too.
  test(
    "a Docker that never answers refuses inside the hook's registered timeout",
    async () => {
      const started = performance.now()
      const reason = await dashboard("hung").bash("docker compose build web")
      expect(reason).toContain(`gave no answer in ${INSPECT_TIMEOUT_MS / 1000}s`)
      expect(reason).toContain("ci.sh web HEAD")
      expect(performance.now() - started).toBeLessThan(INSPECT_TIMEOUT_MS + 3000)
      for (const settings of ["scripts/factory-settings.json", ".claude/settings.json"]) {
        const text = readFileSync(join(root, settings), "utf8")
        const timeout = Number(/no-mac-web-build\.ts",\s*"timeout": (\d+)/.exec(text)?.[1])
        expect(timeout * 1000, settings).toBeGreaterThan(INSPECT_TIMEOUT_MS + 4000)
      }
    },
    INSPECT_TIMEOUT_MS + 10_000,
  )
})
