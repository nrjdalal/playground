import { join } from "node:path"

// Lid-shut sleep is per-machine: ops-awake.json in the data folder holds { "lidSleep": true }; a missing or unreadable file keeps the default.
export const flagsOf = (lidSleep: boolean): string[] => (lidSleep ? ["-dimu"] : ["-dimsu"])

// The ops-awake LaunchAgent's label.
export const AWAKE_LABELS = ["com.playground.ops-awake"]

// #i175 ("caffeinate -s only ... Never -d, -i or -u"): beside a loaded ops-awake LaunchAgent (print exits 0) this bun job's -dimsu would fake activity, so only launchctl's not-found (113, measured 25 Oct) for every label lets it start; any other exit is failed, for the caller to refuse.
export const launchdAwakeOf = async (
  run: (argv: string[]) => Promise<{ code: number; out: string }>,
): Promise<{ code: number; out: string; state: "absent" | "failed" | "loaded" }> => {
  let last = { code: 113, out: "" }
  for (const label of AWAKE_LABELS) {
    last = await run(["launchctl", "print", `gui/${process.getuid?.() ?? 0}/${label}`])
    if (last.code !== 113) break
  }
  const { code, out } = last
  return { code, out, state: code === 0 ? "loaded" : code === 113 ? "absent" : "failed" }
}

export const lidSleepOf = async (dir: string): Promise<boolean> => {
  try {
    return (await Bun.file(join(dir, "ops-awake.json")).json()).lidSleep === true
  } catch {
    return false
  }
}
