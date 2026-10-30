import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listening, proxyRefusal } from "../../../../../../api/hono/src/lib/dev/proxy"

describe("proxyRefusal", () => {
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

  test("a fresh machine, whose proxy portless would start on 443 with sudo: names the setup commands", async () => {
    const refusal = await proxyRefusal({}, join(dir, "fresh"), silent)
    expect(refusal).toContain("port 443 needs sudo")
    expect(refusal).toContain("`sudo node_modules/.bin/portless service install`")
    expect(refusal).toContain("`PORTLESS=0 bun run dev`")
  })

  test("passes once the service holds 443", async () => {
    expect(await proxyRefusal({}, saved("service", "443"), answers)).toBeNull()
  })

  test("passes a proxy portless keeps on an unprivileged port, as on 1355 before the switch", async () => {
    expect(await proxyRefusal({}, saved("old", "1355"), silent)).toBeNull()
    expect(await proxyRefusal({ PORTLESS_PORT: "1355" }, join(dir, "fresh"), silent)).toBeNull()
  })

  test("passes a stack that skips portless", async () => {
    expect(await proxyRefusal({ PORTLESS: "0" }, join(dir, "fresh"), silent)).toBeNull()
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
