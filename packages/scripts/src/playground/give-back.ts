import { existsSync, readFileSync, renameSync, rmdirSync, rmSync } from "node:fs"

// Gives back the run-slot lane this process runs in, which run-slot names in RUN_SLOT_HELD as "<lane folder> <run-slot pid>", the way run-slot's own free() does: only while the lane's holder line still names that run-slot, so a lane another run has taken since stays that run's. The process then goes on outside the queue, and run-slot's free() at its end finds the line gone and leaves the lane alone.
export const giveBackSlot = (held = process.env.RUN_SLOT_HELD): boolean => {
  const [slot, pid] = held?.split(" ") ?? []
  if (!slot || !pid) return false
  let line: string
  try {
    line = readFileSync(`${slot}.holder`, "utf8")
  } catch {
    return false
  }
  if (line.split(" ")[1] !== pid) return false
  for (const file of [".holder", ".child", ".preempted"]) rmSync(`${slot}${file}`, { force: true })
  // one rename out of the slot path, as run-slot's drop() does, so a reclaimer's claim that lands beforehand leaves with the folder
  const gone = `${slot}.gone-${process.pid}`
  try {
    renameSync(slot, gone)
  } catch {
    return true
  }
  // each claim in it, the deepest first, as drop() removes a claim taken over inside another
  const dirs = [gone]
  while (existsSync(`${dirs[0]}/reclaim`)) dirs.unshift(`${dirs[0]}/reclaim`)
  for (const dir of dirs)
    try {
      rmdirSync(dir)
    } catch {}
  return true
}
