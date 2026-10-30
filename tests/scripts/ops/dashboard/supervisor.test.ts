import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", "..", "..")
const script = await Bun.file(join(root, "scripts", "ops", "dashboard", "supervisor.sh")).text()
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "supervisor-urls-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const fn = (name: string) => script.match(new RegExp(`^${name}\\(\\) \\{.*\\}$`, "m"))?.[0]

// A stand-in for bunx that answers `portless get <name>` from a file, as portless 0.15 names a URL from whatever proxy runs when it is asked.
const bunx = join(scratch, "bunx")
const answer = join(scratch, "answer")
await Bun.write(bunx, `#!/bin/sh\n[ "$1 $2" = "portless get" ] && sed "s/NAME/$3/" "${answer}"\n`)
chmodSync(bunx, 0o755)

const run = (body: string) =>
  Bun.spawn(["bash", "-c", body], {
    env: { ...process.env, PATH: `${scratch}:${process.env.PATH}` },
    stdout: "pipe",
  })

describe("the supervisor's roll holds", () => {
  const due = async (gap: string, idle: string, db = "up") =>
    Bun.spawn([
      "bash",
      "-c",
      `ROLL_GAP=1800 OWNER_IDLE=300\n${fn("roll_due")}\nroll_due "${gap}" "${idle}" "${db}"`,
    ]).exited

  test("roll once the gap has passed and the owner is idle, and hold while either is short", async () => {
    expect(await due("1800", "300")).toBe(0)
    expect(await due("1799", "9999")).toBe(1)
    expect(await due("9999", "299")).toBe(1)
    expect(await due("1800", "300", "down")).toBe(0)
  })

  test("roll after the gap alone when the owner's idle cannot be read while the dashboard's Postgres runs (#1253)", async () => {
    expect(await due("1800", "")).toBe(0)
    expect(await due("1799", "")).toBe(1)
  })

  test("hold when the idle cannot be read because the dashboard's Postgres is down, since the roll would fail its database proof", async () => {
    expect(await due("9999", "", "down")).toBe(1)
  })

  test("are the loop's own test, its unread roll logged without a result line, so ops-dashboard keeps reading ok", () => {
    expect(script).toContain('[ -n "$idle" ] || db=$(dashboard_db)')
    expect(script).toContain('if roll_due "$gap" "$idle" "$db"; then')
    expect(script).toContain('[ -n "$idle" ] || say "owner idle unread')
  })
})

// A stand-in for docker running one container, named other than playground-dashboard-db, that publishes port 55432 on loopback; its exec records its arguments and answers 42.
const dashboardDb = join(scratch, "dashboard-db")
const docker = join(dashboardDb, "bin", "docker")
const execs = join(dashboardDb, "execs")
const checkout = join(dashboardDb, "checkout")
await Bun.write(
  docker,
  `#!/bin/sh\ncase "$1" in\n  ps) echo c0ffee ;;\n  inspect) echo '[{"Id":"c0ffee","Name":"/playground-dispatcher-db","Config":{"Image":"postgres:alpine"},"NetworkSettings":{"Ports":{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"55432"}]}}}]' ;;\n  exec) echo "$*" >> "${execs}"; echo 42 ;;\n  *) exit 9 ;;\nesac\n`,
)
chmodSync(docker, 0o755)
const { POSTGRES_URL: _, ...outside } = process.env

// Runs supervisor functions in a dashboard checkout whose .env names the port, as the supervisor runs them in its own; prints their output and the name handed to procs.sh.
const inDashboard = async (env: string, body: string) => {
  rmSync(execs, { force: true })
  rmSync(join(dashboardDb, "state"), { force: true, recursive: true })
  await Bun.write(join(checkout, ".env"), env)
  await Bun.write(join(dashboardDb, "state", "supervisor.log"), "")
  const proc = Bun.spawn(
    [
      "bash",
      "-c",
      `${fn("say")}\n${fn("dashboard_container")}\n${fn("quiet_for")}\n${fn("dashboard_db")}\n${body}`,
    ],
    {
      cwd: checkout,
      env: {
        ...outside,
        LOG: join(dashboardDb, "state", "supervisor.log"),
        PATH: `${join(dashboardDb, "bin")}:${process.env.PATH}`,
        S: join(dashboardDb, "state"),
        WT: root,
      },
      stdout: "pipe",
    },
  )
  const out = (await new Response(proc.stdout).text()).trim()
  const handed = await Bun.file(join(dashboardDb, "state", "dashboard-db"))
    .text()
    .catch(() => null)
  const ran = await Bun.file(execs)
    .text()
    .catch(() => "")
  const log = await Bun.file(join(dashboardDb, "state", "supervisor.log")).text()
  return { handed: handed?.trim(), log, out, ran }
}

const published = "POSTGRES_URL=postgres://postgres:pw@127.0.0.1:55432/postgres\n"

describe("the supervisor's dashboard database (#1335)", () => {
  test("is the container publishing POSTGRES_URL's port on loopback, whatever its name", async () => {
    const { handed, out, ran } = await inDashboard(published, "dashboard_db; quiet_for")
    expect(out).toBe("up\n42")
    expect(ran).toContain("exec playground-dispatcher-db psql -U postgres -tAc select coalesce(")
    expect(handed).toBe("playground-dispatcher-db")
  }, 15_000)

  test("reads as down, with no exec and an empty name for procs.sh, when no container publishes the port", async () => {
    const { handed, log, out, ran } = await inDashboard(
      "POSTGRES_URL=postgres://postgres:pw@127.0.0.1:55433/postgres\n",
      "dashboard_db; quiet_for",
    )
    expect(out).toBe("down")
    expect(ran).toBe("")
    expect(handed).toBe("")
    expect(log).toContain("no single running Docker container publishes port 55433")
  }, 15_000)

  test("reads as down when the dashboard checkout's .env names no POSTGRES_URL", async () => {
    const { handed, out, ran } = await inDashboard("NODE_ENV=local\n", "dashboard_db; quiet_for")
    expect(out).toBe("down")
    expect(ran).toBe("")
    expect(handed).toBe("")
  }, 15_000)

  test("logs the reason a lookup fails once, not on every tick, while it keeps failing", async () => {
    const { log } = await inDashboard(
      "POSTGRES_URL=postgres://postgres:pw@127.0.0.1:55433/postgres\n",
      "dashboard_db; dashboard_db; dashboard_db",
    )
    expect(log.match(/publishes port 55433/g)).toHaveLength(1)
  }, 15_000)

  test("is found again before every stop, so procs.sh drains the database the dashboard runs on now", () => {
    expect(script).toContain("stop_all() {\n  dashboard_container > /dev/null\n")
    expect(script).not.toContain("playground-dashboard-db")
  })
})

describe("the supervisor's dashboard URLs", () => {
  test("come from portless get, so the move to https on 443 needs no edit here", async () => {
    await Bun.write(answer, "https://desk.NAME.localhost\n")
    const proc = run(`${fn("dashboard_urls")}\ndashboard_urls && echo "$WEB $API"`)
    expect(await proc.exited).toBe(0)
    expect((await new Response(proc.stdout).text()).trim()).toBe(
      "https://desk.playground.localhost https://desk.api.playground.localhost",
    )
  })

  test("are read again on every try while the dashboard comes up, so a proxy that starts with the stack is found", async () => {
    // portless's guess before its proxy runs: a port nothing answers on
    await Bun.write(answer, "http://127.0.0.1:1/NAME\n")
    const server = Bun.serve({ fetch: () => new Response("ok"), hostname: "127.0.0.1", port: 0 })
    const proc = run(
      `${fn("dashboard_urls")}\n${fn("wait_dashboard")}\nwait_dashboard && echo "$API"`,
    )
    try {
      setTimeout(() => Bun.write(answer, `http://127.0.0.1:${server.port}/NAME\n`), 1500)
      expect(await proc.exited).toBe(0)
      expect((await new Response(proc.stdout).text()).trim()).toBe(
        `http://127.0.0.1:${server.port}/api.playground`,
      )
    } finally {
      proc.kill()
      server.stop(true)
    }
  }, 15_000)

  test("are read before check_dev's first request and before each verify", () => {
    const check = script.slice(script.indexOf("check_dev() {"))
    expect(check.indexOf("wait_dashboard")).toBeGreaterThan(-1)
    expect(check.indexOf("wait_dashboard")).toBeLessThan(check.indexOf("$API"))
    const verify = script.slice(
      script.indexOf("verify_dashboard() {"),
      script.indexOf("check_dev() {"),
    )
    expect(verify.indexOf("dashboard_urls")).toBeGreaterThan(-1)
    expect(verify.indexOf("dashboard_urls")).toBeLessThan(verify.indexOf("$WEB"))
  })

  test("name no fixed proxy port", () => {
    expect(script).not.toMatch(/localhost:1355/)
  })
})

// A stand-in for bun whose dashboard-ingest status exits with the code in a file (status exits 0 while any importer holds the lock), sleeps past the wait, or sleeps past it in a child of its own, as a wedged docker under dashboard-ingest's spawnSync does.
const bin = join(scratch, "follower-bin")
const statusCode = join(scratch, "status-code")
const childPid = join(scratch, "child-pid")
await Bun.write(
  join(bin, "bun"),
  `#!/bin/sh\n[ "$1 $2" = "api/hono/src/bin/dashboard-ingest.ts status" ] || exit 9\ncode=$(cat "${statusCode}")\n[ "$code" = sleep ] && exec sleep 30\n[ "$code" = child ] && { sleep 30 & echo $! > "${childPid}"; wait; }\nexit $code\n`,
)
chmodSync(join(bin, "bun"), 0o755)

const followerHeld = async (exit: string) => {
  await Bun.write(statusCode, exit)
  const proc = Bun.spawn(["bash", "-c", `set -m\n${fn("follower_held")}\nfollower_held`], {
    // HELD_WAIT sits at 5: past the load flake's 2, whose status answer took longer at load 20, under the 10s bounds the timeout cases assert
    env: { ...process.env, HELD_WAIT: "5", PATH: `${bin}:${process.env.PATH}` },
  })
  return proc.exited
}

describe("the supervisor's follower check", () => {
  test("reads a follower another importer holds as held, so the loop starts no second one (#1255)", async () => {
    expect(await followerHeld("0")).toBe(0)
    expect(await followerHeld("1")).toBe(1)
  })

  test("reads a status read that outlives its wait as holder unknown, and stops it, so a wedged database never freezes the loop", async () => {
    const started = Date.now()
    expect(await followerHeld("sleep")).toBe(2)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  test("stops the whole status read past its wait, a child it started included, so a wedged docker never piles up a process each tick", async () => {
    expect(await followerHeld("child")).toBe(2)
    const pid = Number(await Bun.file(childPid).text())
    const gone = async () => {
      for (let i = 0; i < 20; i++) {
        try {
          process.kill(pid, 0)
        } catch {
          return true
        }
        await Bun.sleep(100)
      }
      return false
    }
    expect(await gone()).toBe(true)
  })

  test("leaves a held follower running, named once, and restarts the follower only when its own process is gone and no importer holds the lock", () => {
    expect(script).toContain(
      "elif ! alive dashboard-ingest && { follower_held; held=$?; [ $held -ne 1 ]; }; then",
    )
    expect(script).toContain("gave no answer in ${HELD_WAIT:-20}s; not restarting it")
    expect(script).toContain('say "follower: another importer holds the lock')
    expect(script).toContain("  elif ! alive dashboard-ingest; then\n    held_said_f=")
    expect(script).toContain("  else\n    held_said_f=\n  fi\ndone")
  })
})

const block = (name: string) => {
  const at = script.indexOf(`\n${name}() {\n`) + 1
  return script.slice(at, script.indexOf("\n}\n", at) + 2)
}
const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(
    ["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { cwd, stdout: "pipe" },
  )
    .stdout.toString()
    .trim()

// A dashboard checkout: c0, then c1 changes scripts/ops/dashboard/, then c2 changes only the README; a stand-in redeploy-pull.sh resets it, and fails for the sha pull-fails names, printing its other lines, or before its reset for the sha pull-stops names; for the sha pull-prints names it prints its other lines and succeeds
const wt = join(scratch, "wt")
const dashboardDir = join(wt, "scripts", "ops", "dashboard")
const state = join(scratch, "state")
const calls = join(scratch, "calls")
const pullFails = join(state, "pull-fails")
const pullPrints = join(state, "pull-prints")
const pullStops = join(state, "pull-stops")
await Bun.write(
  join(dashboardDir, "redeploy-pull.sh"),
  `#!/bin/sh\nif [ "$1" = "$(cat ${pullStops} 2>/dev/null)" ]; then exit 128; fi\ngit reset -q --hard "$1"\nif [ "$1" = "$(head -1 ${pullPrints} 2>/dev/null)" ]; then sed 1d ${pullPrints}; fi\nif [ "$1" = "$(head -1 ${pullFails} 2>/dev/null)" ]; then sed 1d ${pullFails}; exit 1; fi\n`,
)
await Bun.write(join(dashboardDir, "procs.sh"), "#!/bin/sh\n")
await Bun.write(
  join(dashboardDir, "net-git.sh"),
  Bun.file(join(root, "scripts", "ops", "dashboard", "net-git.sh")),
)
chmodSync(join(dashboardDir, "net-git.sh"), 0o755)
await Bun.write(join(dashboardDir, "x"), "0\n")
await Bun.write(join(state, ".keep"), "")
await Bun.write(join(scratch, "ops", "notify.sh"), "#!/bin/sh\n")
chmodSync(join(dashboardDir, "redeploy-pull.sh"), 0o755)
chmodSync(join(dashboardDir, "procs.sh"), 0o755)
chmodSync(join(scratch, "ops", "notify.sh"), 0o755)
git(wt, "init", "-q")
git(wt, "add", ".")
git(wt, "commit", "-qm", "c0")
const c0 = git(wt, "rev-parse", "HEAD")
await Bun.write(join(dashboardDir, "x"), "1\n")
git(wt, "commit", "-qam", "c1")
const c1 = git(wt, "rev-parse", "HEAD")
await Bun.write(join(wt, "README"), "r\n")
git(wt, "add", "README")
git(wt, "commit", "-qm", "c2")
const c2 = git(wt, "rev-parse", "HEAD")

// roll_up passes START and FALLBACK and fails every roll, so finish_roll falls back; result records each line results.log would get
const stubs = `S=${state} WT=${wt} OPS=${scratch}/ops BAD=${state}/bad-builds LOG=${state}/supervisor.log DEVLOG=${state}/dev.log
say() { :; }; result() { echo "result $*" >> ${calls}; }; stop_all() { :; }; tell_dispatcher() { echo "tell $1" >> ${calls}; }
roll_up() { echo "roll_up $1" >> ${calls}; [ "$1" = START ] || [ "$1" = FALLBACK ]; }
UPSTREAM=canary
${fn("upstream_head")}
${fn("behind")}
${block("dev_reason")}
${block("reload_if")}
${fn("take_reload")}
${block("pull_to")}
${block("finish_roll")}
${block("fall_back")}
${block("boot")}
${block("roll_to")}
`
const sup = async (body: string, at: string, d = dashboardDir) => {
  git(wt, "reset", "-q", "--hard", at)
  const proc = Bun.spawn(["bash", "-c", `D=${d}\n${stubs}\n${body}`], { cwd: wt, stdout: "pipe" })
  const code = await proc.exited
  return { code, out: (await new Response(proc.stdout).text()).trim() }
}
const reloadFile = () => Bun.file(join(state, "reload"))
const origin = join(scratch, "origin.git")
const canaryAt = (sha: string) => {
  Bun.spawnSync(["git", "init", "-q", "--bare", origin])
  git(wt, "remote", "add", "origin", origin)
  git(wt, "push", "-q", "-f", origin, `${sha}:refs/heads/canary`)
}
const clean = () => rmSync(join(state, "reload"), { force: true })

describe("the supervisor's reload (#1330)", () => {
  test("goes on as today when the roll left scripts/ops/dashboard/ alone", async () => {
    clean()
    expect((await sup(`reload_if ${c1} "ROLL canary"`, c2)).code).toBe(0)
    expect(await reloadFile().exists()).toBe(false)
  })

  test("hands the roll on with 75 when the roll changed scripts/ops/dashboard/", async () => {
    clean()
    expect(
      (await sup(`reload_if ${c0} "ROLL canary (install )" ${c2} ${c0} migrate`, c2)).code,
    ).toBe(75)
    expect(await reloadFile().text()).toBe(`${c2}\nROLL canary (install )\n${c2}\n${c0}\nmigrate\n`)
  })

  test("hands on once from a copy outside the checkout, as ops-dashboard's first start from the main checkout does", async () => {
    clean()
    const outside = join(scratch, "main-copy")
    await Bun.write(join(outside, ".keep"), "")
    expect((await sup(`reload_if ${c2} START`, c2, outside)).code).toBe(75)
    expect(await reloadFile().text()).toBe(`${c2}\nSTART\n\n\n\n`)
  })

  test("reads the checkout's own copy through a symlink as itself, so it never reloads forever", async () => {
    clean()
    const link = join(scratch, "dashboard-link")
    symlinkSync(dashboardDir, link)
    expect((await sup(`reload_if ${c2} START`, c2, link)).code).toBe(0)
  })

  test("takes the handed-on roll once, and drops one written at another head", async () => {
    await Bun.write(join(state, "reload"), `${c2}\nROLL canary\n${c2}\n${c0}\n\n`)
    const taken = await sup(`take_reload && echo "$r_tag|$r_target|$r_prev|$r_mig"`, c2)
    expect(taken.out).toBe(`ROLL canary|${c2}|${c0}|`)
    expect(await reloadFile().exists()).toBe(false)
    await Bun.write(join(state, "reload"), `${c0}\nROLL canary\n${c2}\n${c0}\n\n`)
    expect((await sup("take_reload", c2)).code).toBe(1)
    expect(await reloadFile().exists()).toBe(false)
  })

  test("a failed roll lists its head in bad-builds, falls back and hands the fallback on; the next start stays on the head before", async () => {
    clean()
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    // the supervisor the roll reloaded into runs c1's code, fails, and falls back to c0, whose scripts/ops/dashboard/ differs
    expect((await sup(`finish_roll "ROLL canary" ${c1} ${c0} ""`, c1)).code).toBe(75)
    expect(await Bun.file(join(state, "bad-builds")).text()).toBe(`${c1}\n`)
    expect(git(wt, "rev-parse", "HEAD")).toBe(c0)
    expect(await reloadFile().text()).toBe(`${c0}\nFALLBACK\n${c1}\n${c0}\n\n`)
    // c0's supervisor goes on with the fallback, on c0
    const back = await sup(`boot; git rev-parse HEAD`, c0)
    expect(back.out).toBe(c0)
    expect(await Bun.file(calls).text()).toBe(
      `roll_up ROLL canary\nroll_up FALLBACK\ntell Dashboard roll to ${c1.slice(0, 7)} FAILED; fell back to ${c0.slice(0, 7)}\n`,
    )
  })

  test("a start from a copy outside the checkout hands a pending roll on again, untouched, rather than finishing it on the outside code", async () => {
    rmSync(calls, { force: true })
    const pending = `${c2}\nROLL canary\n${c2}\n${c0}\n\n`
    await Bun.write(join(state, "reload"), pending)
    const outside = join(scratch, "main-copy")
    await Bun.write(join(outside, ".keep"), "")
    expect((await sup("boot", c2, outside)).code).toBe(75)
    expect(await reloadFile().text()).toBe(pending)
    expect(await Bun.file(calls).exists()).toBe(false)
  })

  test("a start that takes a handed-on roll finishes it once, and leaves a roll that failed after a migration on its head with no fallback", async () => {
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    await Bun.write(join(state, "reload"), `${c2}\nROLL canary\n${c2}\n${c1}\n\n`)
    const passing = `roll_up() { echo "roll_up $1" >> ${calls}; }`
    expect(await sup(`${passing}; boot; git rev-parse HEAD`, c2)).toEqual({ code: 0, out: c2 })
    expect(await Bun.file(calls).text()).toBe("roll_up ROLL canary\n")
    expect(await reloadFile().exists()).toBe(false)
    rmSync(calls, { force: true })
    await Bun.write(join(state, "reload"), `${c2}\nROLL canary\n${c2}\n${c1}\nmigrate\n`)
    expect(await sup("boot; git rev-parse HEAD", c2)).toEqual({ code: 0, out: c2 })
    expect(await Bun.file(calls).text()).toBe(
      `roll_up ROLL canary\ntell Dashboard roll to ${c2.slice(0, 7)} FAILED after a migration; left on it for ops (see ops/dashboard/supervisor.log)\n`,
    )
    expect(await Bun.file(join(state, "bad-builds")).exists()).toBe(false)
    expect(await reloadFile().exists()).toBe(false)
  })

  test("a start with no handed-on roll keeps off canary's head while bad-builds lists it, as a supervisor from before #1330 does", async () => {
    clean()
    rmSync(calls, { force: true })
    await Bun.write(join(state, "bad-builds"), `${c1}\n`)
    canaryAt(c1)
    const started = await sup(`boot; git rev-parse HEAD`, c0)
    expect(started.out).toBe(c0)
    expect(await Bun.file(calls).text()).toBe("roll_up START\n")
  })

  test("a start whose upstream head is behind the running head holds there, with no pull and no bad-builds entry, as main behind a checkout rolled on canary", async () => {
    clean()
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    canaryAt(c1)
    const started = await sup(`say() { echo "say $*" >> ${calls}; }; boot; git rev-parse HEAD`, c2)
    expect(started.out).toBe(c2)
    expect(await Bun.file(calls).text()).toBe(
      `say canary ${c1.slice(0, 7)} is behind the running head ${c2.slice(0, 7)}; waiting\nroll_up START\n`,
    )
    expect(await Bun.file(join(state, "bad-builds")).exists()).toBe(false)
  })

  test("a roll from the loop hands on with 75 when it changed scripts/ops/dashboard/, before it starts the new head, and finishes in place when it did not", async () => {
    clean()
    rmSync(calls, { force: true })
    expect((await sup(`running=${c0}; roll_to ${c1} canary`, c0)).code).toBe(75)
    expect(await reloadFile().text()).toBe(`${c1}\nROLL canary\n${c1}\n${c0}\n\n`)
    expect(await Bun.file(calls).exists()).toBe(false)
    clean()
    const rolled = await sup(
      `roll_up() { echo "roll_up $1" >> ${calls}; }; running=${c1}; roll_to ${c2} canary; echo "$running"`,
      c1,
    )
    expect(rolled).toEqual({ code: 0, out: c2 })
    expect(await reloadFile().exists()).toBe(false)
    expect(await Bun.file(calls).text()).toBe("roll_up ROLL canary\n")
  })

  test("a roll whose pull fails skips starting the head, lists it in bad-builds and falls back (#1392)", async () => {
    clean()
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    await Bun.write(pullFails, `${c2}\nbuild\n`)
    const passing = `roll_up() { echo "roll_up $1" >> ${calls}; }`
    const rolled = await sup(`${passing}; running=${c1}; roll_to ${c2} canary; echo "$running"`, c1)
    rmSync(pullFails, { force: true })
    expect(rolled).toEqual({ code: 0, out: c1 })
    expect(await Bun.file(join(state, "bad-builds")).text()).toBe(`${c2}\n`)
    expect(await Bun.file(calls).text()).toBe(
      `result ROLL canary (build ) ${c2.slice(0, 7)} FAIL pull exited 1\nroll_up FALLBACK\ntell Dashboard roll to ${c2.slice(0, 7)} FAILED; fell back to ${c1.slice(0, 7)}\n`,
    )
  })

  test("a roll whose pull prints migrate hands it on as the reload's fifth line (#1366)", async () => {
    clean()
    rmSync(calls, { force: true })
    await Bun.write(pullPrints, `${c1}\nmigrate\n`)
    expect((await sup(`running=${c0}; roll_to ${c1} canary`, c0)).code).toBe(75)
    rmSync(pullPrints, { force: true })
    expect(await reloadFile().text()).toBe(`${c1}\nROLL canary (migrate )\n${c1}\n${c0}\nmigrate\n`)
  })

  test("a roll whose pull fails after a migration stays on its head and falls back to nothing (#1392)", async () => {
    clean()
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    await Bun.write(pullFails, `${c2}\nmigrate\n`)
    const passing = `roll_up() { echo "roll_up $1" >> ${calls}; }`
    const rolled = await sup(`${passing}; running=${c1}; roll_to ${c2} canary; echo "$running"`, c1)
    rmSync(pullFails, { force: true })
    expect(rolled).toEqual({ code: 0, out: c2 })
    expect(await Bun.file(join(state, "bad-builds")).exists()).toBe(false)
    expect(await Bun.file(calls).text()).toBe(
      `result ROLL canary (migrate ) ${c2.slice(0, 7)} FAIL pull exited 1\ntell Dashboard roll to ${c2.slice(0, 7)} FAILED after a migration; left on it for ops (see ops/dashboard/supervisor.log)\n`,
    )
  })

  test("a roll whose pull fails before its reset reports it, restarts the head it was on, and leaves bad-builds alone even when that restart fails, so the next roll tries again (#1392)", async () => {
    const anomaly = `result ANOMALY pull to ${c2.slice(0, 7)} failed before it moved (exit 128); staying on ${c1.slice(0, 7)}\n`
    for (const [roll, restart] of [
      [`roll_up() { echo "roll_up $1" >> ${calls}; }`, "passing"],
      [":", "failing"],
    ]) {
      clean()
      rmSync(calls, { force: true })
      rmSync(join(state, "bad-builds"), { force: true })
      await Bun.write(pullStops, c2)
      const rolled = await sup(`${roll}; running=${c1}; roll_to ${c2} canary; echo "$running"`, c1)
      rmSync(pullStops, { force: true })
      expect({ restart, ...rolled }).toEqual({ restart, code: 0, out: c1 })
      expect(await Bun.file(join(state, "bad-builds")).exists()).toBe(false)
      expect(await Bun.file(calls).text()).toBe(`${anomaly}roll_up RESTART\n`)
    }
  })

  test("a roll whose pull fails on a head that changed scripts/ops/dashboard/ falls back on the running code, with no reload (#1392)", async () => {
    clean()
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    await Bun.write(pullFails, `${c1}\nbuild\n`)
    const rolled = await sup(`running=${c0}; roll_to ${c1} canary; echo "$running"`, c0)
    rmSync(pullFails, { force: true })
    expect(rolled).toEqual({ code: 0, out: c0 })
    expect(await reloadFile().exists()).toBe(false)
    expect(await Bun.file(join(state, "bad-builds")).text()).toBe(`${c1}\n`)
    expect(await Bun.file(calls).text()).toBe(
      `result ROLL canary (build ) ${c1.slice(0, 7)} FAIL pull exited 1\nroll_up FALLBACK\ntell Dashboard roll to ${c1.slice(0, 7)} FAILED; fell back to ${c0.slice(0, 7)}\n`,
    )
  })

  test("a start that pulls canary's head lists it in bad-builds and falls back when the pull fails after its reset, and starts again when it fails before (#1392)", async () => {
    clean()
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    canaryAt(c2)
    await Bun.write(pullFails, `${c2}\nbuild\n`)
    const failed = await sup(`boot; git rev-parse HEAD`, c1)
    rmSync(pullFails, { force: true })
    expect(failed).toEqual({ code: 0, out: c1 })
    expect(await Bun.file(join(state, "bad-builds")).text()).toBe(`${c2}\n`)
    expect(await Bun.file(calls).text()).toBe(
      `result START ${c2.slice(0, 7)} FAIL pull exited 1\nroll_up FALLBACK\ntell Dashboard roll to ${c2.slice(0, 7)} FAILED; fell back to ${c1.slice(0, 7)}\n`,
    )
    rmSync(calls, { force: true })
    rmSync(join(state, "bad-builds"), { force: true })
    await Bun.write(pullStops, c2)
    const stopped = await sup(`boot; git rev-parse HEAD`, c1)
    rmSync(pullStops, { force: true })
    expect(stopped).toEqual({ code: 0, out: c1 })
    expect(await Bun.file(join(state, "bad-builds")).exists()).toBe(false)
    expect(await Bun.file(calls).text()).toBe(
      `result ANOMALY pull to ${c2.slice(0, 7)} failed before it moved (exit 128); staying on ${c1.slice(0, 7)}\nroll_up START\n`,
    )
  })

  test("boots once it is armed", () => {
    expect(script).toContain('say "supervisor armed at $(git rev-parse --short HEAD)"\nboot\n')
  })
})

// A roll that dev refused to start, its dev log as roll_up left it, fails over from c2 to c1; returns the rolled head and the files the roll touched
describe("the supervisor's refused roll (#1357)", () => {
  const devlog = join(state, "dev.log")
  const bad = join(state, "bad-builds")
  const refusedLog = join(state, "refused")
  const refusing = (reason: string) =>
    `$ bun run dev --ui stream\ndev: cmux would not answer this stack (Error: ERROR: Access denied)\ndev: refusing to start: ${reason}\nerror: script "dev" exited with code 1\n`
  const fresh = () => {
    clean()
    for (const path of [bad, calls, devlog, refusedLog]) rmSync(path, { force: true })
  }
  const roll = async (log: string, mig = "") => {
    rmSync(calls, { force: true })
    await Bun.write(devlog, log)
    const rolled = await sup(
      `finish_roll "ROLL canary" ${c2} ${c1} "${mig}"; git rev-parse HEAD`,
      c2,
    )
    const listed = await Bun.file(bad)
      .text()
      .catch(() => "")
    return { ...rolled, bad: listed, calls: await Bun.file(calls).text() }
  }
  const own = "the API's settings could not be read: BETTER_AUTH_SECRET is required"
  const sha = c2.slice(0, 7)

  test("falls back to the head before, with a result line of its own and a tell that says a refusal is no bad build", async () => {
    fresh()
    const rolled = await roll(refusing(own))
    expect(rolled.out).toBe(c1)
    expect(rolled.bad).toBe("")
    expect(rolled.calls).toBe(
      `roll_up ROLL canary\nresult ROLL canary ${sha} FAIL dev refusing: ${own} (refusal 1 of 3, no bad build)\nroll_up FALLBACK\ntell Dashboard roll to ${sha} refused to start, which is no bad build; fell back to ${c1.slice(0, 7)}\n`,
    )
  })

  test("lists the head in bad-builds on its third refusal, counted by head in the state folder, so a refusal the head causes stops retrying", async () => {
    fresh()
    await Bun.write(refusedLog, `${c1}\n${c1}\n`)
    expect((await roll(refusing(own))).bad).toBe("")
    expect((await roll(refusing(own))).bad).toBe("")
    const third = await roll(refusing(own))
    expect(third.bad).toBe(`${c2}\n`)
    expect(third.calls).toContain(
      `result ROLL canary ${sha} FAIL dev refusing: ${own} (refusal 3 of 3, so it joins bad-builds)\n`,
    )
    expect(third.calls).toContain(
      `tell Dashboard roll to ${sha} FAILED; fell back to ${c1.slice(0, 7)}\n`,
    )
  })

  test("never counts a refusal of the machine's or the checkout's, so a fourth roll after those still runs and none joins bad-builds", async () => {
    const machine = [
      "this process does not descend from a cmux terminal, so cmux would refuse the stack's API every read (turbo passes it no capability token)",
      "the database at 127.0.0.1:55432 did not answer: connect ECONNREFUSED",
      "a stack already runs in this checkout (pid 4242); stop it from the terminal or task that started it, or with `bun run dev:stop`",
      "another start claimed /x/.dev-record at the same moment; try again",
      "portless's proxy is not running, and starting it on port 443 needs sudo, which a stack cannot ask for",
    ]
    fresh()
    for (const reason of machine) {
      for (let i = 0; i < 4; i++) {
        const rolled = await roll(refusing(reason))
        expect({ reason, bad: rolled.bad, out: rolled.out }).toEqual({ reason, bad: "", out: c1 })
        expect(rolled.calls).toContain(
          `result ROLL canary ${sha} FAIL dev refusing: ${reason} (not the head's, no bad build)\n`,
        )
      }
    }
    expect(await Bun.file(refusedLog).exists()).toBe(false)
  })

  test("counts only the refusal whose message opens, in launch.ts, with the supervisor's counted prefix, so a rewording there goes red", async () => {
    const prefix = script.match(/grep -q "\^([^"]+)"; then/)?.[1]
    if (!prefix) throw new Error("finish_roll's counted refusal prefix is gone from supervisor.sh")
    expect(prefix).toBe("the API's settings could not be read")
    const launch = await Bun.file(
      join(root, "api", "hono", "src", "lib", "dev", "launch.ts"),
    ).text()
    expect(launch).toContain(`refuse(\`${prefix}: `)
  })

  test("leaves a refusal after a migration on its head for ops, with no fallback and nothing counted", async () => {
    fresh()
    const rolled = await roll(refusing(own), "migrate")
    expect(rolled.out).toBe(c2)
    expect(rolled.bad).toBe("")
    expect(rolled.calls).toBe(
      `roll_up ROLL canary\ntell Dashboard roll to ${sha} FAILED after a migration; left on it for ops (see ops/dashboard/supervisor.log)\n`,
    )
    expect(await Bun.file(refusedLog).exists()).toBe(false)
  })

  test("still lists a head in bad-builds when dev died of a port in use, an ERROR or a SyntaxError, or its pull failed over an old refusal", async () => {
    for (const line of [
      "@api/hono:dev: listen EADDRINUSE: address already in use 127.0.0.1:4000",
      "@web/next:dev: ERROR run failed",
      "@api/hono:dev: SyntaxError: Export named 'factoryRoleOf' not found",
    ]) {
      fresh()
      const rolled = await roll(
        `$ bun run dev --ui stream\n${line}\ndev: refusing to start: ${own}\n`,
      )
      expect({ line, bad: rolled.bad }).toEqual({ line, bad: `${c2}\n` })
      expect(rolled.calls).not.toContain("dev refusing")
    }
    fresh()
    await Bun.write(devlog, refusing(own))
    await Bun.write(pullFails, `${c2}\nbuild\n`)
    const pulled = await sup(`running=${c1}; roll_to ${c2} canary; echo "$running"`, c1)
    rmSync(pullFails, { force: true })
    expect(pulled.out).toBe(c1)
    expect(await Bun.file(bad).text()).toBe(`${c2}\n`)
  })
})

describe("the supervisor's dev=DOWN reason (#1393)", () => {
  const devlog = join(scratch, "dev.log")
  const reason = async (line: string, before = "") => {
    await Bun.write(
      devlog,
      `$ bun run dev --ui stream\n${before}@web/next:dev: ready\n${line}\nexit 1\n`,
    )
    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `DEVLOG=${devlog}\nwait_dashboard() { :; }; alive() { return 1; }\n${block("dev_reason")}\n${block("check_dev")}\ncheck_dev`,
      ],
      { stdout: "pipe" },
    )
    expect(await proc.exited).toBe(1)
    return (await new Response(proc.stdout).text()).trim()
  }

  test("names a SyntaxError, as a stale dist throws", async () => {
    const line = `@api/hono:dev: SyntaxError: Export named 'factoryRoleOf' not found in module '/Users/someone/code/dispatcher/.claude/worktrees/live-dashboard/packages/config/dist/kinds.mjs'.`
    expect(await reason(line)).toBe(`dev=DOWN (${line.slice(0, 140)})`)
  })

  test("passes over the launcher's own notes, as cmux's refusal that names an ERROR, to the line that stopped the stack", async () => {
    const note =
      "dev: cmux would not answer this stack (Error: ERROR: Access denied) and holds no live factory session, so the dashboard reads herdr alone\n"
    const line = "@api/hono:dev: SyntaxError: Export named 'factoryRoleOf' not found"
    expect(await reason(line, note)).toBe(`dev=DOWN (${line})`)
  })

  test("names a line holding error:", async () => {
    const line = "@api/hono:dev: error: Cannot find module '@packages/env'"
    expect(await reason(line)).toBe(`dev=DOWN (${line})`)
  })

  test("still names a refusal, a port in use and an ERROR line", async () => {
    for (const line of [
      "dev: refusing to start: another stack holds this checkout",
      "@api/hono:dev: listen EADDRINUSE: address already in use 127.0.0.1:4000",
      "@web/next:dev: ERROR run failed",
    ])
      expect(await reason(line)).toBe(`dev=DOWN (${line})`)
  })
})

// The loop's own DOWN dev line: the echoed bun command spent its cut before the refusal showed, so the reason never reached ops-dashboard.jsonl.
describe("the loop's DOWN dev reason (#1356)", () => {
  const devlog = join(scratch, "dev-down.log")
  const down = async (devlogBody: string) => {
    await Bun.write(devlog, devlogBody)
    const inner = script.match(/result "DOWN dev: \$\(([^\n]+)\)"/)?.[1]
    if (!inner) throw new Error("the loop's DOWN dev line is gone from supervisor.sh")
    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `DEVLOG=${devlog}\n${block("dev_reason")}\n${block("dev_down")}\ndown=$(${inner})\nprintf '%s' "$down"`,
      ],
      { stdout: "pipe" },
    )
    expect(await proc.exited).toBe(0)
    return await new Response(proc.stdout).text()
  }
  const echo =
    "$ bun --no-env-file api/hono/src/bin/dev-running.ts start && bun --no-env-file packages/scripts/src/verify/prebuild.ts api && bun --no-env-file api/hono/src/bin/dev.ts --ui stream"
  const bunLine = 'error: script "dev" exited with code 1'

  test("keeps the refusal whole, past the echoed command and bun's own exit line", async () => {
    const refusal =
      "dev: refusing to start: this process does not descend from a cmux terminal, so cmux would refuse the stack's API every read (turbo passes it)"
    expect(await down(`${echo}\n@web/next:dev: ready\n${refusal}\n${bunLine}\n`)).toBe(refusal)
  })

  test("names a crash that is no refusal, past bun's own exit line", async () => {
    const crash =
      "@api/hono:dev: TypeError: Cannot read properties of undefined (reading 'factoryRoleOf')"
    expect(await down(`${echo}\n${crash}\n${bunLine}\n`)).toBe(crash)
  })

  test("names nothing on an empty log", async () => {
    expect(await down("")).toBe("")
  })

  test("names nothing on a missing log", async () => {
    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `DEVLOG=${join(scratch, "absent-dev.log")}\n${block("dev_reason")}\n${block("dev_down")}\nprintf '%s' "$(dev_down)"`,
      ],
      { stdout: "pipe" },
    )
    expect(await proc.exited).toBe(0)
    expect(await new Response(proc.stdout).text()).toBe("")
  })
})

// verify_dashboard with stand-ins for bun and git, run in a checkout whose .env holds the given AGENT_SIGNIN_ENABLED line: the checks it runs, in order
const verifyChecks = async (signIn: string) => {
  const dir = join(scratch, `verify-${signIn || "blank"}`)
  const calls = join(dir, "calls")
  await Bun.write(join(dir, ".env"), `NODE_ENV=local\nAGENT_SIGNIN_ENABLED=${signIn}\n`)
  await Bun.write(join(dir, "bin", "bun"), `#!/bin/sh\necho "$3" >> ${calls}\n`)
  await Bun.write(join(dir, "bin", "git"), "#!/bin/sh\necho abc123\n")
  chmodSync(join(dir, "bin", "bun"), 0o755)
  chmodSync(join(dir, "bin", "git"), 0o755)
  const body = `dashboard_urls() { WEB=https://web.test API=https://api.test; }\n${block("verify_dashboard")}\nverify_dashboard`
  const proc = Bun.spawn(["bash", "-c", body], {
    cwd: dir,
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` },
  })
  expect(await proc.exited).toBe(0)
  return (await Bun.file(calls).text()).trim().split("\n")
}

describe("the supervisor's verify", () => {
  test("leaves out the signed-in checks on a checkout with agent sign-in off, as a person's .env starts it", async () => {
    expect(await verifyChecks("")).toEqual(["health", "map"])
  })

  test("runs every check where agent sign-in is on", async () => {
    expect(await verifyChecks("true")).toEqual(["health", "signin", "ws", "system", "map"])
  })
})

// upstream_head as the supervisor runs it, in a clone of an origin whose main and canary hold different heads
describe("the supervisor's roll target", () => {
  test("is the head of the branch upstream.sh names on origin, never canary's alone", async () => {
    const origin = join(scratch, "roll-origin")
    git(scratch, "init", "-q", "-b", "main", origin)
    git(origin, "commit", "-q", "--allow-empty", "-m", "main")
    git(origin, "checkout", "-q", "-b", "canary")
    git(origin, "commit", "-q", "--allow-empty", "-m", "canary")
    const head = (ref: string) => git(origin, "rev-parse", ref)
    const clone = join(scratch, "roll-clone")
    git(scratch, "clone", "-q", origin, clone)
    expect(script).not.toContain("refs/heads/canary")
    for (const branch of ["main", "canary"]) {
      const proc = Bun.spawn(
        [
          "bash",
          "-c",
          `D=${join(root, "scripts", "ops", "dashboard")} LOG=${join(scratch, "roll.log")} UPSTREAM=${branch}\n${fn("upstream_head")}\nupstream_head`,
        ],
        {
          cwd: clone,
          stdout: "pipe",
        },
      )
      expect(await proc.exited).toBe(0)
      expect((await new Response(proc.stdout).text()).trim()).toBe(head(branch))
    }
  })

  test("is empty within the limit when git never answers, the line logged and the hung git stopped by its own process group", async () => {
    const dir = join(scratch, "hung-git")
    const pid = join(dir, "pid")
    await Bun.write(join(dir, "bin", "git"), `#!/bin/sh\necho $$ > ${pid}\nsleep 600\n`)
    chmodSync(join(dir, "bin", "git"), 0o755)
    const log = join(dir, "supervisor.log")
    const started = Date.now()
    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `D=${join(root, "scripts", "ops", "dashboard")} LOG=${log} UPSTREAM=main\n${fn("upstream_head")}\nupstream_head`,
      ],
      {
        env: {
          ...process.env,
          NET_GIT_LIMIT: "1",
          PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        },
        stdout: "pipe",
      },
    )
    expect(await proc.exited).toBe(0)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect((await new Response(proc.stdout).text()).trim()).toBe("")
    expect(await Bun.file(log).text()).toBe(
      "net-git: git ls-remote gave no answer in 1s, so it was stopped\n",
    )
    const stub = Number((await Bun.file(pid).text()).trim())
    expect(() => process.kill(stub, 0)).toThrow()
  }, 15_000)
})

// First run's setup writes POSTGRES_URL into the checkout's .env; until then the follower, which validates it at once, would exit on every tick (#31).
describe("the follower before first run's setup (#31)", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "supervisor-setup-")))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const calls = join(dir, "calls")
  const env = join(dir, ".env")
  const loop = script.slice(
    script.indexOf("  if ! alive dashboard-dev; then\n"),
    script.indexOf("\ndone\n", script.indexOf("  if ! alive dashboard-dev; then\n")),
  )
  const stubs = `WT=${dir} S=${dir}
say() { echo "say $*" >> ${calls}; }; result() { echo "result $*" >> ${calls}; }
start_dev() { :; }; check_dev() { echo dev=up; }; stop_all() { :; }; dev_down() { :; }
start_follower() { echo start_follower >> ${calls}; }; check_follower() { echo follower=running; }
follower_held() { return 1; }; alive() { [ "$1" = dashboard-dev ]; }
${fn("setup_pending") ?? ""}
${script.slice(script.indexOf("\nroll_up() {") + 1, script.indexOf("\n}\n", script.indexOf("\nroll_up() {")) + 2)}
`
  const sup = async (body: string, dotenv: string) => {
    rmSync(calls, { force: true })
    await Bun.write(env, dotenv)
    const { POSTGRES_URL: _, ...rest } = process.env
    const proc = Bun.spawn(["bash", "-c", `${stubs}\n${body}`], {
      cwd: wt,
      env: rest,
      stdout: "pipe",
    })
    expect(await proc.exited).toBe(0)
    return (
      await Bun.file(calls)
        .text()
        .catch(() => "")
    )
      .trim()
      .split("\n")
  }
  const URL_LINE = "POSTGRES_URL=postgresql://postgres:pw@127.0.0.1:1/playground\n"

  test("a roll leaves the follower stopped and passes, saying it waits, while the .env names no POSTGRES_URL", async () => {
    const lines = await sup("roll_up START", 'NODE_ENV=local\nPOSTGRES_URL=""\n')
    expect(lines).not.toContain("start_follower")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^say follower: waiting for first run's setup/)
    expect(lines[1]).toMatch(
      /^result START \w+ PASS dev=up follower=waiting for first run's setup$/,
    )
  })

  test("the loop waits with one line and no DOWN or FAIL, then starts the follower on the first tick after setup writes the URL", async () => {
    const lines = await sup(
      `for tick in 1 2 3 4; do\n[ $tick = 3 ] && echo "${URL_LINE.trim()}" >> ${env}\n[ $tick = 4 ] && alive() { :; }\n${loop}\ndone`,
      "NODE_ENV=local\n",
    )
    expect(lines.filter((line) => /DOWN|FAIL/.test(line))).toEqual([])
    expect(lines).toEqual([
      expect.stringMatching(/^say follower: waiting for first run's setup/),
      "say follower: first run's setup wrote POSTGRES_URL; starting it",
      "start_follower",
      "result START follower follower=running",
    ])
  })

  test("with POSTGRES_URL set, a roll starts the follower as before", async () => {
    const lines = await sup("roll_up START", URL_LINE)
    expect(lines[0]).toBe("start_follower")
    expect(lines[1]).toMatch(/^result START \w+ PASS dev=up follower=running$/)
  })
})
