import { join } from "node:path"

import { localModelSettings, readPolicyOrDefaults } from "@packages/settings"

import { checkoutRoot, readsLive } from "@/lib/dashboard/fixture"
import { dataDir } from "@/lib/sessions/paths"

// A model's folder under ~/models as `playground model use` takes it: a letter or digit first, then lowercase, digits, dots and dashes, so it names no path or flag.
export const MODEL_FOLDER = /^[a-z0-9][a-z0-9.-]*$/

// How long one `playground model use` may run: it waits for the server it starts to answer /health, so its timeout sits past the 15 minutes a load is given.
export const START_MS = 20 * 60_000

export type Started = { code: number; line: string }

// The model the local server's machine keeps up (localModels.peerModel), which a pick starts when the server is down: "" when none is set or the settings do not read, so the pick is refused as before.
export const keptLocalModel = (data: string = dataDir()): string => {
  const read = readPolicyOrDefaults(data)
  return read.settings ? localModelSettings.get(read.settings, "localModels.peerModel") : ""
}

// Pure: the one fixed argv a local pick starts a model with, the playground CLI's own `model use` run by this bun with no shell, so its hold, memory floor and refusals stay the single path; a name MODEL_FOLDER refuses throws before anything runs.
export function loadArgv(model: string, root: string, bun: string = process.execPath): string[] {
  if (!MODEL_FOLDER.test(model))
    throw new Error(`${JSON.stringify(model)} is not a model folder name`)
  return [bun, join(root, "packages/scripts/src/playground/cli.ts"), "model", "use", model]
}

const lastLine = (text: string) => text.trim().split("\n").at(-1)?.slice(0, 300) || "no output"

// Starts model on the machine `playground model use` picks for it, and gives back its exit code and last line; a fixture stack starts nothing, so no ssh leaves the machine.
export async function startModel(
  model: string,
  root: string | null = checkoutRoot(),
  timeoutMs = START_MS,
): Promise<Started> {
  if (!readsLive()) return { code: 0, line: "a fixture stack starts no model" }
  if (!root) return { code: 1, line: "this build has no checkout to run playground model use from" }
  return runStart(loadArgv(model, root), root, timeoutMs)
}

// Runs one start's argv in cwd with no shell, killed by its own handle past timeoutMs: its exit code and the last line it printed, stdout's on success and stderr's on a failure, or that it ran too long.
export async function runStart(argv: string[], cwd: string, timeoutMs: number): Promise<Started> {
  const proc = Bun.spawn(argv, {
    cwd,
    env: process.env,
    killSignal: "SIGTERM",
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: timeoutMs,
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (proc.signalCode)
    return { code: code || 1, line: "playground model use ran too long and was stopped" }
  return { code, line: lastLine(code === 0 ? out : err || out) }
}
