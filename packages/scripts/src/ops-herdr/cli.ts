import { closeSync, openSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"
import {
  attachPlan,
  basicEnv,
  CONFIG_SOURCE,
  dataFolder,
  DEFAULT_SERVER,
  envReport,
  type Found,
  herdrDir,
  owedFile,
  pinFor,
  pinProblem,
  restoreEnv,
  restoreProblem,
  runJob,
  serverEnv,
  serverNames,
  serverStatusLines,
  startOnce,
  stopRefusal,
} from "./herdr"

// bun run ops:herdr [run]: the job, which starts each herdr session that is down, runs spawn.sh restore for each server it has started, and beats every minute; start: the same once, for `bun run dev` and the dispatcher, naming each server it started; status: one line a server, for playground status; stop <session>: a stop, refused while a pane is live, and stop default: herdr's own default server, refused while a pane runs an agent; attach <session>: a client on the pinned binary and config, for playground view; env-check: run inside a pane, names and lengths only.
const env = process.env
const dir = herdrDir(env)
const pin = pinFor(env)
const { sessions, skipped } = serverNames(env)
const [command = "run", arg] = process.argv.slice(2)

// Each call is a short request to a server's socket, so a server that stops answering costs a check 10s, never the job.
const herdr = (session: string, args: string[]) =>
  Bun.spawnSync([pin.path, ...args], {
    env: session === DEFAULT_SERVER ? basicEnv(env) : serverEnv(env, dir, session),
    stdin: "ignore",
    timeout: 10_000,
  })

// A server's `pane list` answer, or null when it does not read, which statusLine and stopRefusal name.
const paneList = (session: string): unknown => {
  try {
    return JSON.parse(herdr(session, ["pane", "list"]).stdout.toString())
  } catch {
    return null
  }
}

const found = async (): Promise<Found | null> => {
  const file = Bun.file(pin.path)
  if (!(await file.exists())) return null
  const sha256 = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex")
  let version = "unknown"
  try {
    const out = Bun.spawnSync([pin.path, "--version"], {
      env: {},
      stdin: "ignore",
      timeout: 10_000,
    })
    version = /^herdr (\S+)/.exec(out.stdout.toString())?.[1] ?? version
  } catch {
    // a file that cannot run reads as unknown, which the pin names
  }
  return { sha256, version }
}

const running = async (session: string): Promise<boolean> => {
  const out = herdr(session, ["status", "server", "--json"])
  try {
    return (JSON.parse(out.stdout.toString()) as { running?: unknown }).running === true
  } catch {
    return false
  }
}

// Started through a shell that backgrounds it and exits, in a session of its own, so the server is launchd's child and not the job's: stopping the job (TaskStop ends its whole process tree, measured) leaves it running; herdr ignores SIGHUP.
const start = async (session: string): Promise<string | null> => {
  await mkdir(dir, { recursive: true })
  const out = openSync(join(dir, `${session}.out`), "a", 0o600)
  Bun.spawn(["/bin/sh", "-c", '"$0" server </dev/null &', pin.path], {
    cwd: homedir(),
    detached: true,
    env: serverEnv(env, dir, session),
    stdio: ["ignore", out, out],
  }).unref()
  closeSync(out)
  for (let i = 0; i < 50; i++) {
    if (await running(session)) return null
    await Bun.sleep(200)
  }
  return "started, but its status did not read running within 10s"
}

const log = async (session: string): Promise<string | null> => {
  const file = Bun.file(join(homedir(), ".config/herdr/sessions", session, "herdr-server.log"))
  return (await file.exists()) ? file.slice(-262_144).text() : null
}

// The PR-owned pin and config, copied into the herdr folder: the config for the servers, the pin for the scripts that open herdr panes, as this Mac's release asset reads it; the job itself runs that same pin. A changed config reaches a running server through reload-config, with no stop, and only on the pinned binary, so on any other it waits uncopied until the pin passes.
const install = async (pinned: boolean) => {
  const pinText = `${JSON.stringify(pin, null, 2)}\n`
  const pinFile = Bun.file(join(dir, "pin.json"))
  if (!(await pinFile.exists()) || (await pinFile.text()) !== pinText) {
    await writeAtomic(join(dir, "pin.json"), pinText)
  }
  const configFile = Bun.file(join(dir, "config.toml"))
  if (!pinned || ((await configFile.exists()) && (await configFile.text()) === CONFIG_SOURCE))
    return
  await writeAtomic(join(dir, "config.toml"), CONFIG_SOURCE)
  for (const session of sessions) {
    if (await running(session)) herdr(session, ["server", "reload-config"])
  }
}

// herdr's own resume is off in the config, since it runs a bare claude --resume without the session's settings, so spawn.sh restore brings each of a server's sessions back through its resume record, the gate judging each; its lines go to the job's log.
const restore = async (session: string): Promise<string | null> => {
  const proc = Bun.spawn(
    ["bash", join(import.meta.dir, "../../../../scripts/spawn.sh"), "restore"],
    {
      env: restoreEnv(env, dir, session),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    },
  )
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const output = `${out}${err}`
  for (const line of output.split("\n").filter(Boolean)) console.log(`restore ${session}: ${line}`)
  return restoreProblem(code, output)
}

const deps = {
  found,
  log,
  owed: (session: string) => owedFile(dir, session),
  pin,
  restore,
  running,
  sessions,
  skipped,
  start,
}

const installChecked = async () =>
  install(pinProblem(pin, await found().catch(() => null)) === null)

if (command === "env-check") {
  const report = envReport(env)
  for (const line of report.lines) console.log(line)
  if (report.forbidden.length > 0) {
    console.error(`env-check: forbidden: ${report.forbidden.join(", ")}`)
    process.exit(1)
  }
  console.log("env-check: no CLAUDE_CODE_* or CMUX_* name")
  process.exit(0)
}

if (command === "attach") {
  const known = arg !== undefined && sessions.includes(arg)
  const plan = attachPlan(
    env,
    dir,
    arg ?? "",
    sessions,
    pin,
    known ? await found().catch(() => null) : null,
    known && (await running(arg).catch(() => false)),
  )
  if ("error" in plan) {
    console.error(`ops-herdr: ${plan.error}`)
    process.exit(1)
  }
  const client = Bun.spawn(plan.argv, { env: plan.env, stdio: ["inherit", "inherit", "inherit"] })
  process.exit(await client.exited)
}

if (command === "status") {
  for (const line of await serverStatusLines(sessions, running, paneList)) console.log(line)
  process.exit(0)
}

if (command === "stop") {
  const known = [...sessions, DEFAULT_SERVER]
  if (!arg || !known.includes(arg)) {
    console.error(`ops-herdr: stop takes one of ${known.join(", ")}`)
    process.exit(1)
  }
  const refusal = stopRefusal(arg, paneList(arg))
  if (refusal) {
    console.error(`ops-herdr: ${refusal}`)
    process.exit(1)
  }
  const stop = herdr(arg, ["server", "stop"])
  process.stdout.write(stop.stdout)
  process.exit(stop.exitCode)
}

if (command === "start") {
  await installChecked()
  const { lines, ok } = await startOnce(deps)
  for (const line of lines) console.log(`ops-herdr: ${line}`)
  process.exit(ok ? 0 : 1)
}

if (command !== "run") {
  console.error(`ops-herdr: unknown command ${command}`)
  process.exit(1)
}

await installChecked()
runJob(deps, join(dataFolder(env), "ops", "ops-herdr.json"))
