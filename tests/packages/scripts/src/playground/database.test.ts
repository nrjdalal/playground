import { describe, expect, test } from "bun:test"

import {
  type Docker,
  ensureDatabase,
  POLICY_LINE,
  STOPPED_LINE,
} from "../../../../../packages/scripts/src/playground/database"

const LIVE = "playground-db"
const PAIR = { branch: "live/dashboard", database: LIVE }

// Docker as a script: each call's argv is recorded, and answers come from the first rule whose first argument matches, else success with no output.
const fake = (
  containers: string,
  policy = "unless-stopped",
  answers: Record<string, { code: number; out: string }> = {},
) => {
  const calls: string[][] = []
  const docker: Docker = async (args) => {
    calls.push(args)
    if (answers[args[0]!]) return answers[args[0]!]!
    if (args[0] === "ps") return { code: 0, out: containers }
    if (args[0] === "inspect") return { code: 0, out: policy }
    return { code: 0, out: "" }
  }
  return { calls, docker }
}

describe("ensureDatabase", () => {
  test("starts a stopped database, saying so in one line", async () => {
    const { calls, docker } = fake(`other\trunning\n${LIVE}-x9Kq\texited`)
    expect(await ensureDatabase(PAIR, docker)).toEqual({ lines: [STOPPED_LINE] })
    expect(STOPPED_LINE).toBe("The Dashboard's database was stopped; starting it")
    expect(calls).toContainEqual(["start", `${LIVE}-x9Kq`])
  })

  test("sets a database with no restart policy to start again with Docker", async () => {
    const { calls, docker } = fake(`${LIVE}\trunning`, "no")
    expect(await ensureDatabase(PAIR, docker)).toEqual({ lines: [POLICY_LINE] })
    expect(calls).toContainEqual(["update", "--restart", "unless-stopped", LIVE])
    expect(calls.some(([verb]) => verb === "start")).toBe(false)
  })

  test("leaves a running database that already restarts with Docker as it is", async () => {
    for (const policy of ["always", "unless-stopped"]) {
      const { calls, docker } = fake(`${LIVE}-Ab12\trunning`, policy)
      expect(await ensureDatabase(PAIR, docker)).toEqual({ lines: [] })
      expect(calls.map(([verb]) => verb)).toEqual(["ps", "inspect"])
    }
  })

  test("leaves a paused or restarting database to Docker, since docker start would refuse it", async () => {
    for (const state of ["paused", "restarting"]) {
      const { calls, docker } = fake(`${LIVE}\t${state}`)
      expect(await ensureDatabase(PAIR, docker)).toEqual({ lines: [] })
      expect(calls.map(([verb]) => verb)).toEqual(["ps", "inspect"])
    }
  })

  test("touches nothing when Docker does not answer or no single container is the Dashboard's", async () => {
    for (const run of [
      fake("", "no", { ps: { code: 1, out: "Cannot connect to the Docker daemon" } }),
      fake("other\texited\nplayground-db-long-name\texited", "no"),
      fake(`${LIVE}\texited\n${LIVE}-x9Kq\texited`, "no"),
    ]) {
      expect(await ensureDatabase(PAIR, run.docker)).toEqual({ lines: [] })
      expect(run.calls.map(([verb]) => verb)).toEqual(["ps"])
    }
  })

  test("names each step Docker refused, in Docker's words", async () => {
    const { docker } = fake(`${LIVE}\texited`, "no", {
      start: { code: 1, out: "port is already allocated" },
      update: { code: 1, out: "permission denied" },
    })
    expect(await ensureDatabase(PAIR, docker)).toEqual({
      failed: `docker update --restart unless-stopped ${LIVE} failed: permission denied; docker start ${LIVE} failed: port is already allocated`,
      lines: [STOPPED_LINE],
    })
  })
})
