import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The routers' auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "fix-test-secret-not-for-use-anywhere"
const { createFixes } = await import("../../../../../../api/hono/src/lib/onboard/fix")
const { fixtureFixed } = await import("../../../../../../api/hono/src/lib/onboard/fix-ids")
const { setupApp } = await import("../../../../../../api/hono/src/lib/setup/app")
const { onboardRoutes } = await import("../../../../../../api/hono/src/routers/onboard")
const { env } = await import("../../../../../../packages/env/dist/api-hono.mjs")

type Fixes = ReturnType<typeof createFixes>

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const origins: unknown = env.HONO_TRUSTED_ORIGINS
const TRUSTED = Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()

// Stands in for the Bun server hono/bun reads the peer from.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

// A scratch HOME and a PATH of stubs alone, each logging its argv to calls.log, so no real brew, docker, gh, curl or claude runs.
const machine = () => {
  const root = mkdtempSync(join(tmpdir(), "fix-test-"))
  roots.push(root)
  const bin = join(root, "bin")
  const held = join(root, "held")
  const home = join(root, "home")
  for (const dir of [bin, held, home]) mkdirSync(dir)
  const write = (dir: string, name: string, body: string) =>
    writeFileSync(
      join(dir, name),
      `#!/bin/sh\nexport PATH="$PATH:/usr/bin:/bin"\necho "${name} $*" >> "${root}/calls.log"\n${body}\n`,
      { mode: 0o755 },
    )
  const fixes = createFixes({
    env: () => ({ HOME: home, PATH: bin }),
    live: () => true,
    paths: [],
    waitMs: 1,
  })
  return {
    bin,
    calls: () =>
      existsSync(join(root, "calls.log"))
        ? readFileSync(join(root, "calls.log"), "utf8").trim().split("\n")
        : [],
    fixes,
    go: () => writeFileSync(join(root, "go"), ""),
    // A stub that brew puts on PATH once it has installed it.
    held: (name: string, body = "") => write(held, name, body),
    hold: `while [ ! -f "${root}/go" ]; do sleep 0.02; done`,
    home,
    install: (name: string) => `cp "${held}/${name}" "${bin}/${name}"`,
    root,
    stub: (name: string, body = "") => write(bin, name, body),
  }
}

type Read = {
  device: { code: string; url: string } | null
  id: string
  lines: string[]
  reason: string | null
  state: string
}

const setup = (
  fixes: Fixes,
  start: (onStep: (step: string) => void) => Promise<void> = async () => {},
) => setupApp(start, fixes)

type App = {
  request: (url: string, init?: RequestInit, env?: unknown) => Response | Promise<Response>
}
type From = { address?: string; headers?: Record<string, string>; origin?: string }
const begin = (
  app: App,
  url: string,
  { address = "127.0.0.1", headers = {}, origin = TRUSTED }: From = {},
) =>
  app.request(
    `http://127.0.0.1${url}`,
    { headers: { origin, ...headers }, method: "POST" },
    peer(address),
  )
const read = async (app: App, url: string): Promise<Read> =>
  (await (await app.request(`http://127.0.0.1${url}`, {}, peer("127.0.0.1"))).json()).data

// The read once its state leaves running, or the last one when it never does.
const settled = async (app: App, url: string, done = (r: Read) => r.state !== "running") => {
  let last = await read(app, url)
  for (let tries = 0; tries < 250 && !done(last); tries++) {
    await Bun.sleep(20)
    last = await read(app, url)
  }
  return last
}

const FIX = "/api/v1/onboard/fix"

describe("the fix allowlist", () => {
  test("an id outside it is refused before anything runs, the settings action included", async () => {
    const m = machine()
    m.stub("brew")
    const app = setup(m.fixes)
    for (const id of ["settings", "rm", "..%2Fbrew", "git%20--force"]) {
      expect((await begin(app, `${FIX}/${id}`)).status).toBe(404)
      expect((await app.request(`${FIX}/${id}`, {}, peer("127.0.0.1"))).status).toBe(404)
    }
    expect(m.calls()).toEqual([])
  })

  test("a fix not started reads idle", async () => {
    const m = machine()
    expect(await read(setup(m.fixes), `${FIX}/git`)).toEqual({
      device: null,
      id: "git",
      lines: [],
      reason: null,
      state: "idle",
    })
  })
})

describe("each fix runs its fixed argv", () => {
  test("git, python and node install through brew, and an old node upgrades", async () => {
    const m = machine()
    m.stub("brew", 'echo "==> Pouring $2"')
    const app = setup(m.fixes)
    for (const id of ["git", "python", "node"]) {
      expect((await begin(app, `${FIX}/${id}`)).status).toBe(202)
      expect((await settled(app, `${FIX}/${id}`)).state).toBe("ok")
    }
    m.stub("node")
    expect((await begin(app, `${FIX}/node`)).status).toBe(202)
    const node = await settled(app, `${FIX}/node`)
    expect(node.state).toBe("ok")
    expect(node.lines).toContain("==> Pouring node")
    expect(m.calls()).toEqual([
      "brew install git",
      "brew install python",
      "brew install node",
      "brew upgrade node",
    ])
  })

  test("herdr runs install.sh's own pinned install", async () => {
    const m = machine()
    m.stub("bun")
    const app = setup(m.fixes)
    expect((await begin(app, `${FIX}/herdr`)).status).toBe(202)
    expect((await settled(app, `${FIX}/herdr`)).state).toBe("ok")
    expect(m.calls()).toEqual([
      expect.stringMatching(
        /^bun --no-env-file \/\S+\/packages\/scripts\/src\/playground\/herdr-pin\.ts$/,
      ),
    ])
  })

  test("docker installs, opens once, then waits for docker info", async () => {
    const m = machine()
    m.held(
      "docker",
      `n=$(cat "${m.root}/n" 2>/dev/null || echo 0); echo $((n + 1)) > "${m.root}/n"; [ $n -ge 2 ]`,
    )
    m.stub("brew", m.install("docker"))
    m.stub("open")
    const app = setup(m.fixes)
    expect((await begin(app, `${FIX}/docker`)).status).toBe(202)
    expect((await settled(app, `${FIX}/docker`)).state).toBe("ok")
    expect(m.calls()).toEqual([
      "brew install --cask docker",
      "open -a Docker",
      "docker info",
      "docker info",
      "docker info",
    ])
  })

  test("an installed docker that never starts fails with words, after opening it", async () => {
    const m = machine()
    m.stub("docker", "exit 1")
    m.stub("open")
    const app = setup(m.fixes)
    await begin(app, `${FIX}/docker`)
    const docker = await settled(app, `${FIX}/docker`)
    expect(docker.state).toBe("failed")
    expect(docker.reason).toContain("Docker did not start")
    expect(m.calls()[0]).toBe("open -a Docker")
    expect(m.calls()).not.toContain("brew install --cask docker")
  })

  test("claude takes its own installer, downloaded within a bound then run, with no sudo", async () => {
    const m = machine()
    m.stub("curl", 'while [ "$1" != "-o" ]; do shift; done; echo "echo installed" > "$2"')
    m.stub("bash", '. "$1"')
    const app = setup(m.fixes)
    expect((await begin(app, `${FIX}/claude`)).status).toBe(202)
    const claude = await settled(app, `${FIX}/claude`)
    expect(claude.state).toBe("ok")
    expect(claude.lines).toContain("installed")
    const [curl, bash] = m.calls()
    const file =
      /^curl -fsSL --connect-timeout 30 --max-time 240 -o (\/\S+\/install\.sh) https:\/\/claude\.ai\/install\.sh$/.exec(
        curl!,
      )?.[1]
    expect(file).toBeString()
    expect(bash).toBe(`bash ${file}`)
    expect(m.calls().join("\n")).not.toContain("sudo")
  })

  test("gh-login installs gh, then shows the device code and link until the sign-in finishes", async () => {
    const m = machine()
    m.held(
      "gh",
      [
        'printf "? Authenticate Git with your GitHub credentials? (Y/n) "',
        "read git",
        'echo "! First copy your one-time code: AB12-CD34"',
        'printf "Press Enter to open https://github.com/login/device in your browser... "',
        "read enter",
        m.hold,
        'echo "✓ Logged in as someone"',
      ].join("\n"),
    )
    m.stub("brew", m.install("gh"))
    const app = setup(m.fixes)
    expect((await begin(app, `${FIX}/gh-login`)).status).toBe(202)
    const waiting = await settled(
      app,
      `${FIX}/gh-login`,
      (r) => r.device !== null || r.state !== "running",
    )
    expect(waiting.state).toBe("running")
    expect(waiting.device).toEqual({ code: "AB12-CD34", url: "https://github.com/login/device" })
    m.go()
    const done = await settled(app, `${FIX}/gh-login`)
    expect(done.state).toBe("ok")
    expect(done.device).toBeNull()
    expect(done.lines).toContain("Signing in to GitHub")
    expect(done.lines).toContain("Playground also lets git use this GitHub sign-in")
    expect(m.calls()).toEqual([
      "brew install gh",
      "gh auth login --web --hostname github.com --git-protocol https",
    ])
  })

  test("keeps the last 40 lines of what a fix printed", async () => {
    const m = machine()
    m.stub("brew", 'i=1; while [ $i -le 200 ]; do echo "line $i"; i=$((i + 1)); done')
    const app = setup(m.fixes)
    await begin(app, `${FIX}/git`)
    const git = await settled(app, `${FIX}/git`)
    expect(git.lines).toHaveLength(40)
    expect(git.lines.at(-1)).toBe("line 200")
  })
})

describe("a step's environment", () => {
  test("holds what the tools need, a proxy included, and none of the API's own settings", async () => {
    const m = machine()
    m.stub("brew", 'echo "marker=${FIX_TEST_MARKER:-none} home=$HOME proxy=$HTTPS_PROXY"')
    const fixes = createFixes({
      env: () => ({
        FIX_TEST_MARKER: "leaked",
        HOME: m.home,
        HTTPS_PROXY: "http://127.0.0.1:3128",
        PATH: m.bin,
      }),
      live: () => true,
      paths: [],
    })
    const app = setup(fixes)
    await begin(app, `${FIX}/git`)
    const git = await settled(app, `${FIX}/git`)
    expect(git.lines).toContain(`marker=none home=${m.home} proxy=http://127.0.0.1:3128`)
  })
})

describe("one fix at a time", () => {
  test("a second start answers 409 while one runs, and runs nothing", async () => {
    const m = machine()
    m.stub("brew", m.hold)
    const app = setup(m.fixes)
    expect((await begin(app, `${FIX}/git`)).status).toBe(202)
    for (const id of ["git", "python"]) {
      const refused = await begin(app, `${FIX}/${id}`)
      expect(refused.status).toBe(409)
      expect((await refused.json()).error.message).toBe("A fix is already running")
    }
    expect((await begin(app, "/api/setup/container")).status).toBe(409)
    m.go()
    expect((await settled(app, `${FIX}/git`)).state).toBe("ok")
    expect(m.calls()).toEqual(["brew install git"])
  })

  test("the database's start is Start a local container's own, and holds the other fixes", async () => {
    const m = machine()
    let finish = () => {}
    const app = setup(
      m.fixes,
      (onStep) =>
        new Promise<void>((resolve) => {
          onStep("Starting Postgres")
          finish = resolve
        }),
    )
    expect((await begin(app, `${FIX}/database`)).status).toBe(202)
    expect(await read(app, `${FIX}/database`)).toMatchObject({
      lines: ["Starting Postgres"],
      state: "running",
    })
    expect((await (await app.request("/api/setup")).json()).data).toEqual({
      status: "starting",
      step: "Starting Postgres",
    })
    expect((await begin(app, `${FIX}/git`)).status).toBe(409)
    expect((await begin(app, "/api/setup/container")).status).toBe(409)
    finish()
    expect((await settled(app, `${FIX}/database`)).state).toBe("ok")
  })
})

describe("a failed fix", () => {
  test("a step that never ends is stopped by its own bound, and frees the next fix", async () => {
    const m = machine()
    m.stub("brew", "sleep 5")
    const fixes = createFixes({
      env: () => ({ HOME: m.home, PATH: m.bin }),
      live: () => true,
      paths: [],
      stepMs: 200,
    })
    const app = setup(fixes)
    const began = Date.now()
    await begin(app, `${FIX}/git`)
    const git = await settled(app, `${FIX}/git`)
    expect(git.state).toBe("failed")
    expect(git.reason).toBe("Installing git stopped: it took too long, so it was stopped")
    expect(Date.now() - began).toBeLessThan(3_000)
    m.stub("brew")
    expect((await begin(app, `${FIX}/git`)).status).toBe(202)
  })

  test("reads failed with the step and the last thing it printed", async () => {
    const m = machine()
    m.stub("brew", 'echo "Error: python has no bottle for this macOS" >&2; exit 1')
    const app = setup(m.fixes)
    await begin(app, `${FIX}/python`)
    const python = await settled(app, `${FIX}/python`)
    expect(python.state).toBe("failed")
    expect(python.reason).toBe(
      "Installing Python stopped: Error: python has no bottle for this macOS",
    )
  })

  test("a binary missing from PATH fails in words, and the next fix can start", async () => {
    const m = machine()
    const app = setup(m.fixes)
    await begin(app, `${FIX}/git`)
    const git = await settled(app, `${FIX}/git`)
    expect(git.state).toBe("failed")
    expect(git.reason).toBe("Installing git stopped: Homebrew is not installed")
    m.stub("brew")
    expect((await begin(app, `${FIX}/git`)).status).toBe(202)
    expect((await settled(app, `${FIX}/git`)).state).toBe("ok")
  })
})

describe("the guards", () => {
  const refusals: From[] = [
    { origin: "http://evil.localhost" },
    { address: "192.168.1.20" },
    { headers: { "x-forwarded-for": "100.101.102.103" } },
    { headers: { "x-forwarded-for": "127.0.0.1, 192.168.1.20" } },
    { headers: { "tailscale-user-login": "me@example.com" } },
  ]

  test("setup mode takes a start from a trusted origin over loopback on this machine alone", async () => {
    const m = machine()
    m.stub("brew")
    const app = setup(m.fixes)
    for (const refusal of refusals)
      expect((await begin(app, `${FIX}/git`, refusal)).status).toBe(403)
    const forwarded = await app.request(`${FIX}/git`, {
      headers: { "x-forwarded-for": "100.101.102.103" },
    })
    expect(forwarded.status).toBe(403)
    expect(m.calls()).toEqual([])
  })

  const full = (fixes: Fixes, owners: string[]) =>
    onboardRoutes({
      createOwner: async () => "owner-new",
      enabled: () => true,
      fixes,
      owners: async () => owners,
      signIn: async () => {},
    })

  test("before an owner exists, the app takes this machine's start alone", async () => {
    const m = machine()
    m.stub("brew")
    const app = full(m.fixes, [])
    for (const refusal of refusals) expect((await begin(app, "/fix/git", refusal)).status).toBe(403)
    expect(
      (await app.request("/fix/git", { headers: { "x-forwarded-for": "100.101.102.103" } })).status,
    ).toBe(403)
    expect(m.calls()).toEqual([])
    expect((await begin(app, "/fix/git")).status).toBe(202)
    expect((await settled(app, "/fix/git")).state).toBe("ok")
  })

  test("once an owner exists, a start or a read needs the owner's session", async () => {
    const m = machine()
    m.stub("brew")
    const app = full(m.fixes, ["owner-1"])
    expect((await begin(app, "/fix/git")).status).toBe(401)
    expect((await app.request("http://127.0.0.1/fix/git", {}, peer("127.0.0.1"))).status).toBe(401)
    expect(m.calls()).toEqual([])
  })

  test("the app answers the database's fix with 409, since it runs on one", async () => {
    const m = machine()
    const refused = await begin(full(m.fixes, []), "/fix/database")
    expect(refused.status).toBe(409)
    expect((await refused.json()).error.message).toBe("The database is already running")
  })
})

describe("on a fixture stack", () => {
  test("each fix is made up: nothing on PATH runs, and the fixed row reads ok after", async () => {
    const m = machine()
    m.stub("brew")
    m.stub("gh")
    const fixes = createFixes({
      env: () => ({ HOME: m.root, PATH: "" }),
      live: () => false,
      paths: [],
    })
    const app = setup(fixes)
    fixtureFixed.clear()
    expect((await begin(app, `${FIX}/gh-login`)).status).toBe(202)
    const waiting = await settled(
      app,
      `${FIX}/gh-login`,
      (r) => r.device !== null || r.state !== "running",
    )
    expect(waiting.device?.url).toBe("https://github.com/login/device")
    expect((await settled(app, `${FIX}/gh-login`)).state).toBe("ok")
    expect(fixtureFixed.has("gh-login")).toBe(true)
    expect(m.calls()).toEqual([])
  }, 15_000)
})
