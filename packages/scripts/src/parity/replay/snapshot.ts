// `--snapshot`: one live tools/list per server, the vendor's schemas and never a row, so a replay's stub lists the tools the real server does.

type Json = Record<string, unknown>
export type Server = { args?: string[]; command: string; env?: Record<string, string> }

// The tools a stdio MCP server lists, asked over one initialize and one tools/list, the server stopped after.
export const listTools = async (server: Server, timeoutMs = 60_000): Promise<Json[]> => {
  const child = Bun.spawn([server.command, ...(server.args ?? [])], {
    env: { ...process.env, ...server.env },
    stderr: "ignore",
    stdin: "pipe",
    stdout: "pipe",
  })
  const send = (message: Json) => child.stdin.write(`${JSON.stringify(message)}\n`)
  send({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "parity-snapshot", version: "0.0.0" },
      protocolVersion: "2025-06-18",
    },
  })
  send({ jsonrpc: "2.0", method: "notifications/initialized" })
  send({ id: 2, jsonrpc: "2.0", method: "tools/list" })
  const timer = setTimeout(() => child.kill(), timeoutMs)
  let buffered = ""
  try {
    for await (const chunk of child.stdout) {
      buffered += new TextDecoder().decode(chunk)
      for (const line of buffered.split("\n").slice(0, -1)) {
        const message = JSON.parse(line) as Json
        if (message.id === 2) {
          const tools = ((message.result as Json | undefined)?.tools as Json[] | undefined) ?? []
          return tools.toSorted((a, b) => String(a.name).localeCompare(String(b.name)))
        }
      }
      buffered = buffered.slice(buffered.lastIndexOf("\n") + 1)
    }
    throw new Error("the server closed before it listed its tools")
  } finally {
    clearTimeout(timer)
    child.kill()
  }
}
