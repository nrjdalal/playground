import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const skill = () =>
  Bun.file(join(import.meta.dir, "../../../../skills/zerostarter/ui-verify/SKILL.md")).text()
const bullet = async (name: string) =>
  (await skill()).match(new RegExp(`^- \\*\\*${name}:\\*\\*.*(?:\\n  .*)*`, "m"))?.[0] ?? ""

describe("ui-verify names the CDP call for each check agent-browser's own commands cannot make (#203)", () => {
  test("a socket's host reads from Network.webSocketCreated, since the request list leaves socket opens out", async () => {
    const line = await bullet("Socket host")
    expect(line).toContain("`Network.enable`")
    expect(line).toContain("`Network.webSocketCreated`")
  })

  test("a mocked error status answers Fetch.requestPaused with Fetch.fulfillRequest, since network route answers 200 alone", async () => {
    const line = await bullet("Error status")
    expect(line).toContain("`Fetch.enable`")
    expect(line).toContain("`Fetch.fulfillRequest`")
    expect(line).toContain("`access-control-allow-credentials`")
  })
})

describe("ui-verify's Theme bullet names the two traps of a theme set through localStorage", () => {
  test("a set theme applies after a reload, since a hash-only reopen keeps the page", async () => {
    const line = await bullet("Theme")
    expect(line).toContain('`localStorage.setItem("theme", …)`')
    expect(line).toContain("reload")
    expect(line).toContain("`#hash`")
  })

  test("localStorage is per origin, so the theme is set again on each host", async () => {
    const line = await bullet("Theme")
    expect(line).toContain("per origin")
    expect(line).toContain("each host")
  })
})
