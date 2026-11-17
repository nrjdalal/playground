import { afterAll, describe, expect, spyOn, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { MARKER } from "../../../../../packages/safe-delete/src"
import {
  accountKept,
  BOX_LOAD_MULT,
  boxPath,
  Browser,
  capacityRefusals,
  clean,
  databaseCheck,
  dropBox,
  hostTools,
  installCheck,
  installEnv,
  leftForYou,
  makeBox,
  plantLogin,
  readAfter,
  report,
  resultLine,
  roomReadings,
  scriptsGroup,
  shotAfter,
  STEP_COUNT,
  type Step,
  strayStandIns,
  usageWords,
  zshStartup,
} from "../../../../../packages/scripts/src/new-user-gate/cli"
import { stubs, usageReading } from "../../../../../packages/scripts/src/new-user-gate/stubs"
import { withFakeAgentBrowser } from "../../../../agent-browser-fake"
import { machineTest, zshMissing } from "../../../../machine"
import { scratchEnv } from "../../../../scratch-env"
import { procDir } from "../../../../scripts/fixtures/proc"

describe("the new-user gate's reads", () => {
  test("reads install.sh's Left for you lines, and none from a clean finish", () => {
    expect(
      leftForYou(
        "Playground needs git...\nLeft for you:\n  - node: brew install node\ninstall.sh exit 1",
      ),
    ).toEqual(["node: brew install node"])
    expect(leftForYou("Playground is ready.\ninstall.sh exit 0")).toEqual([])
  })

  test("takes a usage reading as shown, and No usage windows read as none", () => {
    expect(usageWords("Alpha\nClaude usage: week 12% left, 5-hour 80% left\n")).toBe(
      "week 12% left, 5-hour 80% left",
    )
    expect(usageWords("Alpha\nClaude usage: No usage windows read\n")).toBeNull()
    expect(usageWords("Alpha\nClaude usage: Not read yet\n")).toBeNull()
    expect(usageWords("Alpha")).toBeNull()
  })

  test("finds the Scripts group by its header, with or without its count, and not by a row's words", () => {
    expect(scriptsGroup("Alpha\nScripts\n2\nClaude usage readings")).toBe(true)
    expect(scriptsGroup("Alpha\nScripts 2\n")).toBe(true)
    expect(scriptsGroup("Alpha\nScripts2\n")).toBe(true)
    expect(scriptsGroup("Alpha is not running\nEvery agent's state is on the System page.")).toBe(
      false,
    )
    expect(scriptsGroup("Script · Failing · every minute")).toBe(false)
  })

  test("prints PASS or FAIL per step with its detail, then the count", () => {
    expect(
      report([
        { detail: "", name: "curl | bash exits 0", ok: true },
        { detail: "no usage reading", name: "Usage shows", ok: false },
      ]),
    ).toBe("PASS 1. curl | bash exits 0\nFAIL 2. Usage shows: no usage reading\n1 of 2 passed")
  })

  test("names a shot the step could not take on its line, and leaves a taken shot's path off it", () => {
    expect(
      report([
        {
          detail: "",
          name: "curl | bash exits 0",
          ok: true,
          shot: "no shot: agent-browser wait: timed out after 25000ms",
        },
        { detail: "", name: "Usage shows", ok: true, shot: "/box/shots/5-usage.png" },
      ]),
    ).toBe(
      "PASS 1. curl | bash exits 0 (no shot: agent-browser wait: timed out after 25000ms)\nPASS 2. Usage shows\n2 of 2 passed",
    )
  })
})

// #1674: step 1 opened the page and waited for networkidle inside its check, so a slow page failed an install that passed.
describe("a step's screenshot settle", () => {
  const settleFails = () => {
    throw new Error("agent-browser wait: timed out after 25000ms")
  }

  test("a settle wait that throws leaves a passing install step passing, and names itself in the shot's place", () => {
    const taken: string[] = []
    const got = installCheck("Playground is ready.\ninstall.sh exit 0", () =>
      shotAfter(() => {
        taken.push("1-install")
        return "/box/shots/1-install.png"
      }, settleFails),
    )
    expect(got).toEqual({
      detail: "",
      ok: true,
      shot: "no shot: agent-browser wait: timed out after 25000ms",
    })
    expect(taken).toEqual([])
  })

  test("a failing install still fails, its shot taken once", () => {
    const order: string[] = []
    const got = installCheck(
      "Left for you:\n  - node: brew install node\ninstall.sh exit 1",
      () => {
        order.push("shot")
        return "/box/shots/1-install.png"
      },
    )
    expect(got.ok).toBe(false)
    expect(got.detail).toBe("exit 1; left for you: node: brew install node")
    expect(order).toEqual(["shot"])
  })

  test("a screenshot that throws is named in the shot's place, and one that settles gives its path", () => {
    expect(
      shotAfter(() => {
        throw new Error("agent-browser screenshot: no page")
      }),
    ).toBe("no shot: agent-browser screenshot: no page")
    expect(
      shotAfter(
        () => "/box/shots/7-follows-main.png",
        () => {},
      ),
    ).toBe("/box/shots/7-follows-main.png")
  })

  test("a settle wait that throws inside a step's read loop still reads the page, so the step judges its text", () => {
    expect(readAfter(settleFails, () => "Usage 12% of the week")).toBe("Usage 12% of the week")
    const order: string[] = []
    expect(
      readAfter(
        () => order.push("settle"),
        () => {
          order.push("read")
          return "Scripts 2"
        },
      ),
    ).toBe("Scripts 2")
    expect(order).toEqual(["settle", "read"])
  })
})

// #1767: step 2 clicked Start the database once before the button rendered, so under load the step failed while the app was fine.
describe("step 2's database click", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "gate-dbclick-")))
  afterAll(() => rmSync(parent, { force: true, recursive: true }))

  test("a fake browser that shows the button only on its third poll passes", async () => {
    const env = join(parent, ".env")
    let polls = 0
    const got = await databaseCheck(
      () => {
        polls++
        if (polls < 3) return false
        writeFileSync(env, "POSTGRES_URL=postgres://gate:gate@127.0.0.1:5432/gate\n")
        return true
      },
      () => existsSync(env) && /^POSTGRES_URL=\S/m.test(readFileSync(env, "utf8")),
      { buttonMs: 60_000, pollMs: 1, urlMs: 2_000 },
    )
    expect(got).toEqual({ detail: "", ok: true })
    expect(polls).toBe(3)
  })

  test("a page read as a 404 until its second reopen shows the button then and passes", async () => {
    const env = join(parent, "reopen.env")
    let opens = 0
    const got = await databaseCheck(
      () => {
        if (opens < 2) return false
        writeFileSync(env, "POSTGRES_URL=postgres://gate:gate@127.0.0.1:5432/gate\n")
        return true
      },
      () => existsSync(env) && /^POSTGRES_URL=\S/m.test(readFileSync(env, "utf8")),
      { buttonMs: 1_000, pollMs: 1, urlMs: 2_000 },
      () => opens++,
    )
    expect(got).toEqual({ detail: "", ok: true })
    expect(opens).toBe(2)
  })

  test("a fake browser that never shows the button gives up at the button's deadline, before the URL's", async () => {
    const started = Date.now()
    const got = await databaseCheck(
      () => false,
      () => false,
      {
        buttonMs: 100,
        pollMs: 1,
        urlMs: 2_000,
      },
    )
    expect(got).toEqual({
      detail: "the Start the database button never showed in 0.1s",
      ok: false,
    })
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test("a shown button whose URL never lands waits the URL's deadline out and names it", async () => {
    const got = await databaseCheck(
      () => true,
      () => false,
      {
        buttonMs: 100,
        pollMs: 1,
        urlMs: 2_000,
      },
    )
    expect(got).toEqual({
      detail: "no POSTGRES_URL in the desk's .env after 2s",
      ok: false,
    })
  })
})

describe("a step failed on spawn.sh's capacity gate", () => {
  // two rows as spawn.sh's gate_capacity writes them to capacity.jsonl: a pass, then the load refusal a box met at load 26.9
  const log = [
    JSON.stringify({
      at: "2026-10-31T01:30:00Z",
      detail: "",
      gate: "",
      readings: { load5: 9.1 },
      verdict: "pass",
    }),
    JSON.stringify({
      at: "2026-10-31T01:31:05Z",
      detail:
        "max(load1, load5) is 26.90 and 0 started in the last 5 minutes, at or over 11.25: 15, the 15 cores at PLAYGROUND_LOAD_MULT 1, less the 3.75 kept for small items (this start is medium). Wait for it to fall, or close a session that is done, and run it again.",
      gate: "load",
      readings: { load5: 26.9 },
      verdict: "refused",
    }),
    "not json",
  ].join("\n")

  test("names each refusal since the step began, by its gate and its words, and none from before it", () => {
    expect(capacityRefusals(log, "2026-10-31T01:31:00Z")).toEqual([
      expect.stringMatching(/^load gate: max\(load1, load5\) is 26\.90 .* at or over 11\.25/),
    ])
    expect(capacityRefusals(log, "2026-10-31T01:32:00Z")).toEqual([])
  })

  test("reads INCONCLUSIVE, not FAIL, and counts it apart", () => {
    expect(
      report([
        { detail: "", name: "curl | bash exits 0", ok: true },
        {
          detail: "spawn.sh's capacity gate refused a start (load gate: …)",
          inconclusive: true,
          name: "Alpha routes",
          ok: false,
        },
      ]),
    ).toBe(
      "PASS 1. curl | bash exits 0\nINCONCLUSIVE 2. Alpha routes: spawn.sh's capacity gate refused a start (load gate: …)\n1 of 2 passed, 1 inconclusive",
    )
  })
})

describe("the gate's Add account on Linux (#2391)", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "gate-account-")))
  afterAll(() => rmSync(parent, { force: true, recursive: true }))

  test("an account saved through Linux's security, as storeSecret saves it, reads as kept", () => {
    const box = join(parent, "box")
    const home = join(box, "h")
    mkdirSync(home, { recursive: true })
    expect(accountKept(box, home, "gate@example.com")).toBe(false)
    const shim = join(import.meta.dir, "../../../../../packages/scripts/src/security/cli.ts")
    const saved = Bun.spawnSync([process.execPath, "--no-env-file", shim, "-i"], {
      env: scratchEnv(home, { PLAYGROUND_DATA_DIR: undefined }),
      stdin: new TextEncoder().encode(
        'add-generic-password -U -s "playground-claude-oauth" -a "gate@example.com" -w "made-up"\n',
      ),
    })
    expect(saved.exitCode).toBe(0)
    expect(accountKept(box, home, "gate@example.com")).toBe(true)
    expect(accountKept(box, home, "other@example.com")).toBe(false)
  })
})

describe("the box on this host's OS (#2374)", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "gate-host-")))
  afterAll(() => rmSync(parent, { force: true, recursive: true }))

  test("install.sh reads the host's OS from uname, so on Linux it takes its Linux branch, not brew", () => {
    expect(
      installEnv(join(parent, "box"), join(parent, "box", "h"), "/usr/bin"),
    ).not.toHaveProperty("INSTALL_OS")
  })

  test("the made-up stored login reads through Linux's security, which takes Claude's login from ~/.claude/.credentials.json", () => {
    const box = join(parent, "login")
    const home = join(box, "h")
    mkdirSync(home, { recursive: true })
    const user = process.env.USER ?? "gate"
    plantLogin(box, home, usageReading(user, Date.now()))
    const shim = join(import.meta.dir, "../../../../../packages/scripts/src/security/cli.ts")
    const read = Bun.spawnSync(
      [
        process.execPath,
        "--no-env-file",
        shim,
        "find-generic-password",
        "-a",
        user,
        "-s",
        "Claude Code-credentials",
        "-w",
      ],
      { env: { HOME: home, PATH: process.env.PATH ?? "", PLAYGROUND_DATA_DIR: join(box, "data") } },
    )
    expect(read.exitCode).toBe(0)
    expect(JSON.parse(read.stdout.toString()).claudeAiOauth.accessToken).toBe("made-up")
  })

  test("install.sh's own uv step on Linux finds this host's uv on the box's PATH, so calls.log holds no curl", () => {
    const box = join(parent, "uv")
    mkdirSync(join(box, "stubs"), { recursive: true })
    for (const [name, text] of Object.entries(stubs(box, "", "/bin/false"))) {
      writeFileSync(join(box, "stubs", name), text)
      chmodSync(join(box, "stubs", name), 0o755)
    }
    const uv = join(parent, "host-uv")
    writeFileSync(uv, "#!/bin/sh\necho uv 0.0.0\n")
    chmodSync(uv, 0o755)
    const install = readFileSync(join(import.meta.dir, "../../../../../install.sh"), "utf8")
    const has = install.match(/^has\(\) \{.*\}$/m)?.[0]
    const step = install.match(/^install_tool\(\) \{\n[\s\S]*?\n\}$/m)?.[0]
    const ran = Bun.spawnSync(["bash", "-c", `${has}\n${step}\nOS=Linux\ninstall_tool uv`], {
      env: { HOME: join(box, "h"), PATH: boxPath(box, hostTools(box, uv)) },
    })
    const calls = existsSync(join(box, "calls.log"))
      ? readFileSync(join(box, "calls.log"), "utf8")
      : ""
    expect({ calls, code: ran.exitCode }).toEqual({ calls: "", code: 0 })
    expect(realpathSync(join(box, "tools", "uv"))).toBe(uv)
  })
})

describe("the gate's browser", () => {
  test("tries an open again after a network change, through networkChangedWait", () => {
    const cli = join(import.meta.dir, "../../../../../packages/scripts/src/new-user-gate/cli.ts")
    const run = withFakeAgentBrowser(
      1,
      "net::ERR_NETWORK_CHANGED at http://dashboard/",
      `import { Browser } from ${JSON.stringify(cli)}; new Browser("/nowhere").cmd("open", "http://dashboard/")`,
    )
    expect(run.err).toContain("net::ERR_NETWORK_CHANGED, retry 1 of 2")
    expect(run.code).toBe(0)
    expect(run.calls).toHaveLength(2)
  })
})

describe("the box", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "gate-box-")))
  afterAll(() => rmSync(parent, { force: true, recursive: true }))

  test("is a marked scratch folder named for its sha, which dropBox removes, and dropBox leaves an unmarked folder, logging why (#545)", () => {
    const box = makeBox("abcdef1234567890", parent)
    expect(basename(box)).toStartWith("pg-gate-abcdef1-")
    expect(existsSync(join(box, MARKER))).toBe(true)
    dropBox(box)
    expect(existsSync(box)).toBe(false)
    const other = join(parent, "pg-gate-other")
    mkdirSync(other)
    const said = spyOn(console, "error").mockImplementation(() => {})
    try {
      dropBox(other)
      expect(existsSync(other)).toBe(true)
      expect(String(said.mock.calls[0]?.[0])).toContain(`has no ${MARKER} marker`)
    } finally {
      said.mockRestore()
    }
  })

  test("with agent-browser missing, the browser's close throws nothing and clean still removes the box, stopping only the box's proxy with none of the machine's live state", () => {
    const box = makeBox("abcdef1234567890", parent)
    const bin = join(parent, "bin")
    const calls = join(parent, "portless-calls")
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, "docker"), "#!/bin/sh\nexit 0\n")
    writeFileSync(join(bin, "portless"), `#!/bin/sh\n{ echo "argv $*"; env; } >> '${calls}'\n`)
    chmodSync(join(bin, "docker"), 0o755)
    chmodSync(join(bin, "portless"), 0o755)
    const live = {
      HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
      PATH: `${bin}:/usr/bin:/bin`,
      PLAYGROUND_DATA_DIR: "/home/owner/.playground",
      PORTLESS_STATE_DIR: "/home/owner/.portless/fallback",
    }
    const saved = Object.fromEntries(Object.keys(live).map((key) => [key, process.env[key]]))
    Object.assign(process.env, live)
    try {
      expect(() => new Browser(join(box, "shots")).close()).not.toThrow()
      clean(box, join(box, "h"), join(bin, "portless"))
    } finally {
      for (const [key, value] of Object.entries(saved))
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    expect(existsSync(box)).toBe(false)
    const said = readFileSync(calls, "utf8")
    expect(said).toContain("argv proxy stop -p 14155")
    expect(said).toContain(`HOME=${join(box, "h")}`)
    for (const key of ["HERDR_SOCKET_PATH", "PLAYGROUND_DATA_DIR", "PORTLESS_STATE_DIR"])
      expect(said).not.toContain(`${key}=`)
  })

  test("every child the gate starts takes its env from boxEnv's allowlist, never a spread of process.env", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../../../packages/scripts/src/new-user-gate/cli.ts"),
    ).text()
    expect(source).not.toContain("...process.env")
  })
})

describe("the gate's stand-ins preflight", () => {
  const box = realpathSync(mkdtempSync(join(tmpdir(), "gate-preflight-")))
  afterAll(() => rmSync(box, { force: true, recursive: true }))
  const home = join(box, "h")
  mkdirSync(join(box, "stubs"), { recursive: true })
  mkdirSync(home, { recursive: true })
  const names = Object.keys(stubs(box, ""))
  for (const [name, text] of Object.entries(stubs(box, ""))) {
    writeFileSync(join(box, "stubs", name), text)
    chmodSync(join(box, "stubs", name), 0o755)
  }

  // the preflight's zsh runs with a PATH of its own, so the system folders, where macOS keeps zsh, are where it must be
  const NO_ZSH = zshMissing("/usr/bin:/bin")

  machineTest(
    NO_ZSH,
    "with no startup files, the box's zsh finds security outside the stubs folder, and the preflight names it",
    () => {
      const stray = strayStandIns(box, home, names)
      expect(stray.filter((line) => /^-l?c security\b/.test(line))).toHaveLength(2)
    },
  )

  // a test that narrows this process's PATH and leaves it narrowed changes nothing here, since Bun finds the preflight's zsh on the PATH its child gets
  machineTest(
    NO_ZSH,
    "the preflight still finds zsh after a test narrowed this process's PATH to a folder without it",
    () => {
      const was = process.env.PATH
      process.env.PATH = join(box, "stubs")
      try {
        expect(Bun.which("zsh", { PATH: process.env.PATH })).toBeNull()
        const stray = strayStandIns(box, home, names)
        expect(stray.filter((line) => /^-l?c security\b/.test(line))).toHaveLength(2)
      } finally {
        process.env.PATH = was
      }
    },
  )

  machineTest(
    NO_ZSH,
    "the box's startup relaxes spawn.sh's load gate by BOX_LOAD_MULT, read as a number over 1",
    () => {
      const set = Bun.spawnSync(
        ["zsh", "-c", `${zshStartup(box)}print -r -- $PLAYGROUND_LOAD_MULT`],
        {
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        },
      )
      expect(set.stdout.toString().trim()).toBe(String(BOX_LOAD_MULT))
      expect(BOX_LOAD_MULT).toBeGreaterThan(1)
    },
  )

  machineTest(
    NO_ZSH,
    "with the box's startup files, every stand-in resolves to the stubs folder in a plain and a login zsh",
    () => {
      for (const rc of [".zshenv", ".zprofile"]) writeFileSync(join(home, rc), zshStartup(box))
      expect(strayStandIns(box, home, names)).toEqual([])
    },
  )

  test("the box's startup sends the profile read and ops-usage's probe to a closed loopback port, and ops-usage's stored-login reads to the box's usage reading", () => {
    expect(zshStartup(box)).toContain("export PLAYGROUND_PROFILE_URL=http://127.0.0.1:9/profile\n")
    expect(zshStartup(box)).toContain(
      "export PLAYGROUND_PROBE_URL=http://127.0.0.1:9/v1/messages\n",
    )
    expect(zshStartup(box)).toContain(
      `export PLAYGROUND_USAGE_API=file://${join(box, "usage-api")}\n`,
    )
  })
})

describe("the gate's last line, which ship:merge reads (#1659)", () => {
  const SHA = "a11fb8850c8304a91ab714b2ff46ad89fe7411a7"
  const step = (name: string, ok: boolean, inconclusive?: boolean): Step => ({
    detail: "",
    name,
    ok,
    ...(inconclusive && { inconclusive }),
  })
  const all = () => Array.from({ length: STEP_COUNT }, (_, i) => step(`step ${i + 1}`, true))

  test("a run that reached every step with none reading FAIL reads PASS, an INCONCLUSIVE step included", () => {
    expect(resultLine(SHA, all())).toBe(`New-user gate at ${SHA}: PASS`)
    const unsure = [...all().slice(1), step("Usage", false, true)]
    expect(resultLine(SHA, unsure)).toBe(`New-user gate at ${SHA}: PASS`)
  })

  test("a step reading FAIL, or a run that stopped short of its last step, reads FAIL", () => {
    expect(resultLine(SHA, [...all().slice(1), step("Usage", false)])).toBe(
      `New-user gate at ${SHA}: FAIL`,
    )
    expect(resultLine(SHA, [])).toBe(`New-user gate at ${SHA}: FAIL`)
    expect(resultLine(SHA, all().slice(1))).toBe(`New-user gate at ${SHA}: FAIL`)
  })

  test("STEP_COUNT is the number of steps main checks", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../../../packages/scripts/src/new-user-gate/cli.ts"),
    ).text()
    expect(source.match(/\bawait check\((?!\))/g)?.length).toBe(STEP_COUNT)
  })
})

// The wait for room reads the load and the cores as spawn.sh's load gate does: sysctl, else /proc's text, and a reading neither gives is null, never 0 or NaN, which waited for nothing (#2201).
describe("the gate's room readings", () => {
  const saved = process.env.PLAYGROUND_PROC
  afterAll(() => {
    process.env.PLAYGROUND_PROC = saved
  })
  const linux = (name: string) => ({
    code: 255,
    out: `sysctl: cannot stat /proc/sys/${name.replaceAll(".", "/")}: No such file or directory\n`,
  })

  test("macOS's sysctl gives the cores and max(load1, load5)", () => {
    const mac = (name: string) => ({
      code: 0,
      out: name === "hw.ncpu" ? "15\n" : "{ 3.00 16.50 9.00 }\n",
    })
    expect(roomReadings(mac)).toEqual({ cores: 15, load: 16.5 })
  })

  test("Linux's /proc/stat and /proc/loadavg give them where sysctl does not", () => {
    process.env.PLAYGROUND_PROC = procDir({ cores: 20, load1: 12.5, load5: 4 })
    expect(roomReadings(linux)).toEqual({ cores: 20, load: 12.5 })
  })

  test.each([
    ["sysctl exits non-zero", linux],
    ["sysctl prints nothing", () => ({ code: 0, out: "" })],
    ["sysctl prints no numbers", () => ({ code: 0, out: "{ x y z }\n" })],
  ])("%s and /proc gives neither: both are null", (_, answer) => {
    process.env.PLAYGROUND_PROC = procDir({}, ["loadavg", "stat"])
    expect(roomReadings(answer)).toEqual({ cores: null, load: null })
  })
})
