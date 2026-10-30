import { appendFileSync } from "node:fs"

// A replay's MCP server: it stands in for one real server under the same name, lists the tools of its schema snapshot and answers each call from a made-up recording, so a skill reads a board no company holds. A call the recording lacks answers an error and is logged as a miss, which fails the replay.

type Json = Record<string, unknown>

export type Tool = { description?: string; inputSchema: Json; name: string }
export type Recorded = { args?: Json; isError?: boolean; result: unknown }
export type Recording = Record<string, Recorded[]>
export type Stub = { log: string; recording: Recording; server: string; tools: Tool[] }

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Pure: whether every key the recording names holds the same value in the call; a key it leaves out may hold anything.
const covers = (want: unknown, got: unknown): boolean =>
  isRecord(want)
    ? isRecord(got) && Object.entries(want).every(([k, v]) => covers(v, got[k]))
    : JSON.stringify(want) === JSON.stringify(got)

// Pure: the recorded answer that covers the call and names the most keys, so a specific entry wins over a catch-all.
export const recorded = (recording: Recording, tool: string, args: Json): Recorded | undefined =>
  (recording[tool] ?? [])
    .filter((entry) => covers(entry.args ?? {}, args))
    .sort((a, b) => Object.keys(b.args ?? {}).length - Object.keys(a.args ?? {}).length)[0]

const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value))

// One JSON-RPC message in, its response out (null for a notification); a miss is appended to the log as one JSON line.
export const respond = (stub: Stub, message: Json): Json | null => {
  if (message.id === undefined) return null
  const params = isRecord(message.params) ? message.params : {}
  const ok = (result: Json) => ({ id: message.id, jsonrpc: "2.0", result })
  if (message.method === "initialize")
    return ok({
      capabilities: { tools: {} },
      protocolVersion: params.protocolVersion ?? "2025-06-18",
      serverInfo: { name: stub.server, version: "0.0.0" },
    })
  if (message.method === "ping") return ok({})
  if (message.method === "tools/list") return ok({ tools: stub.tools })
  if (message.method === "tools/call") {
    const tool = String(params.name)
    const args = isRecord(params.arguments) ? params.arguments : {}
    const hit = recorded(stub.recording, tool, args)
    if (hit)
      return ok({
        content: [{ text: text(hit.result), type: "text" }],
        isError: hit.isError ?? false,
      })
    appendFileSync(
      stub.log,
      `${JSON.stringify({ args, kind: "miss", server: stub.server, tool })}\n`,
    )
    return ok({
      content: [{ text: `not in the recording: ${tool} ${JSON.stringify(args)}`, type: "text" }],
      isError: true,
    })
  }
  return {
    error: { code: -32601, message: `method not found: ${String(message.method)}` },
    id: message.id,
    jsonrpc: "2.0",
  }
}

// `bun stub-mcp.ts --server <name> --recording <file> --schemas <file> --log <file>`, one JSON message a line on stdin and stdout.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const value = args[args.indexOf(name) + 1]
    if (!args.includes(name) || !value) throw new Error(`stub-mcp: ${name} is required`)
    return value
  }
  const stub: Stub = {
    log: option("--log"),
    recording: (await Bun.file(option("--recording")).json()) as Recording,
    server: option("--server"),
    tools: (await Bun.file(option("--schemas")).json()) as Tool[],
  }
  for await (const line of console) {
    if (!line.trim()) continue
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    const response = isRecord(message) ? respond(stub, message) : null
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  }
}
