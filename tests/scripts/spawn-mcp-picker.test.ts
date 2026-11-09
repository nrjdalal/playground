import { expect, setDefaultTimeout, test } from "bun:test"
import { realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { herdrPin, placing, spawn } from "./spawn-fake"

setDefaultTimeout(40_000)

// Claude Code 2.1.319's two project MCP pickers, as read in its binary: what a run of keys writes to the folder's .claude/settings.local.json.
type Written = { disabledMcpjsonServers: string[]; enabledMcpjsonServers: string[] }

// One server: options "Use this MCP server", "Use this and all future MCP servers in this project", "Continue without using this MCP server", focus starting on the last; Esc picks the last.
const onePicker = (server: string, keys: string[]): Written => {
  let focus = 2
  for (const key of keys) {
    if (key === "up") focus = Math.max(0, focus - 1)
    else if (key === "down") focus = Math.min(2, focus + 1)
    else if (key === "esc" || (key === "enter" && focus === 2))
      return { disabledMcpjsonServers: [server], enabledMcpjsonServers: [] }
    else if (key === "enter") return { disabledMcpjsonServers: [], enabledMcpjsonServers: [server] }
  }
  return { disabledMcpjsonServers: [], enabledMcpjsonServers: [] }
}

// Several servers: a multi-select with every server selected, focus on the first, and an "Enable selected" button below the last; Enter on a server toggles it, Enter on the button writes the selected as enabled and the rest as disabled, and Esc ("reject all") disables every one.
const manyPicker = (servers: string[], keys: string[]): Written => {
  const selected = new Set(servers)
  let focus = 0
  let onButton = false
  for (const key of keys) {
    if (key === "down") {
      if (focus === servers.length - 1) onButton = true
      else if (!onButton) focus += 1
    } else if (key === "up") {
      if (onButton) onButton = false
      else focus = Math.max(0, focus - 1)
    } else if (key === "esc") return { disabledMcpjsonServers: servers, enabledMcpjsonServers: [] }
    else if (key === "enter" && onButton)
      return {
        disabledMcpjsonServers: servers.filter((s) => !selected.has(s)),
        enabledMcpjsonServers: servers.filter((s) => selected.has(s)),
      }
    else if (key === "enter") {
      const server = servers[focus]!
      if (selected.has(server)) selected.delete(server)
      else selected.add(server)
    }
  }
  return { disabledMcpjsonServers: [], enabledMcpjsonServers: [] }
}

const nothing: Written = { disabledMcpjsonServers: [], enabledMcpjsonServers: [] }
const FACTORY = ["fs", "git", "a", "b", "c", "d", "e"]

// The factory's own MCP file, ~/.mcp.json, with FACTORY's servers, or none at all, and any other file the case writes.
const keysFor = async (
  screen: string,
  mcpFile = true,
  more = (_home: string) => {},
  env: Record<string, string> = {},
) => {
  const r = await spawn(
    ["manager", "optimizer", "b.md", "--runtime", "herdr"],
    [],
    { FAKE_SCREENS: `${screen},ready`, ...env },
    undefined,
    undefined,
    (home) => {
      herdrPin()(home)
      if (mcpFile)
        writeFileSync(
          join(home, ".mcp.json"),
          JSON.stringify({ mcpServers: Object.fromEntries(FACTORY.map((s) => [s, {}])) }),
        )
      more(home)
    },
  )
  return {
    code: r.code,
    err: r.err,
    keys: placing(r).flatMap((c) => (c[1] === "send-keys" ? [c[3]!] : [])),
  }
}

test("under the code root, the one-server MCP picker is answered with its server used, and none disabled", async () => {
  const { code, keys } = await keysFor("mcp")
  expect(code).toBe(0)
  expect(onePicker("fs", keys)).toEqual({
    disabledMcpjsonServers: [],
    enabledMcpjsonServers: ["fs"],
  })
})

test("under the code root, the many-server MCP picker is answered with every server enabled, and none disabled", async () => {
  const { code, keys } = await keysFor("mcpmany")
  expect(code).toBe(0)
  expect(manyPicker(["fs", "git"], keys)).toEqual({
    disabledMcpjsonServers: [],
    enabledMcpjsonServers: ["fs", "git"],
  })
})

test("a picker of more servers than its five rows show is read as it scrolls, and every server is enabled", async () => {
  const { code, keys } = await keysFor("mcpseven")
  expect(code).toBe(0)
  expect(manyPicker(FACTORY, keys)).toEqual({
    disabledMcpjsonServers: [],
    enabledMcpjsonServers: FACTORY,
  })
})

// A picker naming a server outside ~/.mcp.json gets no Enter, so it writes nothing and stays for the owner.
for (const [screen, servers] of [
  ["mcpother", ["evil"]],
  ["mcpmanyother", ["fs", "evil"]],
  ["mcpsevenother", ["fs", "git", "a", "b", "c", "d", "evil"]],
] as const) {
  test(`a ${screen} picker, which lists a server outside the factory's MCP file, stays for the owner`, async () => {
    const { err, keys } = await keysFor(screen)
    expect(keys).not.toContain("enter")
    expect(
      (servers.length > 1 ? manyPicker : (k: string[]) => onePicker("evil", k))([...servers], keys),
    ).toEqual(nothing)
    expect(err).toContain("lists a server from outside")
  })
}

test("a plugin's server, which the picker labels with its plugin, stays for the owner", async () => {
  const { err, keys } = await keysFor("mcpplugin")
  expect(keys).not.toContain("enter")
  expect(manyPicker(["fs", "git (from plugin tools)"], keys)).toEqual(nothing)
  expect(err).toContain("lists a server from outside")
})

// The folder a manager starts in, whose parent's .mcp.json Claude Code also reads, the nearest taking a name over.
const above = (home: string) => join(home, "code", "factory", ".mcp.json")

test("a .mcp.json on the folder's walk that redefines a factory server stays for the owner, naming the file", async () => {
  let file = ""
  const { err, keys } = await keysFor("mcp", true, (home) => {
    file = above(home)
    writeFileSync(file, JSON.stringify({ mcpServers: { fs: { command: "other" } } }))
  })
  expect(keys).toEqual([])
  expect(err).toContain(`also reads ${realpathSync(file)}`)
})

test("a .mcp.json on the folder's walk that defines no server leaves the picker answered", async () => {
  const { code, keys } = await keysFor("mcp", true, (home) =>
    writeFileSync(above(home), JSON.stringify({ mcpServers: {} })),
  )
  expect(code).toBe(0)
  expect(onePicker("fs", keys)).toEqual({
    disabledMcpjsonServers: [],
    enabledMcpjsonServers: ["fs"],
  })
})

test("with no factory MCP file, the one-server picker stays for the owner", async () => {
  const { err, keys } = await keysFor("mcp", false)
  expect(keys).toEqual([])
  expect(err).toContain("has no server list it can read")
})

// herdr can drop a key, so a lost move leaves the pointer short of the row spawn.sh means to pick, and Enter there would choose for the owner.
test("a lost up leaves the one-server picker on its all-future row, which gets no Enter", async () => {
  const { err, keys } = await keysFor("mcp", true, undefined, { FAKE_LOST_KEY: "2" })
  expect(keys).not.toContain("enter")
  expect(err).toContain('"Use this and all future MCP servers in this project" marked')
})

test("a lost down leaves the many-server picker on its last server, which gets no Enter", async () => {
  const { err, keys } = await keysFor("mcpmany", true, undefined, { FAKE_LOST_KEY: "2" })
  expect(keys).not.toContain("enter")
  expect(err).toContain('"[✔] git" marked where "Enable selected" was wanted')
})
