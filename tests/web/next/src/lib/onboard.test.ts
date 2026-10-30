import { describe, expect, test } from "bun:test"

import {
  canContinue,
  CHECKS_REQUEST,
  type Check,
  checksOf,
  checksPath,
  type FixJob,
  fixJobOf,
  fixTitle,
  linesOf,
  markOf,
  needOf,
  refusalOf,
  runnable,
  settled,
  toFix,
} from "../../../../../web/next/src/lib/onboard"

const docker: Check = {
  action: { id: "docker", label: "Install Docker" },
  detail: "not found",
  name: "docker",
  need: "the database",
  note: "Docker runs your database.",
  status: "MISSING",
}
const database: Check = {
  action: null,
  detail: "starts once docker is here",
  name: "Database",
  need: null,
  note: "Your database starts once Docker is here.",
  status: "waiting",
}
const git: Check = {
  action: null,
  detail: "2.47.1",
  name: "git",
  need: null,
  note: null,
  status: "ok",
}
const portless: Check = {
  action: null,
  detail: "not trusted",
  name: "portless",
  need: "named local addresses",
  note: "Your Mac asks for its password once to trust local addresses.",
  status: "optional",
}
const settings: Check = {
  action: { id: "settings", label: "Set up settings" },
  detail: "not set up",
  name: "Settings",
  need: "your accounts and extensions",
  note: "Set up after you sign in, in the next steps.",
  status: "optional",
}

describe("checksOf", () => {
  test("reads the checks in the API's order with the done mark", () => {
    const checks = [docker, database, git, portless, settings]
    expect(checksOf({ data: { checks, done: false } })).toEqual({ checks, done: false })
    expect(checksOf({ data: { checks: [], done: true } })).toEqual({ checks: [], done: true })
  })

  test("is undefined for a body that does not read as the contract's", () => {
    expect(checksOf(null)).toBeUndefined()
    expect(checksOf({ data: {} })).toBeUndefined()
    expect(checksOf({ data: { checks: [git] } })).toBeUndefined()
    expect(
      checksOf({ data: { checks: [{ ...git, status: "broken" }], done: false } }),
    ).toBeUndefined()
    expect(
      checksOf({ data: { checks: [{ ...docker, action: { id: 1 } }], done: false } }),
    ).toBeUndefined()
    const { note: _, ...old } = git
    expect(checksOf({ data: { checks: [{ ...old, fix: null }], done: false } })).toBeUndefined()
  })
})

describe("canContinue", () => {
  test("holds while a row is missing or waiting, never for an optional one", () => {
    expect(canContinue([docker, git])).toBe(false)
    expect(canContinue([database, git])).toBe(false)
    expect(canContinue([git, portless, settings])).toBe(true)
  })
})

describe("runnable", () => {
  test("gives a row's action the app runs, and none for settings, which is a step, or a row with none", () => {
    expect(runnable(docker)).toEqual({ id: "docker", label: "Install Docker" })
    expect(runnable(settings)).toBeNull()
    expect(runnable(git)).toBeNull()
    expect(runnable({ ...docker, status: "ok" })).toBeNull()
  })
})

describe("toFix", () => {
  test("keeps each row still missing, for Settings' list", () => {
    expect(toFix([docker, database, git, portless])).toEqual([docker])
  })
})

describe("fixJobOf and settled", () => {
  const read: FixJob = {
    device: null,
    id: "docker",
    lines: ["Downloading"],
    reason: null,
    state: "running",
  }

  test("reads the fix read, with gh's device code while it waits", () => {
    expect(fixJobOf({ data: read })).toEqual(read)
    const device = { code: "ABCD-1234", url: "https://github.com/login/device" }
    expect(fixJobOf({ data: { ...read, device, id: "gh-login" } })?.device).toEqual(device)
    for (const body of [
      null,
      { data: {} },
      { data: { ...read, state: "done" } },
      { data: { ...read, lines: "x" } },
    ]) {
      expect(fixJobOf(body)).toBeUndefined()
    }
  })

  test("reads a fix read with no device as one with none, as the brief's { id, lines, state, reason } has it", () => {
    const { device: _, ...bare } = read
    expect(fixJobOf({ data: bare })).toEqual(read)
  })

  test("a job is settled once it is ok or failed", () => {
    expect(
      ["idle", "running", "ok", "failed"].map((state) => settled({ ...read, state } as never)),
    ).toEqual([false, false, true, true])
  })
})

describe("linesOf", () => {
  const job: FixJob = { device: null, id: "git", lines: [], reason: null, state: "running" }

  test("keeps a job's last lines", () => {
    expect(linesOf({ ...job, lines: ["a", "b", "c", "d", "e"] })).toEqual(["c", "d", "e"])
    expect(linesOf(job)).toEqual([])
  })

  test("shows none while gh waits on its code, since the code and Open GitHub say it in the app's words", () => {
    const device = { code: "MADE-0001", url: "https://github.com/login/device" }
    expect(linesOf({ ...job, device, id: "gh-login", lines: ["Press Enter to open"] })).toEqual([])
  })
})

describe("fixTitle", () => {
  test("counts the things to fix", () => {
    expect(fixTitle(1)).toBe("1 thing to fix")
    expect(fixTitle(2)).toBe("2 things to fix")
  })
})

describe("markOf", () => {
  test("marks found, missing, optional and waiting", () => {
    expect([git, docker, portless, database].map((check) => markOf(check.status))).toEqual([
      "✓",
      "✗",
      "○",
      "–",
    ])
  })
})

describe("needOf", () => {
  test("says what a missing or optional tool is for, and nothing for one found or waiting", () => {
    expect(needOf(docker)).toBe("needed: the database")
    expect(needOf(portless)).toBe("optional: named local addresses")
    expect(needOf(git)).toBeUndefined()
    expect(needOf(database)).toBeUndefined()
  })
})

describe("refusalOf", () => {
  test("reads the envelope's message, else the status", () => {
    expect(refusalOf({ error: { message: "An owner exists" } }, 409)).toBe("An owner exists")
    expect(refusalOf(null, 500)).toBe("The API answered 500")
  })
})

describe("CHECKS_REQUEST", () => {
  test("sends no cookie, so the setup app's CORS, which allows no credentials, lets the browser read its answer", () => {
    expect(CHECKS_REQUEST.credentials).toBeUndefined()
  })
})

describe("checksPath", () => {
  test("Settings reads every probe live, so it lists what is missing after the done mark; first run reads the mark", () => {
    expect(checksPath({ live: true })).toBe("checks?live=1")
    expect(checksPath({ live: false })).toBe("checks")
  })
})
