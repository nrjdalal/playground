import { join } from "node:path"

import { checkoutRoot, fixtureStart, readsLive } from "@/lib/dashboard/fixture"
import { DISPATCHER } from "@/lib/dashboard/workers"

// The home's Start <dispatcher>: the CLI's own dispatcher step, run through one fixed argv from the API's own checkout, which writes the dispatcher's brief when it is missing and starts it with spawn.sh. A fixture stack runs nothing and brings its made-up dispatcher back, or makes one on a fixture with none.

export type Run = (argv: string[]) => Promise<{ code: number; stderr: string; stdout: string }>

export type Started =
  | { name: string; status: "running" }
  | { name: string; status: "started" }
  | { detail: string; name: string; status: "failed" | "refused" }

export const dispatcherArgv = (root: string): string[] => [
  "bun",
  join(root, "packages/scripts/src/playground/cli.ts"),
  "dispatcher",
]

const run: Run = async (argv) => {
  const child = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, stderr, stdout }
}

// The CLI's last line, whole: a refusal names its gate and reading, and the app shows all of it.
const said = (text: string) => text.trim().split("\n").at(-1) ?? ""

export async function startDispatcher({
  dir,
  live = readsLive(),
  name = DISPATCHER,
  root = checkoutRoot(),
  run: runCli = run,
}: {
  dir?: string
  live?: boolean
  name?: string
  root?: string | null
  run?: Run
} = {}): Promise<Started> {
  if (!live) return { name, status: fixtureStart(name, dir) ? "started" : "running" }
  if (!root) return { detail: "this API has no checkout to start it from", name, status: "failed" }
  const result = await runCli(dispatcherArgv(root))
  if (result.code === 0) return { name, status: "started" }
  if (result.code === 3) return { name, status: "running" }
  const detail = said(result.stderr) || said(result.stdout) || `exit ${result.code}`
  return { detail, name, status: result.code === 1 ? "refused" : "failed" }
}
