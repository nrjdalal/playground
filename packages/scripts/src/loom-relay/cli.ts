import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"

import { writeAtomic } from "../write-atomic"
import { dropBlocked, filterMetrics, transcriptSums } from "./filter"

const HELP = `bun run loom-relay

Relays Claude Code's usage export to Loom, sending only usage: token counts, cost and session
counts with the model and the day, never a prompt, transcript, summary, path, or skill, agent, tool
or subagent name. Every login's usage on this machine goes out under your own login alone, with no
other account's email, id or organisation. Usage on a model that is not Claude's (a GLM session's)
is dropped whole, since Loom counts Claude usage. It listens on 127.0.0.1 alone, takes OTLP/HTTP
JSON on /v1/metrics (and answers /v1/logs without sending it on) and the transcript backfill on
/v1/transcripts, drops a fixed blocklist of known text, path and name keys (logging the key's name
alone), and builds each body it forwards from an allowlist. Loom replaces a backfill row,
and this relay sums the backfill's rows in memory, so run the backfill over the whole machine (no
--only or --exclude), and if the relay restarts during a backfill, run it again the same way. It
refuses a request with an Origin header (a web page) or a body that is not application/json.

  LOOM_RELAY_LOGIN     required: your own login's email, the one every record goes out under
  LOOM_RELAY_PORT      the port it listens on (default 4319)
  LOOM_RELAY_UPSTREAM  the collector's base URL, such as https://<collector>

The upstream token is read once at start from the macOS Keychain, service loom-ingest, and sent
only to an https upstream off this machine. With no token it forwards only to a loopback upstream.
Its heartbeat is ops/ops-loom-relay.json in the data folder, every 60s.`

export const HOST = "127.0.0.1"
const JOB = "ops-loom-relay"
const KEYCHAIN_SERVICE = "loom-ingest"
const CYCLE_SECONDS = 60
const MAX_BODY = 8 * 1024 * 1024
// The login every record goes out under, or null when LOOM_RELAY_LOGIN is unset or not an email: it has no default, so no one's usage is ever sent under another person's login.
export const relayLogin = (env: Record<string, string | undefined>): string | null => {
  const login = env.LOOM_RELAY_LOGIN ?? ""
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login) ? login : null
}

const isLoopback = (url: URL) => ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)

// Why the relay must not start against this upstream, or null when it may.
export const upstreamProblem = (upstream: string | undefined, token: string | null) => {
  if (!upstream) return "LOOM_RELAY_UPSTREAM is not set"
  let url: URL
  try {
    url = new URL(upstream)
  } catch {
    return "LOOM_RELAY_UPSTREAM is not a URL"
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return "LOOM_RELAY_UPSTREAM is not http or https"
  if (isLoopback(url)) return null
  if (!token)
    return `no token in the Keychain (service ${KEYCHAIN_SERVICE}), so only a loopback upstream is allowed`
  if (url.protocol !== "https:") return "an upstream off this machine must be https"
  return null
}

// Forwards each allowed body to upstream, all of it under login; onResult gets "ok" or why the last forward failed.
export const startRelay = ({
  login,
  onResult = () => {},
  port,
  token,
  upstream,
}: {
  login: string
  onResult?: (result: string) => void
  port: number
  token: string | null
  upstream: string
}): { port: number; stop: () => void } => {
  const base = upstream.replace(/\/+$/, "")
  const sendToken = token && !isLoopback(new URL(base))
  // Each path's filter, and the answer Claude Code or the backfill gets when nothing is left to send.
  const routes: Record<
    string,
    { empty: object; filter: (body: unknown, login: string) => object | null }
  > = {
    "/v1/metrics": { empty: { partialSuccess: {} }, filter: filterMetrics },
    "/v1/transcripts": { empty: { written: 0 }, filter: transcriptSums() },
  }
  let backfill: Promise<unknown> = Promise.resolve()
  const server = Bun.serve({
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (req.method !== "POST") return new Response(null, { status: 404 })
      // A browser's cross-site POST carries an Origin and may send text/plain with no preflight; Claude Code and the backfill send neither.
      if (req.headers.has("origin")) return new Response(null, { status: 403 })
      if (path === "/v1/logs") return Response.json({})
      const route = routes[path]
      if (!route) return new Response(null, { status: 404 })
      const type = req.headers.get("content-type") ?? ""
      const encoding = req.headers.get("content-encoding")
      if (!/^application\/json\s*(;|$)/i.test(type) || (encoding && encoding !== "identity"))
        return new Response(null, { status: 415 })
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return new Response(null, { status: 400 })
      }
      const kept = dropBlocked(body)
      body = kept.body
      if (kept.dropped.length)
        console.error(`loom-relay: dropped blocked keys on ${path}: ${kept.dropped.join(", ")}`)
      const send = async () => {
        const out = route.filter(body, login)
        if (!out) return Response.json(route.empty)
        const forward = () =>
          fetch(`${base}${path}`, {
            body: JSON.stringify(out),
            headers: {
              "content-type": "application/json",
              ...(sendToken ? { "x-loom-token": token } : {}),
            },
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          })
        try {
          // One dropped connection must not show the sender as Failing until the next send; a status is never retried.
          const res = await forward().catch(forward)
          onResult(res.ok ? "ok" : `upstream ${res.status} on ${path}`)
          return new Response(await res.text(), {
            headers: { "content-type": "application/json" },
            status: res.status,
          })
        } catch (error) {
          onResult(`upstream unreachable on ${path}: ${(error as Error).message}`)
          return new Response(null, { status: 502 })
        }
      }
      if (path !== "/v1/transcripts") return send()
      // Backfill sums go out one at a time in the order they were made, so a partial sum never reaches Loom after the whole one and replaces it.
      const turn = backfill.then(send)
      backfill = turn.catch(() => {})
      return turn
    },
    hostname: HOST,
    maxRequestBodySize: MAX_BODY,
    port,
  })
  return { port: server.port ?? port, stop: () => server.stop(true) }
}

// Writes the job's heartbeat in the shape the dashboard's heartbeatSchema reads.
export const writeHeartbeat = (path: string, startedAt: string, lastResult: string) =>
  writeAtomic(
    path,
    `${JSON.stringify({
      cycleSeconds: CYCLE_SECONDS,
      job: JOB,
      lastBeatAt: new Date().toISOString(),
      lastResult: lastResult.slice(0, 120),
      pid: process.pid,
      startedAt,
    })}\n`,
  )

const keychainToken = (): string | null => {
  try {
    const run = Bun.spawnSync(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      stdin: "ignore",
    })
    const token = run.exitCode === 0 ? run.stdout.toString().trim() : ""
    return token || null
  } catch {
    return null
  }
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    console.log(HELP)
    process.exit(0)
  }
  const fail: (message: string) => never = (message) => {
    console.error(`loom-relay: ${message}`)
    process.exit(1)
  }
  const port = Number(process.env.LOOM_RELAY_PORT || 4319)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    fail("LOOM_RELAY_PORT is not a port from 1024 to 65535")
  const login = relayLogin(process.env)
  if (!login)
    fail("set LOOM_RELAY_LOGIN to your own login's email, such as LOOM_RELAY_LOGIN=you@example.com")
  const upstream = process.env.LOOM_RELAY_UPSTREAM
  const token = keychainToken()
  const problem = upstreamProblem(upstream, token)
  if (problem || !upstream) fail(problem ?? "LOOM_RELAY_UPSTREAM is not set")
  const heartbeat = join(dataDir(), "ops", `${JOB}.json`)
  const startedAt = new Date().toISOString()
  let lastResult = "ok"
  const relay = startRelay({
    login,
    onResult: (result) => {
      if (result !== "ok") console.error(`loom-relay: ${result}`)
      lastResult = result
    },
    port,
    token,
    upstream,
  })
  const beat = () =>
    writeHeartbeat(heartbeat, startedAt, lastResult).catch((error) =>
      console.error(`loom-relay: heartbeat failed: ${(error as Error).message}`),
    )
  await beat()
  setInterval(beat, CYCLE_SECONDS * 1000)
  console.log(
    `loom-relay on http://${HOST}:${relay.port} to ${new URL(upstream).origin} for ${login}, token ${token ? "from the Keychain" : "none"}`,
  )
}
