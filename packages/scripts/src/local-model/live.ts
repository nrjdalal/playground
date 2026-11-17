import { homedir } from "node:os"
import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { localModelSettings, readPolicyOrDefaults } from "@packages/settings"

import { REPO, run } from "../ops-job/job"
import { keepUp, type Machine, type ModelDeps, useModel } from "./model"
import { peerOf } from "./peer"
import { thisMachine } from "./state"

// The live seams of playground model use and the keep beat: the settings, this machine and the peer from the repo's .env, commands through ops-job's run.

const settingsOf = (data: string) => {
  const read = readPolicyOrDefaults(data)
  if (read.refusal !== undefined) throw new Error(read.refusal)
  const get = <K extends Parameters<typeof localModelSettings.get>[1]>(key: K) =>
    localModelSettings.get(read.settings, key)
  return {
    boxLanes: get("localModels.boxLanes"),
    boxRunGiB: get("localModels.boxRunGiB"),
    container: get("localModels.container"),
    drainMinutes: get("localModels.drainMinutes"),
    hereModel: get("localModels.hereModel"),
    hereReserveGiB: get("localModels.hereReserveGiB"),
    idleMinutes: get("localModels.idleMinutes"),
    machine: get("localModels.machine"),
    minFreeGiB: get("localModels.minFreeGiB"),
    models: get("localModels.models"),
    peerModel: get("localModels.peerModel"),
    sessionTokens: get("localModels.sessionTokens"),
  }
}

// The deps for one machine: this one when named by its own name, else the peer, named or the one localModels.machine picks.
const depsFor = async (
  data: string,
  where: { here: true } | { peer: string },
  say: (line: string) => void,
): Promise<ModelDeps | { why: string }> => {
  const settings = settingsOf(data)
  let machine: Machine
  let key: string | undefined
  if ("here" in where) machine = { name: thisMachine() }
  else {
    const envText = await Bun.file(join(REPO, ".env"))
      .text()
      .catch(() => "")
    const peer = peerOf(envText, process.env.HOME || homedir(), where.peer || settings.machine)
    if ("why" in peer) return peer
    machine = { name: peer.name, target: peer.target }
    key = peer.key
  }
  const here = !machine.target
  return {
    config: {
      container: settings.container,
      drainMinutes: settings.drainMinutes,
      idleMinutes: settings.idleMinutes,
      keep: here ? settings.hereModel : settings.peerModel,
      minFreeGiB: settings.minFreeGiB,
      models: settings.models,
      reserveGiB: here
        ? settings.hereReserveGiB
        : settings.minFreeGiB + settings.boxLanes * settings.boxRunGiB,
      sessionTokens: settings.sessionTokens,
    },
    data,
    key,
    machine,
    now: () => new Date(),
    // the machine record's add is not on this branch yet, so each start says what it did not record
    record: async () => {
      throw new Error("the machine record is not in place yet")
    },
    run: (argv, timeoutMs) => run(argv, timeoutMs),
    say,
    sleep: (ms) => Bun.sleep(ms),
  }
}

export const MODEL_USAGE = "usage: playground model use <name> [--machine <name>]"

// playground model use <name> [--machine <name>]: the machine named, else the one that keeps that model (localModels.hereModel here), else the peer.
export const runModel = async (words: string[]): Promise<number> => {
  const [verb, name, flag, named, ...extra] = words
  if (
    verb !== "use" ||
    !name ||
    (flag !== undefined && (flag !== "--machine" || !named)) ||
    extra.length
  ) {
    console.error(MODEL_USAGE)
    return 2
  }
  const machine = named ?? (name === settingsOf(dataDir()).hereModel ? thisMachine() : "")
  const deps = await depsFor(
    dataDir(),
    machine === thisMachine() ? { here: true } : { peer: machine },
    console.log,
  )
  if ("why" in deps) {
    console.error(`playground model use: ${deps.why}`)
    return 1
  }
  const result = await useModel(name, deps)
  ;(result.code === 0 ? console.log : console.error)(result.line)
  return result.code
}

// The keep beat's lines for ops: each machine whose kept model is set, this one and then the peer; a peer that does not read throws, so the beat's failure says why.
export const keepBeat = async (data: string): Promise<string[]> => {
  const settings = settingsOf(data)
  const lines: string[] = []
  const wheres = [
    ...(settings.hereModel ? [{ here: true as const }] : []),
    ...(settings.peerModel ? [{ peer: "" }] : []),
  ]
  for (const where of wheres) {
    const deps = await depsFor(data, where, () => {})
    if ("why" in deps) throw new Error(deps.why)
    const line = await keepUp(deps)
    if (line) lines.push(line)
  }
  return lines
}
