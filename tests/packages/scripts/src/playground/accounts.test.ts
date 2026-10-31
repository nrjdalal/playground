import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { accountsIo, runAccounts } from "../../../../../packages/scripts/src/playground/accounts"
import { scopeDir } from "../../../../../packages/settings/src/rendered"

process.env.PLAYGROUND_LOGIN = "made-up-me"

// A fake security first on PATH, a Keychain of one file a line per service and account: it logs each argv and its stdin, and never the secret itself, which it keeps as a sha256.
const scratch = mkdtempSync(join(tmpdir(), "playground-accounts-"))
const log = join(scratch, "log")
const kept = join(scratch, "kept")
writeFileSync(kept, "")
writeFileSync(
  join(scratch, "security"),
  `#!/bin/bash
printf 'argv %s\\n' "$*" >> "${log}"
case "$1" in
  -i) read -r line; [[ $line =~ -s\\ \\"([^\\"]*)\\"\\ -a\\ \\"([^\\"]*)\\"\\ -w\\ \\"([^\\"]*)\\" ]] || exit 1
    item="\${BASH_REMATCH[1]} \${BASH_REMATCH[2]}"; grep -v "^$item " "${kept}" > "${kept}.n"; echo "$item $(printf %s "\${BASH_REMATCH[3]}" | shasum -a 256 | cut -c1-12)" >> "${kept}.n"; mv "${kept}.n" "${kept}"; printf 'stdin %s\\n' "\${line%%-w *}" >> "${log}" ;;
  find-generic-password) grep -q "^$3 $5 " "${kept}" ;;
  delete-generic-password) grep -q "^$3 $5 " "${kept}" || exit 44; grep -v "^$3 $5 " "${kept}" > "${kept}.n"; mv "${kept}.n" "${kept}" ;;
esac
`,
)
chmodSync(join(scratch, "security"), 0o755)
const path = process.env.PATH
process.env.PATH = `${scratch}:${path}`
afterAll(() => {
  process.env.PATH = path
  rmSync(scratch, { force: true, recursive: true })
})

const data = join(scratch, "data")
const run = async (words: string[], secret = "", setup = 0) => {
  const out: string[] = []
  const err: string[] = []
  const asked: string[] = []
  let setups = 0
  const code = await runAccounts(words, {
    data,
    err: (line) => err.push(line),
    out: (line) => out.push(line),
    readSecret: async (prompt) => (asked.push(prompt), secret),
    setupToken: async () => (setups++, setup),
  })
  return { asked, code, err: err.join("\n"), out: out.join("\n"), setups }
}
const rows = () =>
  JSON.parse(readFileSync(join(scopeDir(data, "made-up-me"), "settings.json"), "utf8"))[
    "usage.accounts"
  ]
const keychain = () => readFileSync(kept, "utf8")

describe("playground accounts", () => {
  test("add keeps a Claude token by its email after claude setup-token, and a GLM key by its label, as usage.accounts rows", async () => {
    const claude = await run(
      ["add", "--provider", "claude", "--email", "one@example.test"],
      "sk-ant-oat01-made_up",
    )
    expect(claude).toMatchObject({ code: 0, err: "", setups: 1 })
    expect(claude.out.split("\n").at(-1)).toBe(
      "+ claude one@example.test: its secret kept under playground-claude-oauth, its row added to usage.accounts",
    )
    expect(claude.asked[0]).toContain("does not echo")
    const glm = await run(["add", "--provider", "glm", "--label", "spare"], "made.up.key\n")
    expect(glm).toMatchObject({ code: 0, err: "", setups: 0 })
    expect(rows()).toEqual([{ email: "one@example.test" }, { label: "spare", provider: "glm" }])
    expect(keychain()).toMatch(/^playground-claude-oauth one@example\.test [0-9a-f]{12}\n/)
    expect(keychain()).toMatch(/\nplayground-glm spare [0-9a-f]{12}\n$/)
    expect(readFileSync(log, "utf8")).not.toContain("made_up")
    expect(readFileSync(log, "utf8")).not.toContain("made.up.key")
  })

  test("add for Claude prints the guided sign-in's 3 steps before setup-token shows its link", async () => {
    const seen: string[] = []
    const add = (words: string[]) =>
      runAccounts(words[0] === "remove" ? words : ["add", ...words], {
        data: join(scratch, "steps"),
        err: (line) => seen.push(`err ${line}`),
        out: (line) => seen.push(line),
        readSecret: async () => (words.includes("glm") ? "made.up.key" : "sk-ant-oat01-made_up"),
        setupToken: async () => (seen.push("setup-token"), 0),
      })
    expect(await add(["--provider", "claude", "--email", "steps@example.test"])).toBe(0)
    const at = seen.indexOf("setup-token")
    expect(seen.slice(0, at)).toEqual([
      "Add a Claude account in 3 steps:",
      "  1. Open the link claude setup-token prints below in a private or guest window, so this browser's own Claude sign-in stays out of it.",
      "  2. Sign in there with the account you want to add, not the one this browser holds, and approve access.",
      "  3. Paste the code the page shows at setup-token's prompt, then the token it prints when asked here.",
    ])
    seen.length = 0
    expect(await add(["--provider", "glm", "--label", "steps"])).toBe(0)
    expect(seen.join("\n")).not.toContain("3 steps")
    expect(await add(["remove", "steps@example.test"])).toBe(0)
    expect(await add(["remove", "steps"])).toBe(0)
  })

  test("the terminal's setup-token runs with BROWSER opening nothing, so no default browser signs in", async () => {
    const seen = join(scratch, "browser")
    writeFileSync(
      join(scratch, "claude"),
      `#!/bin/sh\nprintf '%s %s' "$*" "$BROWSER" > "${seen}"\n`,
    )
    chmodSync(join(scratch, "claude"), 0o755)
    try {
      expect(Bun.which("claude", { PATH: process.env.PATH })).toBe(join(scratch, "claude"))
      expect(await accountsIo(data).setupToken()).toBe(0)
      expect(readFileSync(seen, "utf8")).toBe("setup-token /usr/bin/true")
    } finally {
      rmSync(join(scratch, "claude"))
    }
  })

  test("add again keeps the new secret and the row as it was; a bad token, a failed setup-token or no secret saves nothing", async () => {
    const before = keychain()
    expect(
      (await run(["add", "--provider", "glm", "--label", "spare"], "other.key")).out,
    ).toStartWith("= glm spare:")
    expect(keychain()).not.toBe(before)
    expect(rows()).toHaveLength(2)
    const saved = keychain()
    expect(
      await run(["add", "--provider", "claude", "--email", "two@example.test"], "not-a-token"),
    ).toMatchObject({ code: 1, err: expect.stringContaining("not a Claude token") })
    expect(
      await run(["add", "--provider", "claude", "--email", "two@example.test"], "sk-ant-x", 1),
    ).toMatchObject({ code: 1, err: expect.stringContaining("setup-token exited 1") })
    expect(await run(["add", "--provider", "glm", "--label", "third"], "")).toMatchObject({
      code: 1,
    })
    expect(keychain()).toBe(saved)
    expect(rows()).toHaveLength(2)
  })

  test("add refuses a provider, a label or a field the rows refuse, before any secret is asked for", async () => {
    for (const words of [
      ["add", "--provider", "openai", "--label", "x"],
      ["add", "--provider", "glm", "--label", "Bad Label"],
      ["add", "--provider", "glm", "--label", "x", "--email", "a@example.test"],
      ["add", "--provider", "claude"],
    ]) {
      const refused = await run(words, "sk-ant-x")
      expect(refused).toMatchObject({ asked: [], code: 2, setups: 0 })
      expect(refused.err).toContain("usage: playground accounts")
    }
  })

  test("list names each row, whether its secret is kept and its last reading, and never a secret", async () => {
    mkdirSync(join(data, "ops", "usage"), { recursive: true })
    writeFileSync(
      join(data, "ops", "usage", "login-flip.json"),
      JSON.stringify({ seen: { "one@example.test": { five: 12.4, week: 40 } } }),
    )
    writeFileSync(
      join(data, "zai-usage.json"),
      JSON.stringify({
        windows: { fiveHour: { cap: 200, used: 50 }, week: { cap: 1000, used: 100 } },
      }),
    )
    const list = await run(["list"])
    expect(list).toMatchObject({ code: 0, err: "" })
    expect(list.out).toBe(
      ["claude one@example.test: kept, 5h 12%, week 40%", "glm spare: kept, 5h 25%, week 10%"].join(
        "\n",
      ),
    )
  })

  test("list reads an empty GLM balance as both windows spent, and a failed read as no reading, as the sidebar does", async () => {
    const windows = { fiveHour: { cap: 200, used: 6 }, week: { cap: 1000, used: 10 } }
    writeFileSync(
      join(data, "zai-usage.json"),
      JSON.stringify({ balance: { empty: true, seenAt: "2026-10-31T12:00:00.000Z" }, windows }),
    )
    expect((await run(["list"])).out).toContain(
      "glm spare: kept, 5h 100%, week 100%, the balance empty since 2026-10-31T12:00:00.000Z",
    )
    writeFileSync(
      join(data, "zai-usage.json"),
      JSON.stringify({ error: "Z.ai 500: code ?", errorAt: "2026-10-31T12:05:00.000Z", windows }),
    )
    expect((await run(["list"])).out).toContain(
      "glm spare: kept, no reading: the usage read failed at 2026-10-31T12:05:00.000Z",
    )
  })

  test("list reads a reading with no 5-hour window as none, never ?", async () => {
    writeFileSync(
      join(data, "ops", "usage", "login-flip.json"),
      JSON.stringify({ seen: { "one@example.test": { five: null, week: 40 } } }),
    )
    expect((await run(["list"])).out).toContain("claude one@example.test: kept, 5h none, week 40%")
  })

  test("a folder ext init made, with no policy.json written yet, lists no accounts and adds one", async () => {
    const fresh = join(scratch, "fresh")
    mkdirSync(join(fresh, "extensions", "made-up-me"), { recursive: true })
    writeFileSync(join(fresh, "extensions", "login"), "made-up-me\n")
    const io = (out: string[]) => ({
      data: fresh,
      err: (line: string) => out.push(line),
      out: (line: string) => out.push(line),
      readSecret: async () => "fresh.key",
      setupToken: async () => 0,
    })
    const listed: string[] = []
    expect(await runAccounts(["list"], io(listed))).toBe(0)
    expect(listed).toEqual(["no accounts yet: playground accounts add adds one"])
    expect(await runAccounts(["add", "--provider", "glm", "--label", "fresh"], io([]))).toBe(0)
    expect(await runAccounts(["remove", "fresh"], io([]))).toBe(0)
  })

  test("add leaves no Keychain item behind when its row cannot be written: no login, or a write that fails", async () => {
    const before = keychain()
    const io = (folder: string, err: string[]) => ({
      data: folder,
      err: (line: string) => err.push(line),
      out: () => {},
      readSecret: async () => "orphan.key",
      setupToken: async () => 0,
    })
    const nologin = join(scratch, "nologin")
    mkdirSync(join(nologin, "extensions"), { recursive: true })
    const err: string[] = []
    delete process.env.PLAYGROUND_LOGIN
    try {
      expect(
        await runAccounts(["add", "--provider", "glm", "--label", "orphan"], io(nologin, err)),
      ).toBe(1)
    } finally {
      process.env.PLAYGROUND_LOGIN = "made-up-me"
    }
    expect(err.join("\n")).toContain("run playground ext init")
    expect(keychain()).toBe(before)
    const blocked = join(scratch, "blocked")
    mkdirSync(join(blocked, "extensions"), { recursive: true })
    writeFileSync(join(blocked, "extensions", "made-up-me"), "a file where the scope's folder goes")
    expect(
      await runAccounts(["add", "--provider", "glm", "--label", "orphan"], io(blocked, [])),
    ).toBe(1)
    expect(keychain()).toBe(before)
  })

  test("remove takes an email or a label, and drops the row and its Keychain item", async () => {
    expect((await run(["remove", "spare"])).out).toBe(
      "- glm spare: its row removed, and its secret from the Keychain",
    )
    expect((await run(["remove", "nobody"])).code).toBe(1)
    expect((await run(["remove", "one@example.test"])).code).toBe(0)
    expect(rows()).toEqual([])
    expect(keychain()).toBe("")
    expect((await run(["list"])).out).toBe("no accounts yet: playground accounts add adds one")
  })
})
