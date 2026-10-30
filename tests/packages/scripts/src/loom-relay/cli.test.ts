import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { networkInterfaces } from "node:os"

import {
  HOST,
  relayLogin,
  startRelay,
  upstreamProblem,
} from "../../../../../packages/scripts/src/loom-relay/cli"
import { filterMetrics } from "../../../../../packages/scripts/src/loom-relay/filter"
import { exportBody, LOGIN, point, s, sum } from "./export-body"

// A teammate who uses Loom is relayed under that teammate's own account alone, soren.ahmad@example.org here.
describe("relayLogin", () => {
  test("takes the login LOOM_RELAY_LOGIN names, with no default", () => {
    expect(relayLogin({ LOOM_RELAY_LOGIN: "dev@example.com" })).toBe("dev@example.com")
    expect(relayLogin({})).toBeNull()
    expect(relayLogin({ LOOM_RELAY_LOGIN: "" })).toBeNull()
  })

  test("refuses a login that is not an email", () => {
    expect(relayLogin({ LOOM_RELAY_LOGIN: "nobody" })).toBeNull()
    expect(relayLogin({ LOOM_RELAY_LOGIN: "a b@example.com" })).toBeNull()
    expect(relayLogin({ LOOM_RELAY_LOGIN: "a@b" })).toBeNull()
  })
})

describe("upstreamProblem", () => {
  test("refuses an upstream off this machine while the Keychain holds no token", () => {
    expect(upstreamProblem("https://collector.example.com", null)).toContain("Keychain")
  })

  test("refuses plain http off this machine, an unset upstream and a non-URL", () => {
    expect(upstreamProblem("http://collector.example.com", "t")).toContain("https")
    expect(upstreamProblem(undefined, "t")).toContain("not set")
    expect(upstreamProblem("collector", "t")).toContain("not a URL")
  })

  test("allows a loopback upstream with no token, and https with one", () => {
    expect(upstreamProblem("http://127.0.0.1:9999", null)).toBeNull()
    expect(upstreamProblem("https://collector.example.com", "t")).toBeNull()
  })
})

describe("startRelay", () => {
  const received: { body: unknown; path: string; token: string | null }[] = []
  // Every body the stub collector got, as the bytes it read.
  const bytes: string[] = []
  const upstream = Bun.serve({
    async fetch(req) {
      const text = await req.text()
      bytes.push(text)
      received.push({
        body: JSON.parse(text),
        path: new URL(req.url).pathname,
        token: req.headers.get("x-loom-token"),
      })
      return Response.json({ written: 1 })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  const results: string[] = []
  const relay = startRelay({
    login: LOGIN,
    onResult: (r) => results.push(r),
    port: 0,
    token: "t",
    upstream: `http://127.0.0.1:${upstream.port}/`,
  })
  const url = `http://${HOST}:${relay.port}`
  afterAll(() => {
    relay.stop()
    upstream.stop(true)
  })
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

  test("forwards the filtered export, and never the token to a loopback upstream", async () => {
    const res = await post("/v1/metrics", exportBody)
    expect(res.status).toBe(200)
    expect(received.at(-1)).toEqual({
      body: filterMetrics(exportBody, LOGIN),
      path: "/v1/metrics",
      token: null,
    })
    expect(results.at(-1)).toBe("ok")
  })

  test("forwards the backfill summed under the login, and nothing else", async () => {
    const row = { day: "2026-10-12", inputTokens: 7, machineId: "m1", seatDir: ".claude-work" }
    await post("/v1/transcripts", {
      rollups: [
        { ...row, accountEmail: "other@example.com", skillCounts: { "secret-skill": 1 } },
        { ...row, seatDir: ".claude" },
      ],
    })
    expect(received.at(-1)).toEqual({
      body: {
        rollups: [
          {
            accountEmail: LOGIN,
            assistantTurns: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            day: "2026-10-12",
            inputTokens: 14,
            machineId: "relay",
            model: "unknown",
            outputTokens: 0,
            seatDir: ".claude",
            sessions: 0,
          },
        ],
      },
      path: "/v1/transcripts",
      token: null,
    })
  })

  test("forwards a harvested row's sub-agent token counts intact", async () => {
    const counts = {
      subagentCacheCreationTokens: 3,
      subagentCacheReadTokens: 5,
      subagentInputTokens: 1,
      subagentOutputTokens: 2,
    }
    await post("/v1/transcripts", {
      rollups: [
        {
          ...counts,
          assistantTurns: 4,
          day: "2026-10-13",
          machineId: "m1",
          model: "claude-opus-5-5",
          seatDir: ".claude",
          subagentTurns: 6,
        },
      ],
    })
    expect(received.at(-1)?.body).toEqual({
      rollups: [
        {
          ...counts,
          accountEmail: LOGIN,
          assistantTurns: 4,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          day: "2026-10-13",
          inputTokens: 0,
          machineId: "relay",
          model: "claude-opus-5-5",
          outputTokens: 0,
          seatDir: ".claude",
          sessions: 0,
        },
      ],
    })
  })

  // The blocklist keeps every prompt and transcript out.
  const PLANTED = [
    "planted prompt text",
    "planted transcript text",
    "planted-tool",
    "planted-skill",
    "planted-agent",
  ]
  const leaks = {
    content: [{ text: "planted transcript text", type: "text" }],
    message: { content: "planted transcript text" },
    prompt: "planted prompt text",
    transcript: "planted transcript text",
  }
  const bytesSince = (before: number) => bytes.slice(before).join("")

  test("no planted prompt or transcript text in a metrics body reaches the collector", async () => {
    const before = bytes.length
    const planted = {
      ...leaks,
      resourceMetrics: [
        {
          resource: { attributes: [s("prompt", "planted prompt text")] },
          scopeMetrics: [
            {
              metrics: [
                {
                  ...sum("claude_code.token.usage", {
                    ...point(
                      9,
                      s("model", "claude-opus-5-5"),
                      s("type", "input"),
                      s("user_prompt", "planted prompt text"),
                    ),
                    ...leaks,
                  }),
                  transcript: "planted transcript text",
                },
              ],
            },
          ],
        },
      ],
    }
    expect((await post("/v1/metrics", planted)).status).toBe(200)
    expect(bytes.length).toBe(before + 1)
    for (const text of PLANTED) expect(bytesSince(before)).not.toContain(text)
  })

  test("no planted prompt, transcript text, or tool, skill or agent name in a backfill reaches the collector", async () => {
    const before = bytes.length
    const res = await post("/v1/transcripts", {
      ...leaks,
      rollups: [
        {
          ...leaks,
          day: "2026-10-14",
          inputTokens: 3,
          skillCounts: { "planted-skill": 1 },
          subagentCounts: { "planted-agent": 1 },
          toolCalls: 4,
          toolCounts: { "planted-tool": 4 },
          tool_input: { command: "planted prompt text", file_path: "planted transcript text" },
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(bytes.length).toBe(before + 1)
    for (const text of PLANTED) expect(bytesSince(before)).not.toContain(text)
    expect(bytesSince(before)).not.toContain("toolCalls")
  })

  test("answers a logs body carrying a prompt and sends nothing on", async () => {
    const before = bytes.length
    const res = await post("/v1/logs", {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [s("event.name", "user_prompt"), s("prompt", "planted prompt text")],
                  body: { stringValue: "claude_code.user_prompt" },
                },
              ],
            },
          ],
        },
      ],
    })
    expect(await res.json()).toEqual({})
    expect(bytes.length).toBe(before)
  })

  test("logs one line naming each blocked key it dropped, never its value", async () => {
    const lines: string[] = []
    const spy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "))
    })
    try {
      await post("/v1/transcripts", {
        rollups: [
          {
            day: "2026-10-15",
            inputTokens: 1,
            prompt: "planted prompt text",
            toolCounts: { "planted-tool": 1 },
          },
        ],
      })
    } finally {
      spy.mockRestore()
    }
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("prompt")
    expect(lines[0]).toContain("toolCounts")
    for (const text of PLANTED) expect(lines[0]).not.toContain(text)
  })

  test("sends every login's usage under the one login, and answers a body with nothing locally", async () => {
    const other = JSON.parse(JSON.stringify(exportBody).replaceAll(LOGIN, "other@example.com"))
    await post("/v1/metrics", other)
    expect(JSON.stringify(received.at(-1))).not.toContain("other@example.com")
    expect(JSON.stringify(received.at(-1))).toContain(LOGIN)
    const before = received.length
    const empty = await post("/v1/transcripts", { rollups: [{ day: "not a day" }] })
    expect(await empty.json()).toEqual({ written: 0 })
    expect(received.length).toBe(before)
  })

  test("forwards backfill posts one at a time, so the whole sum always arrives last", async () => {
    const order: number[] = []
    let first = true
    const slow = Bun.serve({
      async fetch(req) {
        const body = (await req.json()) as { rollups: { inputTokens: number }[] }
        if (first) {
          first = false
          await Bun.sleep(150)
        }
        order.push(body.rollups[0]?.inputTokens ?? -1)
        return Response.json({ written: 1 })
      },
      hostname: "127.0.0.1",
      port: 0,
    })
    const queued = startRelay({
      login: LOGIN,
      port: 0,
      token: null,
      upstream: `http://127.0.0.1:${slow.port}`,
    })
    const row = { day: "2026-10-12", inputTokens: 5, machineId: "m1", seatDir: ".claude" }
    const send = (r: typeof row) =>
      fetch(`http://${HOST}:${queued.port}/v1/transcripts`, {
        body: JSON.stringify({ rollups: [r] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    await Promise.all([send(row), send({ ...row, inputTokens: 7, seatDir: ".claude-work" })])
    queued.stop()
    slow.stop(true)
    expect(order).toEqual([5, 12])
  })

  test("answers logs, a GET, an unknown path, a gzip body and bad JSON without forwarding", async () => {
    const before = received.length
    expect((await post("/v1/logs", { resourceLogs: [] })).status).toBe(200)
    expect((await fetch(`${url}/v1/metrics`)).status).toBe(404)
    expect((await post("/v1/traces", {})).status).toBe(404)
    const gzip = await fetch(`${url}/v1/metrics`, {
      body: "x",
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
      method: "POST",
    })
    expect(gzip.status).toBe(415)
    const bad = await fetch(`${url}/v1/metrics`, {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    expect(bad.status).toBe(400)
    expect(received.length).toBe(before)
  })

  test("refuses a web page's request: one with an Origin, or a body that is not JSON", async () => {
    const before = received.length
    const page = await fetch(`${url}/v1/metrics`, {
      body: JSON.stringify(exportBody),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      method: "POST",
    })
    expect(page.status).toBe(403)
    const plain = await fetch(`${url}/v1/metrics`, {
      body: JSON.stringify(exportBody),
      headers: { "content-type": "text/plain" },
      method: "POST",
    })
    expect(plain.status).toBe(415)
    expect(received.length).toBe(before)
  })

  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)
  test.skipIf(!lan)("listens on loopback alone", async () => {
    if (!lan) return
    await expect(
      fetch(`http://${lan.address}:${relay.port}/v1/logs`, { method: "POST" }),
    ).rejects.toThrow()
  })

  test("names an unreachable upstream", async () => {
    const dead = startRelay({
      login: LOGIN,
      onResult: (r) => results.push(r),
      port: 0,
      token: null,
      upstream: "http://127.0.0.1:1",
    })
    const res = await fetch(`http://${HOST}:${dead.port}/v1/metrics`, {
      body: JSON.stringify(exportBody),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    dead.stop()
    expect(res.status).toBe(502)
    expect(results.at(-1)).toContain("upstream unreachable")
  })

  describe("a dropped forward", () => {
    const forward = async (drops: number, status = 200) => {
      let tries = 0
      const answer = `{"written":1}`
      const flaky = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket) {
            socket.write(
              `HTTP/1.1 ${status} X\r\ncontent-type: application/json\r\ncontent-length: ${answer.length}\r\nconnection: close\r\n\r\n${answer}`,
            )
            socket.end()
          },
          open(socket) {
            tries += 1
            if (tries <= drops) socket.end()
          },
        },
      })
      const seen: string[] = []
      const flakyRelay = startRelay({
        login: LOGIN,
        onResult: (r) => seen.push(r),
        port: 0,
        token: null,
        upstream: `http://127.0.0.1:${flaky.port}`,
      })
      const res = await fetch(`http://${HOST}:${flakyRelay.port}/v1/metrics`, {
        body: JSON.stringify(exportBody),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      flakyRelay.stop()
      flaky.stop(true)
      return { res, seen, tries }
    }

    test("is retried once, so the caller and the last result read ok", async () => {
      const { res, seen, tries } = await forward(1)
      expect(res.status).toBe(200)
      expect(tries).toBe(2)
      expect(seen).toEqual(["ok"])
    })

    test("fails after two drops in a row, naming the path", async () => {
      const { res, seen, tries } = await forward(2)
      expect(res.status).toBe(502)
      expect(tries).toBe(2)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain("upstream unreachable on /v1/metrics")
    })

    test("is the only thing retried: a 500 answer is passed on once", async () => {
      const { res, seen, tries } = await forward(0, 500)
      expect(res.status).toBe(500)
      expect(tries).toBe(1)
      expect(seen).toEqual(["upstream 500 on /v1/metrics"])
    })
  })

  test("sends the token to an upstream off loopback", async () => {
    const away = startRelay({
      login: LOGIN,
      port: 0,
      token: "t",
      upstream: `http://[::ffff:127.0.0.1]:${upstream.port}`,
    })
    await fetch(`http://${HOST}:${away.port}/v1/metrics`, {
      body: JSON.stringify(exportBody),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    away.stop()
    expect(received.at(-1)?.token).toBe("t")
  })

  test("follows no redirect, so the token never reaches another host", async () => {
    const elsewhere: (string | null)[] = []
    const target = Bun.serve({
      fetch: (req) => {
        elsewhere.push(req.headers.get("x-loom-token"))
        return Response.json({})
      },
      hostname: "127.0.0.1",
      port: 0,
    })
    const mover = Bun.serve({
      fetch: () =>
        new Response(null, {
          headers: { location: `http://127.0.0.1:${target.port}/v1/metrics` },
          status: 307,
        }),
      hostname: "127.0.0.1",
      port: 0,
    })
    const away = startRelay({
      login: LOGIN,
      onResult: (r) => results.push(r),
      port: 0,
      token: "t",
      upstream: `http://[::ffff:127.0.0.1]:${mover.port}`,
    })
    const res = await fetch(`http://${HOST}:${away.port}/v1/metrics`, {
      body: JSON.stringify(exportBody),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    away.stop()
    mover.stop(true)
    target.stop(true)
    expect(res.status).toBe(502)
    expect(elsewhere).toEqual([])
    expect(results.at(-1)).toContain("upstream unreachable")
  })
})
