import { expect, setDefaultTimeout, test } from "bun:test"

import { herdrPin, placing, spawn } from "./spawn-fake"

setDefaultTimeout(40_000)

type Written = { disabledMcpjsonServers: string[]; enabledMcpjsonServers: string[] }

// Claude Code 2.1.319's two project MCP pickers, as read in its binary: what a run of keys writes to the folder's .claude/settings.local.json.
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

const keysFor = async (screen: string) => {
  const r = await spawn(
    ["manager", "optimizer", "b.md", "--runtime", "herdr"],
    [],
    { FAKE_SCREENS: `${screen},ready` },
    undefined,
    undefined,
    herdrPin(),
  )
  return { code: r.code, keys: placing(r).flatMap((c) => (c[1] === "send-keys" ? [c[3]!] : [])) }
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
