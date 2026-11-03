import { lstatSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { quarantine, type Roots } from "@packages/safe-delete"

import { registryName } from "../../../scripts/hooks/role"
import { mainCheckout } from "./main-checkout"

// This machine's roots for a script's quarantine, as playground rm reads them: HOME, the main checkout and the data folder's trash.
export const machineRoots = (): Roots => ({
  home: homedir(),
  main: mainCheckout(),
  trash: join(dataDir(), "trash"),
})

// This session's name in Claude Code's registry, else "shell" for a run by hand.
export const sessionName = async (): Promise<string> =>
  (process.env.CLAUDE_CODE_SESSION_ID &&
    (await registryName(process.env.CLAUDE_CODE_SESSION_ID))) ||
  "shell"

// Moves a path into the trash when it exists; a refusal throws its text, so the script stops with it and nothing is deleted.
export function toTrash(path: string, reason: string, roots: Roots, session: string): void {
  if (!lstatSync(path, { throwIfNoEntry: false })) return
  const moved = quarantine(path, { reason, session }, roots)
  if ("refused" in moved) throw new Error(moved.refused)
}
