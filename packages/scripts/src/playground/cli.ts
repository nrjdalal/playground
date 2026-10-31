#!/usr/bin/env -S bun --no-env-file
import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { getSessionNames, type NamedKind, setSessionNames } from "@packages/config/kinds"
import { configDirOf, dataDir } from "@packages/env/data-dir"
import { modelSettings, readPolicyOrDefaults, readSessionNames } from "@packages/settings"

import { accountsIo, runAccounts } from "./accounts"
import { doctor, report } from "./doctor"
import { pinHere } from "./herdr-pin"
import { orgsCommand, orgsIo } from "./orgs"
import { keepPage, pageArgs } from "./page"
import {
  addCommand,
  extraWordRefusal,
  HELP,
  leftLines,
  planStart,
  rollOutcome,
  runStart,
  runStatus,
  statusLines,
  VIEW_HINT,
  VERBS,
  verbArgv,
  VIEW_SERVER,
  waitOutcome,
  wantsHelp,
} from "./plan"
import {
  apiUp,
  dashboardBeat,
  cutDashboardCheckout,
  dashboardCheckout,
  dashboardUrls,
  homeDataDir,
  linesSince,
  liveSessions,
  NO_CHECKOUT,
  opsDashboard,
  probe,
  supervisorRunning,
} from "./probe"
import { runSpawn, startDispatcher } from "./spawn"
import { runStore } from "./store"
import { OUTSIDE_CMUX, startJobs, TERMINAL } from "./terminal"
import { askPurge, uninstall } from "./uninstall"
import { runUpdate, spawnRun } from "./update"
import { version } from "./version"

// The bin is linked into ~/.bun/bin, so the checkout is found from this file's real path.
const REPO = join(realpathSync(import.meta.path), "..", "..", "..", "..", "..")
const SPAWN = join(REPO, "scripts", "spawn.sh")
const OPS_HERDR = join(REPO, "packages", "scripts", "src", "ops-herdr", "cli.ts")
const HOME_DATA = homeDataDir()
const ROLL_MS = 30 * 60_000

const fail = (message: string, code = 1): never => {
  console.error(`playground: ${message}`)
  process.exit(code)
}
const pause = (ms: number) => Bun.sleep(ms)
const briefExists = (brief: string): boolean => existsSync(join(HOME_DATA, brief))

// The managers a playground verb starts: the named kinds, and the optimizer, whose name is its kind.
type ManagerVerb = NamedKind | "optimizer"

// playground dispatcher, planner, builder, ops or optimizer, and the bare start's dispatcher step: 0 started, 3 already running, 1 refused with spawn.sh's reason.
const manager = async (kind: ManagerVerb): Promise<{ code: number; message: string }> => {
  const name = kind === "optimizer" ? kind : getSessionNames().names[kind]
  const result = await startDispatcher({
    data: HOME_DATA,
    live: liveSessions((live) => live === name).map((d) => d.name),
    name,
    spawn: SPAWN,
    template: join(REPO, "scripts", "briefs", `${kind}.md`),
  })
  if (result.code === 0) console.log(result.message)
  else console.error(`playground: ${result.message}`)
  return result
}
// A fresh session name of a kind, from the factory's one name picker.
const pickName = (kind: string): string => {
  const picked = Bun.spawnSync(
    ["bun", join(REPO, "packages", "scripts", "src", "name", "index.ts"), kind],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  )
  const name = picked.stdout.toString().trim()
  return picked.exitCode === 0 && name
    ? name
    : fail(`bun run name ${kind} gave no name: ${picked.stderr.toString().trim()}`)
}

// ops-herdr's own CLI, which holds herdr's pin, config, servers and restore, run with no .env so a checkout's settings move none of them.
const opsHerdr = (args: string[]) =>
  Bun.spawn([process.execPath, "--no-env-file", OPS_HERDR, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
  })

// A step run to its end with its output kept: null when it exits 0, else its last line, from the stream it names its failures on first.
const stepFailed = async (argv: string[], first: "stderr" | "stdout"): Promise<string | null> => {
  const child = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const last = (text: string) => text.trim().split("\n").at(-1)
  const second = first === "stdout" ? stderr : stdout
  return code === 0
    ? null
    : last(first === "stdout" ? stdout : stderr) || last(second) || `${argv.at(-1)} exited ${code}`
}

// The files install's linking step puts in the state folder that a dispatcher's start reads: spawn.sh builds every session's settings from factory-settings.json, and the sessions it starts run heavy work through run-slot.sh and brief their workers from the templates.
const LINKED = ["factory-settings.json", "handoffs/new-worker.md", "ops/run-slot.sh"]

// playground dispatcher's setup, which install and the bare start give a machine and Start <dispatcher> on a fresh install has not: install's linking step when a file it links is missing, the pinned herdr installed as install.sh installs it, which downloads nothing when the copy is already pinned, then one pass of ops-herdr's start, which writes the pin and config and brings the servers up, since spawn.sh starts none; null once each is in place, else the line that says why not.
const setUp = async (): Promise<string | null> => {
  const state = join(process.env.HOME || homedir(), ".playground")
  if (!LINKED.every((file) => existsSync(join(state, file)))) {
    const failed = await stepFailed(["bash", join(REPO, "scripts", "link-skills.sh")], "stderr")
    if (failed) return failed
  }
  const pinned = await pinHere()
  if (pinned.code !== 0) return pinned.line
  return stepFailed([process.execPath, "--no-env-file", OPS_HERDR, "start"], "stdout")
}

// The managers the dispatcher starts the first time it routes work to one, so none sits idle on the user's usage.
const MANAGERS: ManagerVerb[] = ["builder", "dispatcher", "ops", "optimizer", "planner"]

const managerAlone = async (kind: ManagerVerb): Promise<number> => {
  const unready = await setUp()
  if (unready === null) return (await manager(kind)).code
  console.error(`playground: ${unready}`)
  return 1
}

// Loaded only for sweep, since sweep.ts reaches past this folder into ops-tick.
const sweep = async (lead: string): Promise<number> => {
  const { runSweep } = await import("./sweep")
  try {
    console.log((await runSweep(lead, dataDir())).join("\n"))
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  return 0
}

// The Dashboard's checkout; only the bare start cuts it when a fresh install has none, and every other verb says to run that first.
const liveDashboard = (cut = false) => {
  let checkout = dashboardCheckout(REPO)
  if (!checkout) {
    if (!cut) return fail(NO_CHECKOUT)
    console.log("Setting up the Dashboard's checkout…")
    const made = cutDashboardCheckout(REPO)
    if ("error" in made) return fail(made.error)
    checkout = made.checkout
  }
  return { checkout, urls: dashboardUrls(checkout) }
}

const dashboard = async (): Promise<number> => {
  const failed: string[] = []
  const close = (): number => {
    for (const line of leftLines(failed)) console.log(line)
    return failed.length ? 1 : 0
  }
  const { checkout, urls } = liveDashboard(true)
  for (const step of planStart(await probe(urls))) {
    if (step === "jobs") {
      console.log("Starting the Dashboard…")
      const jobs = await startJobs(REPO)
      // up.py has just said to open a cmux terminal, and the Dashboard cannot come up until one is open
      if (jobs === OUTSIDE_CMUX) return 1
      if (jobs !== 0) failed.push(`The Dashboard's jobs didn't start: up.py exited ${jobs}`)
    } else if (step === "dispatcher") {
      console.log(`Starting ${getSessionNames().names.dispatcher}…`)
      const started = await manager("dispatcher")
      if (started.code !== 0) failed.push(`The dispatcher didn't start: ${started.message}`)
    } else if (step === "wait") {
      const ready = urls ?? dashboardUrls(checkout)
      const started = Date.now()
      const state = { shownAt: started, startedAt: started }
      for (;;) {
        const api = await apiUp(ready)
        const now = Date.now()
        const outcome = waitOutcome({ api, beat: dashboardBeat(now), now }, state)
        if ("done" in outcome) {
          if (!outcome.ok) {
            failed.push(`The Dashboard didn't come up: ${outcome.done}`)
            return close()
          }
          console.log(outcome.done)
          break
        }
        if (outcome.progress) {
          console.log(outcome.progress)
          state.shownAt = now
        }
        await pause(2000)
      }
    } else {
      const ready = urls ?? dashboardUrls(checkout)
      if (!ready) {
        failed.push("The Dashboard didn't open: portless gives no URL for it")
        return close()
      }
      Bun.spawnSync(["open", `${ready.web}/dashboard`])
      console.log(`Dashboard: ${ready.web}/dashboard`)
      console.log(VIEW_HINT)
    }
  }
  return close()
}

const start = (): Promise<number> =>
  runStart(async () => ((await opsHerdr(["start"]).exited) === 0 ? 0 : 1), dashboard)

const status = (): Promise<number> =>
  runStatus(
    async () => ((await opsHerdr(["status"]).exited) === 0 ? 0 : 1),
    async () => {
      const { urls } = liveDashboard()
      for (const line of statusLines(await probe(urls), TERMINAL)) console.log(line)
    },
  )

const view = async (): Promise<number> => opsHerdr(["attach", VIEW_SERVER]).exited

// Asks the dashboard's supervisor for a roll now (its roll-now file) and follows its logs to the end; the supervisor keeps the running build on a failure.
const roll = async (): Promise<number> => {
  const state = opsDashboard()
  if (!supervisorRunning()) fail("the Dashboard's supervisor is not running; run playground first")
  if (existsSync(join(state, "paused")))
    fail(`the Dashboard's supervisor is paused (${join(state, "paused")})`)
  const log = join(state, "supervisor.log")
  const results = join(state, "results.log")
  const from = { log: Bun.file(log).size, results: Bun.file(results).size }
  await Bun.write(join(state, "roll-now"), "")
  console.log("Building…")
  let shown = "building"
  const until = Date.now() + ROLL_MS
  while (Date.now() < until) {
    const outcome = rollOutcome(
      await linesSince(log, from.log),
      await linesSince(results, from.results),
    )
    if ("done" in outcome) {
      ;(outcome.ok ? console.log : console.error)(outcome.done)
      return outcome.ok ? 0 : 1
    }
    if (outcome.phase !== shown) {
      shown = outcome.phase
      console.log(outcome.phase === "switching" ? "Switching…" : "Going back…")
    }
    await pause(2000)
  }
  console.error("Failed: no roll result within 30 minutes; see ops/dashboard/supervisor.log")
  return 1
}

// playground update [--to <tag>]: the release skill's step 5 on this checkout (update.ts), then the roll.
const update = (to?: string): Promise<number> => runUpdate(REPO, spawnRun, roll, console.log, to)

// playground uninstall: the install's links, LaunchAgents and the Dashboard's stack (uninstall.ts); --purge, after asking, the data folder and the database too. The database's name is loaded only here, since it lives in the API's tree.
const uninstallAll = async (purge: boolean): Promise<number> => {
  const { livePair } = await import("../../../../api/hono/src/lib/dev/live-dashboard")
  const { database } = livePair()
  const checkout = dashboardCheckout(REPO)
  return uninstall({
    claude: Bun.which("claude") !== null,
    confirm: () => askPurge(HOME_DATA, database),
    data: HOME_DATA,
    database,
    home: homedir(),
    log: console.log,
    purge,
    repo: REPO,
    run: spawnRun,
    stacks: checkout ? [checkout] : [],
  })
}

// playground <verb>: its package script, run in the Dashboard's checkout, whose .env names the database the Dashboard shows; any other checkout's is its own (.agents/dashboard/asks.md).
const verb = (name: string, words: string[]): Promise<number> =>
  Bun.spawn([process.execPath, ...verbArgv(name, words)], {
    cwd: liveDashboard().checkout,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited

const add = async (args: string[]): Promise<number> => {
  const policy = readPolicyOrDefaults(dataDir())
  if (policy.refusal !== undefined) fail(policy.refusal)
  const models = modelSettings.get(policy.settings!, "models.claude")
  const command = addCommand(args, briefExists, pickName, models)
  if ("error" in command) fail(command.error)
  const { argv, started } = command as { argv: string[]; started: string }
  const result = await runSpawn(SPAWN, argv, HOME_DATA)
  if (result.code !== 0) {
    console.error(result.message)
    return result.code
  }
  console.log(started)
  return 0
}

// playground page: the page kept in the data folder the dashboard reads (PLAYGROUND_DATA_DIR's when set, so a test stack's fixture folder can be named), then opened.
const page = (args: string[]): number => {
  const parsed = pageArgs(args)
  if ("error" in parsed) return fail(parsed.error)
  const kept = keepPage(parsed, dataDir())
  if ("error" in kept) return fail(kept.error)
  Bun.spawnSync(["open", kept.path])
  console.log(`Kept ${kept.path}`)
  return 0
}

// playground picker: answers one permission prompt (picker.ts), loaded only for this command.
const picker = async (args: string[]): Promise<number> => {
  const { pickerDeps, runPicker } = await import("./picker")
  const { code, out } = await runPicker(args, await pickerDeps())
  ;(code === 0 ? console.log : console.error)(code === 0 ? out : `playground: ${out}`)
  return code
}

// playground alerts-wait: blocks until the next stuck alert for a manager (alerts-wait.ts), then prints it.
const alertsWaitFor = async (name: string): Promise<number> => {
  const { alertsWait } = await import("./alerts-wait")
  console.log(await alertsWait(name, join(dataDir(), "ops", "outbox")))
  return 0
}

// playground migrate: the switch's one-time move (migrate.ts), loaded only for this command.
const migrateMachine = async (words: string[]): Promise<number> => {
  const { runMigrate } = await import("./migrate")
  return runMigrate(words, dataDir(), join(configDirOf(), "skills"), homedir(), console.log)
}

const args = process.argv.slice(2)
const [command, ...rest] = args
// migrate is the switch that seeds the names, so it runs on whatever settings the machine holds.
if (command !== "migrate")
  try {
    setSessionNames(readSessionNames(dataDir()))
  } catch (error) {
    // settings set writes policy.json again from the scopes' own settings, so it runs past one that does not parse, the remedy the refusal names
    if (command !== "settings") fail((error as Error).message)
  }
if (wantsHelp(args)) {
  console.log(HELP)
  process.exit(0)
}
const refused = extraWordRefusal(args)
// a word a command does not take is a usage error, exit 2, so a typo never reads as success
if (refused) fail(refused, 2)
const code =
  command === undefined
    ? await start()
    : command === "status"
      ? await status()
      : command === "sweep"
        ? await sweep(rest[0]!)
        : command === "update"
          ? await update(rest[1])
          : command === "add"
            ? await add(rest)
            : MANAGERS.includes(command as ManagerVerb)
              ? await managerAlone(command as ManagerVerb)
              : command === "page"
                ? page(rest)
                : command === "view"
                  ? await view()
                  : command === "picker"
                    ? await picker(rest)
                    : command === "alerts-wait"
                      ? await alertsWaitFor(rest[0]!)
                      : command === "doctor"
                        ? report(await doctor(REPO, homedir(), HOME_DATA))
                        : command === "version"
                          ? (console.log(version(REPO, HOME_DATA).join("\n")), 0)
                          : command === "uninstall"
                            ? await uninstallAll(rest[0] === "--purge")
                            : command === "ext" || command === "settings"
                              ? await runStore(
                                  command,
                                  rest,
                                  {
                                    data: dataDir(),
                                    out: console.log,
                                    stdin: () => Bun.stdin.text(),
                                    write: Bun.write,
                                  },
                                  console.error,
                                )
                              : command === "rules"
                                ? // loaded only here, since it reads the rules hook and the settings package, which the bare dispatcher's start needs neither of
                                  await (
                                    await import("./rules")
                                  ).runRules(
                                    rest,
                                    process.cwd(),
                                    process.env,
                                    console.log,
                                    console.error,
                                  )
                                : command === "migrate"
                                  ? await migrateMachine(rest)
                                  : command === "orgs"
                                    ? await orgsCommand(rest, orgsIo(REPO, dataDir()))
                                    : command === "accounts"
                                      ? await runAccounts(rest, accountsIo(dataDir()))
                                      : command === "herdr" && rest[0] === "stop"
                                        ? (await opsHerdr(["stop-all"]).exited) === 0
                                          ? 0
                                          : 1
                                        : command === "herdr" && rest[0] === "pin"
                                          ? await (
                                              await import("./herdr-pin")
                                            ).runHerdrPin(rest.slice(1))
                                          : VERBS.includes(command)
                                            ? await verb(command, rest)
                                            : fail(
                                                `no command ${command}; playground --help lists them`,
                                              )
process.exit(code)
