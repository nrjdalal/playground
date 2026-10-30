import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { accountSettings, accountsOf, modelSettings, readPolicy } from "@packages/settings"

import { beat, cycle, CYCLE_SECONDS, zaiQuota } from "./sync"

// The Z.ai key, the first GLM row of usage.accounts by its label, is read from the Keychain inside this process and goes only into the request header: it never reaches a log, a file or an argument list.
const data = dataDir()
const usagePath = join(data, "zai-usage.json")
const beatPath = join(data, "ops", "ops-zai-usage.json")

const key = async (): Promise<string> => {
  const policy = await readPolicy(data)
  if (policy.refusal !== undefined) return ""
  const service = modelSettings.get(policy.settings, "models.glmKeychainService")
  const label = accountsOf(accountSettings.get(policy.settings, "usage.accounts"), "glm")[0]?.label
  if (!label) return ""
  const out = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-a", label, "-w"])
  return out.exitCode === 0 ? out.stdout.toString().trim() : ""
}
const read = async (): Promise<unknown> => zaiQuota(await key())

if (process.argv.includes("--once")) {
  const result = await cycle(read, usagePath)
  console.log(`ops-zai-usage: ${result}`)
  process.exit(result === "ok" ? 0 : 1)
}

const startedAt = new Date()
let lastResult = "ok"
let reading = false

const pulse = (result: string) =>
  beat(beatPath, startedAt, new Date(), result).catch((err) => console.error(err))

const run = async () => {
  if (reading) return
  reading = true
  lastResult = await cycle(read, usagePath)
  reading = false
  console.log(`${new Date().toISOString()} ${lastResult}`)
  await pulse(lastResult)
}

// The beat runs on its own timer, so a read that hangs still beats, as failing.
void run()
setInterval(() => {
  void pulse(reading ? "still reading Z.ai from the last cycle" : lastResult)
  void run()
}, CYCLE_SECONDS * 1000)
