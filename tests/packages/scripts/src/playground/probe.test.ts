import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import {
  apiUp,
  cutDashboardCheckout,
  dashboardCheckout,
  homeDataDir,
  liveBranch,
  linesSince,
  webUp,
} from "../../../../../packages/scripts/src/playground/probe"

const dir = mkdtempSync(join(tmpdir(), "dispatcher-probe-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

describe("linesSince", () => {
  test("reads from a byte offset, so a multi-byte character before it moves nothing", async () => {
    const log = join(dir, "results.log")
    await Bun.write(log, "2026-10-18T02:00:00Z ROLL x ✗ FAIL verify ✗\n")
    const from = Bun.file(log).size
    await Bun.write(log, `${await Bun.file(log).text()}2026-10-18T02:01:00Z CURRENT abc1234\n`)
    expect(await linesSince(log, from)).toEqual(["2026-10-18T02:01:00Z CURRENT abc1234"])
  })

  test("reads a file that is not there as no lines", async () => {
    expect(await linesSince(join(dir, "missing.log"), 0)).toEqual([])
  })
})

// portless answers 404 for a name no stack serves, so only the stack's own answer reads as up.
describe("apiUp and webUp", () => {
  const serve = (status: number) =>
    Bun.serve({ fetch: () => new Response("", { status }), hostname: "127.0.0.1", port: 0 })

  test("an API whose health answers 200 is up", async () => {
    const server = serve(200)
    const url = `http://127.0.0.1:${server.port}`
    expect(await apiUp({ api: url, web: url })).toBe(true)
    server.stop(true)
  })

  test("a 404 from the proxy reads as down for both", async () => {
    const server = serve(404)
    const url = `http://127.0.0.1:${server.port}`
    expect(await apiUp({ api: url, web: url })).toBe(false)
    expect(await webUp({ api: url, web: url })).toBe(false)
    server.stop(true)
  })

  test("a web page that redirects is up", async () => {
    const server = serve(307)
    const url = `http://127.0.0.1:${server.port}`
    expect(await webUp({ api: url, web: url })).toBe(true)
    server.stop(true)
  })

  test("no URLs reads as down", async () => {
    expect(await apiUp(null)).toBe(false)
    expect(await webUp(null)).toBe(false)
  })
})

// An https dashboard serves a certificate from portless's CA, which Bun's own store lacks.
describe("apiUp over https", () => {
  const ca = join(dir, "ca.pem")
  const key = join(dir, "key.pem")
  const made = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-keyout",
      key,
      "-out",
      ca,
    ],
    { stderr: "pipe", stdout: "pipe" },
  )
  if (made.exitCode !== 0) throw new Error(made.stderr.toString())
  const saved = { extra: process.env.NODE_EXTRA_CA_CERTS, state: process.env.PORTLESS_STATE_DIR }
  afterAll(() => {
    for (const [name, value] of [
      ["NODE_EXTRA_CA_CERTS", saved.extra],
      ["PORTLESS_STATE_DIR", saved.state],
    ] as const)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  })

  const upUnder = async (state: string) => {
    delete process.env.NODE_EXTRA_CA_CERTS
    process.env.PORTLESS_STATE_DIR = state
    const server = Bun.serve({
      fetch: () => new Response(""),
      port: 0,
      tls: { cert: Bun.file(ca), key: Bun.file(key) },
    })
    try {
      const url = `https://localhost:${server.port}`
      return await apiUp({ api: url, web: url })
    } finally {
      server.stop(true)
    }
  }

  test("reads as up under portless's CA", async () => {
    expect(await upUnder(dir)).toBe(true)
  })

  test("reads as down with no CA in portless's state folder", async () => {
    expect(await upUnder(join(dir, "missing"))).toBe(false)
  })
})

describe("a fresh install's first start", () => {
  // A clone of a made-up repo with one commit on main, as install.sh leaves one: origin's HEAD names main, and no checkout is on the live branch.
  const clone = () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-checkout-"))
    const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root })
    git("init", "-q", "-b", "main", "origin")
    git(
      "-C",
      "origin",
      "-c",
      "user.email=fixture",
      "-c",
      "user.name=a",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    )
    git("clone", "-q", "origin", "repo")
    return join(root, "repo")
  }
  const real = (argv: string[], cwd?: string) => {
    const child = Bun.spawnSync(argv, { cwd, stderr: "pipe", stdout: "pipe" })
    return { code: child.exitCode ?? 1, out: child.stdout.toString().trim() }
  }

  test("cuts the Dashboard's checkout on its branch from origin's main, installs it, and finds it after", () => {
    const repo = clone()
    expect(dashboardCheckout(repo)).toBeNull()
    const installs: string[] = []
    const exec = (argv: string[], cwd?: string) =>
      argv[0] === "bun" ? (installs.push(cwd!), { code: 0, out: "" }) : real(argv, cwd)
    const made = cutDashboardCheckout(repo, exec)
    const checkout = join(repo, ".claude", "worktrees", "desk")
    expect(made).toEqual({ checkout })
    expect(installs).toEqual([checkout])
    expect(real(["git", "-C", checkout, "rev-parse", "--abbrev-ref", "HEAD"]).out).toBe(
      liveBranch(),
    )
    expect(dashboardCheckout(repo)?.endsWith(join(".claude", "worktrees", "desk"))).toBe(true)
  })

  test("cuts the Dashboard's checkout from origin's main, the shipped branch, though origin's default branch is canary", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-checkout-"))
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.email=fixture", "-c", "user.name=a", ...args], {
        cwd: root,
      })
        .stdout.toString()
        .trim()
    git("init", "-q", "-b", "main", "origin")
    git("-C", "origin", "commit", "-q", "--allow-empty", "-m", "shipped")
    git("-C", "origin", "checkout", "-q", "-b", "canary")
    git("-C", "origin", "commit", "-q", "--allow-empty", "-m", "unshipped")
    git("clone", "-q", "-b", "main", "origin", "repo")
    const repo = join(root, "repo")
    const exec = (argv: string[], cwd?: string) =>
      argv[0] === "bun" ? { code: 0, out: "" } : real(argv, cwd)
    const made = cutDashboardCheckout(repo, exec)
    expect(made).toEqual({ checkout: join(repo, ".claude", "worktrees", "desk") })
    expect(git("-C", join(repo, ".claude", "worktrees", "desk"), "log", "-1", "--format=%s")).toBe(
      "shipped",
    )
  })

  test("names the step that failed: the cut, or the install", () => {
    const repo = clone()
    const noInstall = (argv: string[], cwd?: string) =>
      argv[0] === "bun" ? { code: 1, out: "" } : real(argv, cwd)
    expect(cutDashboardCheckout(repo, noInstall)).toEqual({
      error: `bun install failed in the Dashboard's checkout, ${join(repo, ".claude", "worktrees", "desk")}`,
    })
    expect(cutDashboardCheckout(repo, noInstall)).toEqual({
      error: `could not cut the Dashboard's checkout at ${join(repo, ".claude", "worktrees", "desk")}`,
    })
  })
})

describe("homeDataDir", () => {
  test("follows PLAYGROUND_DATA_DIR as spawn.sh does, else playground under HOME's ~/.claude", () => {
    const saved = { config: process.env.CLAUDE_CONFIG_DIR, data: process.env.PLAYGROUND_DATA_DIR }
    try {
      process.env.CLAUDE_CONFIG_DIR = join(dir, "config")
      process.env.PLAYGROUND_DATA_DIR = join(dir, "data")
      expect(homeDataDir()).toBe(join(dir, "data"))
      delete process.env.PLAYGROUND_DATA_DIR
      expect(homeDataDir()).toBe(join(homedir(), ".playground"))
    } finally {
      for (const [key, value] of [
        ["CLAUDE_CONFIG_DIR", saved.config],
        ["PLAYGROUND_DATA_DIR", saved.data],
      ] as const)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
  })
})

// A first start reads live.branch before any setting has written policy.json, as when ext init stopped after making the extensions root.
describe("liveBranch before a first setting", () => {
  const withData = (data: string, read: () => void) => {
    const saved = process.env.PLAYGROUND_DATA_DIR
    try {
      process.env.PLAYGROUND_DATA_DIR = data
      read()
    } finally {
      if (saved === undefined) delete process.env.PLAYGROUND_DATA_DIR
      else process.env.PLAYGROUND_DATA_DIR = saved
    }
  }

  test("a data folder with no extensions root reads the default branch", () => {
    withData(join(dir, "no-root"), () => expect(liveBranch()).toBe("live/dashboard"))
  })

  test("an extensions root with no policy.json reads the default branch", () => {
    const data = join(dir, "root-only")
    mkdirSync(join(data, "extensions"), { recursive: true })
    withData(data, () => expect(liveBranch()).toBe("live/dashboard"))
  })

  test("a policy.json that does not parse is still refused", () => {
    const data = join(dir, "bad-policy")
    mkdirSync(join(data, "extensions"), { recursive: true })
    writeFileSync(join(data, "extensions", "policy.json"), "{")
    withData(data, () => expect(() => liveBranch()).toThrow("does not parse"))
  })
})
