import { constants, homedir } from "node:os"
import { join } from "node:path"

import { localModelSettings, readPolicyOrDefaults } from "@packages/settings"

import { engineData, REPO } from "../ops-job/job"
import { beat } from "../ops-tick/tick"
import { JOB, keep } from "./tunnel"

const data = engineData(JOB)

const stop = new AbortController()
let signal: NodeJS.Signals | undefined
for (const name of ["SIGHUP", "SIGINT", "SIGTERM"] as const)
  process.on(name, () => {
    signal ??= name
    stop.abort()
  })
const startedAt = new Date()
await keep({
  data,
  envText: () =>
    Bun.file(join(REPO, ".env"))
      .text()
      .catch(() => ""),
  home: process.env.HOME || homedir(),
  machine: () => {
    const read = readPolicyOrDefaults(data)
    return read.refusal === undefined
      ? localModelSettings.get(read.settings, "localModels.machine")
      : ""
  },
  record: async () => {
    throw new Error("the machine record is not in place yet")
  },
  signal: stop.signal,
  spawn: (argv) => {
    const child = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "ignore" })
    return {
      exited: child.exited,
      kill: () => child.kill(),
      stderr: new Response(child.stderr).text(),
    }
  },
  ssh: Bun.which("ssh"),
  wait: (ms) =>
    new Promise<void>((done) => {
      const timer = setTimeout(done, ms)
      stop.signal.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true })
    }),
})
await beat(
  join(data, "ops", `${JOB}.json`),
  startedAt,
  new Date(),
  `loop exited: ${signal?.slice(3) ?? "stopped"}`,
  JOB,
)
process.exit(signal ? 128 + constants.signals[signal] : 0)
