import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { serve, socketPath } from "../../../../../packages/scripts/src/ops-wa/server"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/wa/cli.ts")
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A data folder of its own, under /tmp so its socket's path stays inside the 104 bytes macOS takes, with a body file holding the text given.
const machine = (text: string) => {
  const data = mkdtempSync("/tmp/wa-cli-")
  dirs.push(data)
  mkdirSync(join(data, "whatsapp"), { mode: 0o700 })
  const body = join(data, "body.md")
  writeFileSync(body, text)
  return { body, data }
}

const wa = async (data: string, args: string[]) => {
  const child = Bun.spawn([process.execPath, "--no-env-file", CLI, ...args], {
    env: { ...process.env, PLAYGROUND_DATA_DIR: data },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, out: (out + err).trim() }
}

describe("ops-wa's socket", () => {
  test("sends one connection's body once, whatever bytes follow its line", async () => {
    const { data } = machine("")
    const got: string[] = []
    const server = serve(socketPath(data), async (b) => {
      got.push(b)
      return "sent"
    })
    try {
      const answer = Promise.withResolvers<string>()
      let text = ""
      const socket = await Bun.connect({
        socket: {
          close: () => answer.resolve(text),
          data: (_, chunk) => void (text += chunk.toString()),
        },
        unix: socketPath(data),
      })
      socket.write('{"body":"first"}\n')
      await Bun.sleep(5)
      socket.write('{"body":"second"}\n')
      expect(await answer.promise).toBe('{"sent":true}\n')
      expect(got).toEqual(["first"])
    } finally {
      server.stop(true)
    }
  })
})

describe("playground wa send", () => {
  test("takes a body by its absolute path alone", async () => {
    const { data } = machine("hi")
    const { code, out } = await wa(data, ["send", "body.md"])
    expect(code).toBe(2)
    expect(out).toStartWith("usage: playground wa send [--to alert] <file>")
  })

  test("refuses a token-shaped body before it reaches ops-wa", async () => {
    const { body, data } = machine(`the key is xoxb-${"1".repeat(12)}-made-up`)
    const got: string[] = []
    const server = serve(socketPath(data), async (b) => {
      got.push(b)
      return "sent"
    })
    try {
      expect(await wa(data, ["send", body])).toEqual({
        code: 1,
        out: "wa send: the body holds a Slack token, which never goes over WhatsApp",
      })
      expect(got).toEqual([])
    } finally {
      server.stop(true)
    }
  })

  test("says so when ops-wa is not running", async () => {
    const { body, data } = machine("hi")
    const { code, out } = await wa(data, ["send", body])
    expect(code).toBe(1)
    expect(out).toStartWith("wa send: ops-wa is not running")
  })

  test("hands the body to ops-wa's socket, mode 600, and prints its answer", async () => {
    const { body, data } = machine("all green\n")
    const got: string[] = []
    const server = serve(socketPath(data), async (b) => {
      got.push(b)
      if (got.length > 1)
        throw new Error("ops-wa is not connected to WhatsApp now; try again in a minute")
      return "sent"
    })
    try {
      expect(statSync(socketPath(data)).mode & 0o777).toBe(0o600)
      expect(await wa(data, ["send", body])).toEqual({ code: 0, out: "wa send: sent" })
      expect(got).toEqual(["all green"])
      expect(await wa(data, ["send", body])).toEqual({
        code: 1,
        out: "wa send: ops-wa is not connected to WhatsApp now; try again in a minute",
      })
    } finally {
      server.stop(true)
    }
  })
})

describe("playground wa send --to alert (#2756)", () => {
  test("hands the body to ops-wa as a guest's reply, and a stray word after it is refused", async () => {
    const { body, data } = machine("glad you asked\n")
    const got: [string, string][] = []
    const server = serve(socketPath(data), async (b, kind) => {
      got.push([b, kind])
      return "sent"
    })
    try {
      expect(await wa(data, ["send", "--to", "alert", body])).toEqual({
        code: 0,
        out: "wa send: sent",
      })
      expect((await wa(data, ["send", "--to", "owner", body])).code).toBe(2)
      expect((await wa(data, ["alert", "--to", "alert", body])).code).toBe(2)
      expect(got).toEqual([["glad you asked", "guest"]])
    } finally {
      server.stop(true)
    }
  })
})

describe("playground wa alert (#2748)", () => {
  test("hands the body to ops-wa as an alert to the owner first, with its source, or to both at once with --now-both, while wa send's stays a reply", async () => {
    const { body, data } = machine("ops-tick is down\n")
    const got: [string, string, string | undefined][] = []
    const server = serve(socketPath(data), async (b, kind, source) => {
      got.push([b, kind, source])
      return "sent"
    })
    try {
      expect(await wa(data, ["alert", body])).toEqual({ code: 0, out: "wa alert: sent" })
      expect(await wa(data, ["alert", "--source", "test:2026-11-18T15:40Z", body])).toEqual({
        code: 0,
        out: "wa alert: sent",
      })
      expect(await wa(data, ["alert", "--now-both", body])).toEqual({
        code: 0,
        out: "wa alert: sent",
      })
      expect(await wa(data, ["send", body])).toEqual({ code: 0, out: "wa send: sent" })
      expect(got).toEqual([
        ["ops-tick is down", "first", undefined],
        ["ops-tick is down", "first", "test:2026-11-18T15:40Z"],
        ["ops-tick is down", "alert", undefined],
        ["ops-tick is down", "reply", undefined],
      ])
      const bad = await wa(data, ["alert", "--source", "no-kind", body])
      expect(bad.code).toBe(2)
      expect(bad.out).toContain("--source takes <kind>:<ref>")
    } finally {
      server.stop(true)
    }
  })

  test("prints who it reached when it reached one number alone", async () => {
    const { body, data } = machine("ops-tick is down")
    const server = serve(
      socketPath(data),
      async () => "sent to the owner alone: the alert number has never written to this number",
    )
    try {
      expect(await wa(data, ["alert", body])).toEqual({
        code: 0,
        out: "wa alert: sent to the owner alone: the alert number has never written to this number",
      })
    } finally {
      server.stop(true)
    }
  })

  test("refuses a token-shaped body before it reaches ops-wa", async () => {
    const { body, data } = machine(`the key is xoxb-${"1".repeat(12)}-made-up`)
    const { code, out } = await wa(data, ["alert", body])
    expect(code).toBe(1)
    expect(out).toBe("wa alert: the body holds a Slack token, which never goes over WhatsApp")
  })

  test("wa status reads the numbers from the settings and each one's last message", async () => {
    const { data } = machine("")
    mkdirSync(join(data, "extensions"))
    writeFileSync(
      join(data, "extensions", "policy.json"),
      JSON.stringify({ values: { "wa.owner": "+15550100001" } }),
    )
    writeFileSync(
      join(data, "whatsapp", "owner.json"),
      JSON.stringify({ jid: `${"15550100001"}@s.whatsapp.net`, ownerAt: 0 }),
    )
    expect(await wa(data, ["status"])).toEqual({
      code: 0,
      out: [
        "wa status: owner ••••0001: written since 1970-01-01T00:00:00.000Z, so alerts reach it; its 24 hours for replies are over until it writes",
        "wa status: alert: none set (wa.alert)",
      ].join("\n"),
    })
  })
})

describe("playground wa alert-set", () => {
  test("asks ops-wa to set the second number from the owner's message by its id, and prints its answer", async () => {
    const { data } = machine("")
    const asked: string[] = []
    const server = serve(
      socketPath(data),
      async () => "sent",
      async (id) => {
        asked.push(id)
        return "set the second number to ...0444 from the owner's message own1; it was unset"
      },
    )
    try {
      expect(await wa(data, ["alert-set", "--from-owner-msg", "own1"])).toEqual({
        code: 0,
        out: "wa alert-set: set the second number to ...0444 from the owner's message own1; it was unset",
      })
      expect(asked).toEqual(["own1"])
    } finally {
      server.stop(true)
    }
  })

  test("prints ops-wa's refusal and exits 1", async () => {
    const { data } = machine("")
    const server = serve(
      socketPath(data),
      async () => "sent",
      async () => {
        throw new Error("no message of the owner's in the last 24 hours has the id in9")
      },
    )
    try {
      expect(await wa(data, ["alert-set", "--from-owner-msg", "in9"])).toEqual({
        code: 1,
        out: "wa alert-set: no message of the owner's in the last 24 hours has the id in9",
      })
    } finally {
      server.stop(true)
    }
  })

  test("takes --from-owner-msg and an id alone", async () => {
    const { data } = machine("")
    for (const args of [["alert-set"], ["alert-set", "own1"], ["alert-set", "--from-owner-msg"]])
      expect((await wa(data, args)).code).toBe(2)
  })
})

describe("playground wa send --file (#2783)", () => {
  test("hands the file's path to ops-wa beside the body, to the owner or as a guest's reply, and alone with no body", async () => {
    const { body, data } = machine("the new board\n")
    const shot = join(data, "wa", "outbox", "board.png")
    mkdirSync(join(data, "wa", "outbox"), { recursive: true })
    writeFileSync(shot, "made-up bytes")
    const got: [string, string, string | undefined][] = []
    const server = serve(socketPath(data), async (b, kind, _source, file) => {
      got.push([b, kind, file])
      return "sent"
    })
    try {
      expect(await wa(data, ["send", "--file", shot, body])).toEqual({
        code: 0,
        out: "wa send: sent",
      })
      expect(await wa(data, ["send", "--to", "alert", "--file", shot, body])).toEqual({
        code: 0,
        out: "wa send: sent",
      })
      expect(await wa(data, ["send", "--file", shot])).toEqual({ code: 0, out: "wa send: sent" })
      expect(got).toEqual([
        ["the new board", "reply", shot],
        ["the new board", "guest", shot],
        ["", "reply", shot],
      ])
    } finally {
      server.stop(true)
    }
  })

  test("takes the file by its absolute path alone, and wa alert takes none", async () => {
    const { body, data } = machine("hi")
    const got: string[] = []
    const server = serve(socketPath(data), async (b) => {
      got.push(b)
      return "sent"
    })
    try {
      for (const args of [
        ["send", "--file", "board.png", body],
        ["send", "--file", join(data, "gone.png"), body],
        ["send", "--file"],
        ["alert", "--file", body, body],
      ]) {
        const { code, out } = await wa(data, args)
        expect(code).toBe(2)
        expect(out).toContain("playground wa send [--to alert] --file <path> [<file>]")
      }
      expect(got).toEqual([])
    } finally {
      server.stop(true)
    }
  })
})
