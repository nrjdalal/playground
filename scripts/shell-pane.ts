#!/usr/bin/env bun
// A plain shell pane a session drives (skills/playground/shell-pane): a workspace on the playground-probes herdr server, which takes a command only after every registered Bash guard passes it, since a pane has no PreToolUse hook of its own.
import { homedir } from "node:os"
import { join } from "node:path"

import { mainCheckout } from "../packages/scripts/src/main-checkout"

const USAGE = `usage:
  bun scripts/shell-pane.ts open <session name>
  bun scripts/shell-pane.ts run <pane> '<command>'
  bun scripts/shell-pane.ts read <pane> <marker> [--timeout <ms>]
  bun scripts/shell-pane.ts close <workspace>`

export const SERVER = "playground-probes"
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LABEL = /^shell-[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/
const MARKER = /^__shell_pane_[0-9a-f]{12}$/
// no-raw-spawn's STARTS_CLAUDE: claude as a word, but not the .claude folder or a longer word
const CLAUDE = /(?<![.\w])claude(?!\w)/i

type Json = Record<string, any>
// One herdr CLI call on the probes server: its exit code and what it printed (stdout, else stderr).
export type Herdr = (args: string[]) => Promise<{ code: number; out: string }>

export class Refusal extends Error {}

const herdrCli: Herdr = async (args) => {
  const home = process.env.HOME || homedir()
  const child = Bun.spawn([join(home, ".playground", "bin", "herdr"), ...args], {
    env: {
      ...process.env,
      HERDR_SESSION: SERVER,
      HERDR_SOCKET_PATH: join(home, ".playground", "herdr", `${SERVER}.sock`),
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, out: out || err }
}

// A herdr call's JSON reply: its result, or a refusal naming its error. pane run prints nothing once it has typed (measured on 0.9.5).
function reply(args: string[], { code, out }: { code: number; out: string }): Json {
  if (code === 0 && !out.trim()) return {}
  let json: Json = {}
  try {
    json = JSON.parse(out)
  } catch {}
  if (code === 0 && json.result) return json.result
  throw new Refusal(`herdr ${args.slice(0, 2).join(" ")}: ${json.error?.message ?? out.trim()}`)
}

const call = async (herdr: Herdr, args: string[]): Promise<Json> => reply(args, await herdr(args))

// The guards registered for the Bash tool in the factory settings, by name, as the hooks run them; a Bash hook whose command names no scripts/hooks/<name>.ts is one the launcher cannot run, so it refuses rather than skip it.
export async function bashGuards(repo: string): Promise<string[]> {
  const settings = await Bun.file(join(repo, "scripts", "factory-settings.json")).json()
  const entries: { hooks: { command: string }[]; matcher: string }[] =
    settings.hooks?.PreToolUse ?? []
  const commands = entries
    .filter((entry) => new RegExp(entry.matcher).test("Bash"))
    .flatMap((entry) => entry.hooks.map((h) => h.command))
  const names = commands.map((command) => command.match(/scripts\/hooks\/([\w-]+)\.ts/)?.[1])
  const unread = commands.find((_, i) => !names[i])
  if (unread !== undefined)
    throw new Refusal(
      `shell-pane cannot run a registered Bash hook that names no scripts/hooks/<name>.ts: ${unread}`,
    )
  return [...new Set(names as string[])]
}

// The first refusal of a command typed in `cwd`: each registered Bash guard's check() over it as a Bash call of its own, then a word naming claude; a guard that cannot load or check refuses, as its hook does.
export async function screen(
  command: string,
  cwd: string,
  repo: string,
): Promise<string | undefined> {
  let guards: string[]
  try {
    guards = await bashGuards(repo)
  } catch (error) {
    if (error instanceof Refusal) return error.message
    throw error
  }
  if (guards.length === 0)
    return `shell-pane found no Bash guard in ${repo}/scripts/factory-settings.json`
  const raw = JSON.stringify({
    cwd,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  })
  for (const name of guards) {
    try {
      const { check } = await import(join(repo, "scripts", "hooks", `${name}.ts`))
      const reason = await check(raw)
      if (reason) return reason
    } catch (error) {
      return `shell-pane refuses: ${name} could not check the command (${error instanceof Error ? error.message : error})`
    }
  }
  // read with its quotes and backslashes taken out, as the shell joins cl''aude or c\\laude into one word
  if (CLAUDE.test(command.replace(/['"\\]/g, "")))
    return "shell-pane refuses a command naming claude: only scripts/spawn.sh starts a session"
}

// A workspace on the probes server labelled shell-<name>-<n>, n one past the name's highest, its one pane's shell in `cwd`.
export async function open(name: string, cwd: string, herdr: Herdr = herdrCli) {
  if (!NAME.test(name)) throw new Refusal(`shell-pane open takes a session name, a word: ${name}`)
  const { workspaces } = await call(herdr, ["workspace", "list"])
  const taken = (workspaces as Json[])
    .map((w) => String(w.label).match(new RegExp(`^shell-${name}-(\\d+)$`))?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
  const label = `shell-${name}-${Math.max(0, ...taken) + 1}`
  const made = await call(herdr, [
    "workspace",
    "create",
    "--label",
    label,
    "--cwd",
    cwd,
    "--no-focus",
  ])
  return {
    label,
    pane: made.root_pane.pane_id as string,
    workspace: made.workspace.workspace_id as string,
  }
}

async function labelOf(herdr: Herdr, workspace: string): Promise<string> {
  const { workspace: w } = await call(herdr, ["workspace", "get", workspace])
  return String(w.label)
}

// Types `command` into an idle pane of a workspace this launcher labelled, once screen() passes it: in a fresh `zsh -f` of its own, so no alias, function, variable, folder or open quote one run leaves reaches the next, as none carries between Bash tool calls, then a printf of a fresh marker and its exit status.
export async function run(
  pane: string,
  command: string,
  herdr: Herdr = herdrCli,
  repo = mainCheckout(),
) {
  const { pane: info } = await call(herdr, ["pane", "get", pane])
  const label = await labelOf(herdr, info.workspace_id)
  if (!LABEL.test(label))
    throw new Refusal(
      `shell-pane types only into a workspace it labelled (shell-<name>-<n>); ${pane} is in "${label}"`,
    )
  if (info.agent_session) throw new Refusal(`shell-pane refuses ${pane}: it holds an agent session`)
  // idle when the pane's shell holds its terminal (measured on 0.9.5), so a line is never typed into a running program's input
  const { process_info: proc } = await call(herdr, ["pane", "process-info", "--pane", pane])
  if (typeof proc?.shell_pid !== "number" || proc.foreground_process_group_id !== proc.shell_pid)
    throw new Refusal(
      `shell-pane refuses ${pane}: a command is still running there, or herdr did not say; read its marker first`,
    )
  const reason = await screen(command, info.foreground_cwd || info.cwd, repo)
  if (reason) throw new Refusal(reason)
  const marker = `__shell_pane_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
  const quoted = `'${command.replaceAll("'", "'\\''")}'`
  await call(herdr, [
    "pane",
    "run",
    pane,
    `/bin/zsh -f -c ${quoted}; printf '\\n%s rc=%s\\n' ${marker} "$?"`,
  ])
  return marker
}

// The pane's lines after the typed line, up to the marker line when it shows, and the exit status that line carries.
function since(text: string, marker: string): { output: string; rc?: number } {
  const lines = text.split("\n")
  const end = lines.findLastIndex((line) => new RegExp(`^${marker} rc=\\d+$`).test(line))
  const start = lines.findLastIndex(
    (line, i) => (end === -1 || i < end) && line.includes(`${marker} "$?"`),
  )
  const output = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .replace(/\n+$/, "")
  return end === -1 ? { output } : { output, rc: Number(lines[end]!.split("rc=")[1]) }
}

// What the command printed and the exit status its marker carries; with no marker by `timeout`, what it printed so far and no rc, which reads as unknown, never as a pass.
export async function read(pane: string, marker: string, timeout: number, herdr: Herdr = herdrCli) {
  if (!MARKER.test(marker))
    throw new Refusal(`shell-pane read takes the marker run printed: ${marker}`)
  const source = ["--source", "recent-unwrapped"]
  const args = [
    "pane",
    "wait-output",
    pane,
    "--regex",
    `^${marker} rc=[0-9]+`,
    ...source,
    "--timeout",
    String(timeout),
  ]
  const waited = await herdr(args)
  if (waited.code !== 0 && /"code":"timeout"/.test(waited.out)) {
    const seen = await herdr(["pane", "read", pane, ...source, "--lines", "200"])
    if (seen.code !== 0) throw new Refusal(`herdr pane read: ${seen.out.trim()}`)
    return since(seen.out, marker)
  }
  return since(String(reply(args, waited).read?.text ?? ""), marker)
}

// Closes a workspace whose label this launcher made, by its own id, then reads the server's workspace list to see its label gone.
export async function close(workspace: string, herdr: Herdr = herdrCli) {
  const label = await labelOf(herdr, workspace)
  if (!LABEL.test(label))
    throw new Refusal(
      `shell-pane closes only a workspace it labelled (shell-<name>-<n>); ${workspace} is "${label}"`,
    )
  await call(herdr, ["workspace", "close", workspace])
  const { workspaces } = await call(herdr, ["workspace", "list"])
  if ((workspaces as Json[]).some((w) => w.label === label))
    throw new Refusal(`shell-pane closed ${workspace}, but the server still lists ${label}`)
}

export async function main(argv: string[], herdr: Herdr = herdrCli): Promise<number> {
  const [verb, first, second, ...rest] = argv
  try {
    if (verb === "open" && first && !second) {
      const made = await open(first, process.cwd(), herdr)
      console.log(`pane ${made.pane} workspace ${made.workspace} label ${made.label}`)
      return 0
    }
    if (verb === "run" && first && second && rest.length === 0) {
      console.log(`sent ${await run(first, second, herdr)}`)
      return 0
    }
    if (verb === "read" && first && second) {
      const at = rest.indexOf("--timeout")
      const timeout = at === -1 ? 30_000 : Number(rest[at + 1])
      if (!Number.isInteger(timeout) || timeout <= 0) throw new Refusal(USAGE)
      const got = await read(first, second, timeout, herdr)
      if (got.output) console.log(got.output)
      if (got.rc === undefined) {
        console.log(`no exit marker by ${timeout} ms: the result is unknown`)
        return 2
      }
      console.log(`rc=${got.rc}`)
      return 0
    }
    if (verb === "close" && first && !second) {
      await close(first, herdr)
      console.log(`closed ${first}`)
      return 0
    }
    throw new Refusal(USAGE)
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    console.error(error.message)
    return 1
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
