// playground uninstall: the LaunchAgents, the Dashboard's stack, the home skill set and the links go; the data folder and the database stay unless --purge, which asks first.
import { readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { linksInto } from "./links"
import type { Run } from "./update"

// The LaunchAgents that run something from the checkout (a worktree of it included) or the data folder, A to Z.
export const ourPlists = (agents: string, repo: string, data: string): string[] => {
  let names: string[] = []
  try {
    names = readdirSync(agents).filter((name) => name.endsWith(".plist"))
  } catch {}
  return names
    .map((name) => join(agents, name))
    .filter((path) => {
      const text = readFileSync(path, "utf8")
      return text.includes(`${repo}/`) || text.includes(`${data}/`)
    })
    .toSorted()
}

export const askPurge = async (data: string, database: string): Promise<boolean> =>
  prompt(`Type purge to remove ${data} and the database ${database} for good:`) === "purge"

// The home skill set and its ws marketplace, as orgs.ts's installHome added them, each only while Claude Code lists it.
const removeHomeSet = async (run: Run, log: (line: string) => void) => {
  if ((await run(["claude", "plugin", "list"])).out.includes("ws-home@ws")) {
    await run(["claude", "plugin", "uninstall", "ws-home@ws", "--scope", "user"])
    log("removed the home skill set ws-home@ws from Claude Code")
  }
  let markets: { name?: string }[] = []
  try {
    markets = JSON.parse((await run(["claude", "plugin", "marketplace", "list", "--json"])).out)
  } catch {}
  if (markets.some((market) => market.name === "ws")) {
    await run(["claude", "plugin", "marketplace", "remove", "ws"])
    log("removed the marketplace ws from Claude Code")
  }
}

type Options = {
  // whether claude is on PATH, to take back the home skill set install.sh put in Claude Code's user settings
  claude?: boolean
  confirm: () => Promise<boolean>
  data: string
  database: string
  home: string
  log: (line: string) => void
  purge: boolean
  repo: string
  run: Run
  stacks: string[]
}

export const uninstall = async (o: Options): Promise<number> => {
  if (o.purge && !(await o.confirm())) {
    o.log("playground uninstall: nothing removed")
    return 1
  }
  for (const plist of ourPlists(join(o.home, "Library", "LaunchAgents"), o.repo, o.data)) {
    await o.run(["launchctl", "bootout", `gui/${process.getuid!()}`, plist])
    rmSync(plist, { force: true })
    o.log(`removed ${plist}`)
  }
  // a stack that would not stop is named with its last output line, and the run ends 1 once the rest is done
  let failed = false
  for (const checkout of o.stacks) {
    const stop = await o.run([process.execPath, "run", "--cwd", checkout, "dev:stop"])
    if (stop.code === 0) o.log(`stopped the stack in ${checkout}`)
    else {
      failed = true
      const why = stop.out.trim().split("\n").at(-1) || `dev:stop exited ${stop.code}`
      o.log(`did not stop the stack in ${checkout}: ${why}`)
    }
  }
  if (o.claude) await removeHomeSet(o.run, o.log)
  const links = linksInto(o.repo, o.home, o.data)
  for (const { path } of links) rmSync(path, { force: true })
  o.log(`removed ${links.length} links into ${o.repo}`)
  if (!o.purge) {
    o.log(
      `kept ${o.data} and the database ${o.database}; playground uninstall --purge removes them`,
    )
    return failed ? 1 : 0
  }
  await o.run(["docker", "rm", "-fv", o.database], true)
  rmSync(o.data, { force: true, recursive: true })
  o.log(`removed ${o.data} and the database ${o.database}`)
  return failed ? 1 : 0
}
