// ship:rehearsal new|clear <dir>: the invitee rehearsal's scratch folder, made by makeScratch in the caller's temp folder and removed whole by removeScratch, past the trash's cap of 5,000 files or 2 GB, since a rehearsal's folder holds about 140,000 entries.
import { lstatSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { makeScratch, removeScratch } from "@packages/safe-delete"

// The name every rehearsal folder starts with, which nightly-clean's backstop also reads.
export const REHEARSAL_PREFIX = "ops-r"

const LEGACY_AGE_MS = 48 * 60 * 60 * 1000

// A rehearsal folder from before ship:rehearsal new, so with no marker: named ops-r<NNN>, holding the rehearsal's own clone and logs folders, and untouched for over 48 hours.
export const isLegacyRehearsal = (abs: string): boolean =>
  /^ops-r\d{3}/.test(basename(abs)) &&
  ["clone", "logs"].every((part) =>
    lstatSync(join(abs, part), { throwIfNoEntry: false })?.isDirectory(),
  ) &&
  lstatSync(abs).mtimeMs < Date.now() - LEGACY_AGE_MS

// A new rehearsal folder directly in tmp, holding makeScratch's marker.
export const newRehearsal = (tmp = tmpdir()): string => makeScratch(REHEARSAL_PREFIX, tmp)

// Removes a folder newRehearsal made directly in tmp, or a legacy one: null once removed, else why not.
export function clearRehearsal(dir: string, tmp = tmpdir()): string | null {
  if (!basename(dir).startsWith(REHEARSAL_PREFIX))
    return `${dir} is not a rehearsal folder: its name does not start with ${REHEARSAL_PREFIX}`
  const refused = removeScratch(dir, tmp, isLegacyRehearsal)
  return refused?.endsWith("marker")
    ? `${refused}, and is not a legacy rehearsal folder (ops-r<NNN> holding clone and logs, over 48 hours old)`
    : refused
}

if (import.meta.main) {
  const [verb, dir] = process.argv.slice(2)
  if (verb === "new" && !dir) console.log(newRehearsal())
  else if (verb === "clear" && dir) {
    const refused = clearRehearsal(dir)
    if (refused) {
      console.error(`ship:rehearsal: kept ${refused}`)
      process.exit(1)
    }
    console.log(`ship:rehearsal: removed ${dir}`)
  } else {
    console.error("usage: bun run ship:rehearsal new | bun run ship:rehearsal clear <dir>")
    process.exit(1)
  }
}
