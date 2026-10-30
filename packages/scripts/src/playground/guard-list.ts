import { join } from "node:path"

import { coreDir, GUARD_LISTS } from "@packages/settings"

import { guardList, isStrings } from "../../../../scripts/hooks/lists"

const LISTS = join(coreDir(), "lists")

// The guard-list reader for a shell or Python caller: `bun packages/scripts/src/playground/guard-list.ts <guard> <list>` prints a list of words as JSON, the checkout's copy on a machine with no extensions, exit 0; exits 2 naming why for a list no guard reads or one that cannot be trusted, so its caller fails closed.
export const guardListExit = async (
  guard: string | undefined,
  name: string | undefined,
  environment: Record<string, string | undefined>,
  out: (line: string) => void,
  err: (line: string) => void,
  lists = LISTS,
): Promise<number> => {
  if (!guard || !name) {
    err("usage: bun packages/scripts/src/playground/guard-list.ts <guard> <list>")
    return 2
  }
  const list = GUARD_LISTS.find((known) => known === name)
  if (!list) {
    err(`no guard list ${name}; the lists are ${GUARD_LISTS.join(", ")}`)
    return 2
  }
  const loaded = await guardList(
    guard,
    list,
    isStrings,
    [],
    environment,
    join(lists, `${list}.json`),
  )
  if (loaded.refusal !== undefined) {
    err(loaded.refusal)
    return 2
  }
  out(JSON.stringify(loaded.list))
  return 0
}

if (import.meta.main)
  process.exit(
    await guardListExit(process.argv[2], process.argv[3], process.env, console.log, console.error),
  )
