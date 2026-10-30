import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  recorded,
  type Recording,
} from "../../../../../../packages/scripts/src/parity/replay/stub-mcp"

const STUB = join(
  import.meta.dir,
  "../../../../../../packages/scripts/src/parity/replay/stub-mcp.ts",
)
const scratch = mkdtempSync(join(tmpdir(), "stub-mcp-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const RECORDING: Recording = {
  get_issue: [
    { args: { id: "ACME-1" }, result: { id: "ACME-1", title: "Made up" } },
    { args: {}, isError: true, result: "Entity not found" },
  ],
  list_issues: [{ args: { assignee: "me", state: "started" }, result: [] }],
}

describe("recorded", () => {
  test("the entry naming the most matching keys wins, and a catch-all takes the rest", () => {
    expect(recorded(RECORDING, "get_issue", { fields: ["title"], id: "ACME-1" })?.result).toEqual({
      id: "ACME-1",
      title: "Made up",
    })
    expect(recorded(RECORDING, "get_issue", { id: "ACME-2" })?.isError).toBe(true)
  })

  test("a call with a value the recording does not hold, or a tool it lacks, is a miss", () => {
    expect(recorded(RECORDING, "list_issues", { assignee: "me", state: "done" })).toBeUndefined()
    expect(recorded(RECORDING, "list_comments", { issueId: "ACME-1" })).toBeUndefined()
  })
})

describe("the stub over stdio", () => {
  test("initializes, lists its snapshot's tools, answers a recorded call and logs a miss", async () => {
    const recording = join(scratch, "recording.json")
    const schemas = join(scratch, "schemas.json")
    const log = join(scratch, "misses.jsonl")
    writeFileSync(recording, JSON.stringify(RECORDING))
    writeFileSync(schemas, JSON.stringify([{ inputSchema: { type: "object" }, name: "get_issue" }]))
    writeFileSync(log, "")
    const messages = [
      { id: 1, jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
      {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { id: "ACME-1" }, name: "get_issue" },
      },
      {
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { team: "X" }, name: "list_issues" },
      },
      { id: 5, jsonrpc: "2.0", method: "resources/list" },
    ]
    const run = Bun.spawn(
      [
        "bun",
        STUB,
        "--server",
        "linear-shared",
        "--recording",
        recording,
        "--schemas",
        schemas,
        "--log",
        log,
      ],
      {
        stdin: new Blob([messages.map((m) => JSON.stringify(m)).join("\n") + "\n"]),
        stdout: "pipe",
      },
    )
    const out = (await new Response(run.stdout).text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
    expect(await run.exited).toBe(0)
    expect(out.map((m) => m.id)).toEqual([1, 2, 3, 4, 5])
    expect(out[0].result.serverInfo.name).toBe("linear-shared")
    expect(out[1].result.tools.map((t: { name: string }) => t.name)).toEqual(["get_issue"])
    expect(JSON.parse(out[2].result.content[0].text)).toEqual({ id: "ACME-1", title: "Made up" })
    expect(out[3].result.isError).toBe(true)
    expect(out[3].result.content[0].text).toStartWith("not in the recording: list_issues")
    expect(out[4].error.code).toBe(-32601)
    expect(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l)),
    ).toEqual([{ args: { team: "X" }, kind: "miss", server: "linear-shared", tool: "list_issues" }])
  })
})
