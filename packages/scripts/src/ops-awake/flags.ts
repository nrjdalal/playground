import { join } from "node:path"

// #i19: -s and -i keep the system awake on AC power and on battery; -d and -u stay off, so the display still sleeps and locks. Lid-shut sleep is per-machine: ops-awake.json in the data folder holds { "lidSleep": true }, which drops -s, the hold that keeps a shut lid awake on AC; a missing or unreadable file keeps the default.
export const flagsOf = (lidSleep: boolean): string[] => (lidSleep ? ["-i"] : ["-s", "-i"])

export const lidSleepOf = async (dir: string): Promise<boolean> => {
  try {
    return (await Bun.file(join(dir, "ops-awake.json")).json()).lidSleep === true
  } catch {
    return false
  }
}
