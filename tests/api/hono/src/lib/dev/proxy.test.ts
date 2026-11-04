import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FALLBACK_PORT,
  fallbackDir,
  listening,
  portlessDir,
  proxyDown,
  proxySetup,
  serviceDir,
  startFallback,
} from "../../../../../../api/hono/src/lib/dev/proxy"

describe("proxyDown", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-proxy-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const saved = (name: string, port: string) => {
    const path = join(dir, name)
    mkdirSync(path)
    writeFileSync(join(path, "proxy.port"), `${port}\n`)
    return path
  }
  const silent = async () => false
  const answers = async () => true

  test("a fresh machine, whose proxy portless would start on 443 with sudo, names 443", async () => {
    expect(await proxyDown({}, join(dir, "fresh"), silent)).toBe(443)
  })

  test("a service on 443 that stopped names 443", async () => {
    expect(await proxyDown({}, saved("stopped", "443"), silent)).toBe(443)
  })

  test("passes once the service holds 443", async () => {
    expect(await proxyDown({}, saved("service", "443"), answers)).toBeNull()
  })

  test("passes a proxy portless keeps on an unprivileged port of the owner's own, and a 1355 that answers", async () => {
    expect(await proxyDown({}, saved("own", "8443"), silent)).toBeNull()
    expect(await proxyDown({ PORTLESS_PORT: "8443" }, join(dir, "fresh"), silent)).toBeNull()
    expect(await proxyDown({}, saved("up1355", "1355"), answers)).toBeNull()
  })

  // #810 review: a 1355 proxy that ended uncleanly leaves its port saved, and portless's own start would trust the CA with no click, so the launcher starts it again through startFallback
  test("a saved 1355 that answers nothing reads as 443 down", async () => {
    expect(await proxyDown({}, saved("dead1355", "1355"), silent)).toBe(443)
    expect(await proxyDown({ PORTLESS_PORT: "1355" }, join(dir, "fresh"), silent)).toBe(443)
  })

  // #810 review: the 1355 proxy keeps its own folder, so a service install, which reads portless's own folder, leaves it running
  test("the 1355 proxy's folder sits in portless's own, and maps back to it", () => {
    expect(fallbackDir("/h/.portless")).toBe("/h/.portless/fallback")
    expect(serviceDir("/h/.portless/fallback")).toBe("/h/.portless")
    expect(serviceDir("/h/.portless")).toBe("/h/.portless")
  })

  // #810 review: a process outside the stack (the supervisor's web route, health-beat) has no PORTLESS_STATE_DIR, so it finds the 1355 proxy's folder by whose proxy serves
  test("portlessDir names the fallback folder while only its proxy serves", () => {
    const home = join(dir, "home")
    const own = join(home, ".portless")
    mkdirSync(fallbackDir(own), { recursive: true })
    const dead = String(Bun.spawnSync(["true"]).pid)
    const live = String(process.pid)
    const pids = (main: string, fallback: string) => {
      writeFileSync(join(own, "proxy.pid"), main)
      writeFileSync(join(fallbackDir(own), "proxy.pid"), fallback)
      return portlessDir({ HOME: home })
    }
    expect(pids(dead, live)).toBe(fallbackDir(own))
    expect(pids(live, live)).toBe(own)
    expect(pids(dead, dead)).toBe(own)
    expect(portlessDir({ HOME: home, PORTLESS_STATE_DIR: "/set" })).toBe("/set")
  })

  test("passes a stack that skips portless", async () => {
    expect(await proxyDown({ PORTLESS: "0" }, join(dir, "fresh"), silent)).toBeNull()
  })

  test("the setup a stack cannot do names the sudo commands and fixed ports", () => {
    const setup = proxySetup(443)
    expect(setup).toContain("port 443 needs sudo")
    expect(setup).toContain("`sudo node_modules/.bin/portless service install`")
    expect(setup).toContain("`PORTLESS=0 bun run dev`")
  })
})

// #810: with the proxy down, the stack starts portless on 1355 as this user, its trust step skipped; a fake portless records its argv, and the listening reader is injected, so nothing here binds 1355 or touches a keychain.
describe("startFallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-fallback-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const fake = (name: string, body: string) => {
    const cli = join(dir, name)
    writeFileSync(cli, `#!/bin/sh\necho "$@" > "${cli}.argv"\n${body}\n`, { mode: 0o755 })
    return cli
  }

  test("runs portless proxy start on 1355 with --skip-trust, and passes once 1355 answers", async () => {
    const cli = fake("up", "exit 0")
    const asked: number[] = []
    const failed = await startFallback(cli, { PATH: process.env.PATH }, async (port) => {
      asked.push(port)
      return true
    })
    expect(failed).toBeNull()
    expect(FALLBACK_PORT).toBe(1355)
    expect((await Bun.file(`${cli}.argv`).text()).trim()).toBe("proxy start -p 1355 --skip-trust")
    expect(asked).toEqual([1355])
  })

  test("a start that leaves 1355 silent answers with portless's last line", async () => {
    const cli = fake("down", 'echo "Error: something held the port" >&2; exit 1')
    expect(await startFallback(cli, { PATH: process.env.PATH }, async () => false)).toBe(
      "Error: something held the port",
    )
  })
})

describe("listening", () => {
  test("reads a loopback port taking connections, and one that refuses them", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
    const { port } = server
    try {
      expect(await listening(port)).toBe(true)
    } finally {
      server.stop(true)
    }
    expect(await listening(port)).toBe(false)
  })
})
