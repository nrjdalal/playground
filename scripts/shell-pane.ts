#!/usr/bin/env bun
// A plain shell pane a session drives (extensions/core/skills/shell-pane): a workspace on the playground-probes herdr server, which takes a command only after every registered Bash guard passes it, since a pane has no PreToolUse hook of its own.
import { homedir } from "node:os"
import { join } from "node:path"

import { mainCheckout } from "../packages/scripts/src/main-checkout"

const USAGE = `usage:
  bun run --no-env-file scripts/shell-pane.ts open <session name>
  bun run --no-env-file scripts/shell-pane.ts run <pane> '<command>'
  bun run --no-env-file scripts/shell-pane.ts read <pane> <marker> [--timeout <ms>]
  bun run --no-env-file scripts/shell-pane.ts login <pane> github [--timeout <ms>]
  bun run --no-env-file scripts/shell-pane.ts close <workspace>`

export const SERVER = "playground-probes"
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LABEL = /^shell-[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/
const MARKER = /^__shell_pane_[0-9a-f]{12}$/
// no-raw-spawn's STARTS_CLAUDE: claude as a word, but not the .claude folder or a longer word
const CLAUDE = /(?<![.\w])claude(?!\w)/i
// the one set of characters run types: printable ASCII and space
const UNTYPED = /[^\x20-\x7e]/u

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
    .filter((entry) => {
      try {
        return new RegExp(entry.matcher).test("Bash")
      } catch {
        throw new Refusal(`shell-pane cannot read a registered hook's matcher: ${entry.matcher}`)
      }
    })
    .flatMap((entry) => entry.hooks.map((h) => h.command))
  const names = commands.map((command) => command.match(/scripts\/hooks\/([\w-]+)\.ts/)?.[1])
  const unread = commands.find((_, i) => !names[i])
  if (unread !== undefined)
    throw new Refusal(
      `shell-pane cannot run a registered Bash hook that names no scripts/hooks/<name>.ts: ${unread}`,
    )
  return [...new Set(names as string[])]
}

// The first refusal of a command typed in `cwd`, as the hooks give it: each registered Bash guard's check() over it as a Bash call of the session `session` names, then a word naming claude; a guard that cannot load or check refuses, as its hook does. Runs in the child screen() starts.
export async function screenHere(
  command: string,
  cwd: string,
  repo: string,
  session: string,
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
    session_id: session,
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

// screenHere() in a child bun started as the hooks start (no env file, in the main checkout, the session's id in its input), so the guards read the process state their hooks read; a child that fails refuses.
export async function screen(
  command: string,
  cwd: string,
  repo: string,
  session: string,
): Promise<string | undefined> {
  const child = Bun.spawn([process.execPath, "--no-env-file", import.meta.path, "screen"], {
    cwd: repo,
    env: process.env,
    stderr: "pipe",
    stdin: new Blob([JSON.stringify({ command, cwd, repo, session })]),
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  try {
    if (code === 0)
      return (JSON.parse(out.trim().split("\n").at(-1)!) as { reason?: string }).reason
  } catch {}
  return `shell-pane refuses: its screen exited ${code} (${err.trim().split("\n").at(-1) ?? ""})`
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
  // a control byte could edit the typed line itself (a Ctrl-U erasing the zsh -f prefix), a newline end it, outside every guard's view
  const odd = command.match(UNTYPED)?.[0]
  if (odd !== undefined)
    throw new Refusal(
      `shell-pane refuses a command holding U+${odd.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}: it types printable ASCII and space alone`,
    )
  const cwd = info.foreground_cwd || info.cwd
  if (!cwd)
    throw new Refusal(
      `shell-pane refuses ${pane}: herdr gave no folder for its shell, which the guards judge`,
    )
  const session = process.env.CLAUDE_CODE_SESSION_ID
  if (!session)
    throw new Refusal(
      "shell-pane refuses: no CLAUDE_CODE_SESSION_ID, so the guards cannot read this session's role as its hooks do",
    )
  const reason = await screen(command, cwd, repo, session)
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

// The one login the launcher drives, GitHub's browser login: with no token in its environment, which gh signs in with in place of a login, no browser opened on the owner's screen, and its input closed, so gh prints the code and the link and waits for the sign-in rather than for Enter.
export const GITHUB_LOGIN =
  "env -u GH_TOKEN -u GITHUB_TOKEN GH_BROWSER=true gh auth login --web --hostname github.com --git-protocol https --skip-ssh-key < /dev/null"
const DEVICE = "https://github.com/login/device"
const CODE = /one-time code\W+([A-Z0-9]{4}-[A-Z0-9]{4})\b/i

// The Inbox, as a session reaches it with bun run ask: post a card and print its id, then close it once the login ends.
export type Inbox = {
  close: (id: string, note: string) => Promise<void>
  post: (item: Json) => Promise<string>
}

// Runs in the main checkout with no POSTGRES_URL, where bun run ask goes on to the live dashboard's checkout (ask-from-clone.ts), so the card reaches the owner's Inbox from any worktree.
const ask = async (cwd: string, args: string[], stdin?: string) => {
  const { POSTGRES_URL: _, ...env } = process.env
  const child = Bun.spawn([process.execPath, "run", "ask", ...args], {
    cwd,
    env,
    stderr: "pipe",
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, err: err.trim(), out: out.trim() }
}

export const askInbox = (cwd: string): Inbox => ({
  close: async (id, note) => {
    if ((await ask(cwd, ["settle", id, "--note", note])).code === 0) return
    const acked = await ask(cwd, ["ack", id, "--no-link", note])
    if (acked.code !== 0) throw new Refusal(`bun run ask could not close ${id}: ${acked.err}`)
  },
  post: async (item) => {
    const posted = await ask(cwd, ["new"], JSON.stringify(item))
    if (posted.code !== 0 || !posted.out) throw new Refusal(`bun run ask new: ${posted.err}`)
    return posted.out.split("\n").at(-1)!
  },
})

// The owner's card: the code and the link alone, read from gh's own lines, so nothing else the pane shows reaches the Inbox.
export const loginCard = (from: string, code: string): Json => ({
  from,
  preview: {
    approve: "I signed in",
    deny: "I can't sign in now",
    text: [
      "```text",
      code,
      "```",
      "",
      `- 🌐 Open [github.com/login/device](${DEVICE}) and enter the code above.`,
      "- 🔒 GitHub asks for your password on its own page, never here.",
      "- ✅ This card clears itself once gh sees the sign-in.",
    ].join("\n"),
    type: "ask",
  },
  title: `Sign in to GitHub for ${from}`,
})

// Runs GitHub's login in a pane through run(), posts the owner a card with gh's one-time code and link, waits for the login's marker, then closes the card. It returns the card's id and the exit status, and nothing the pane printed, so no line gh writes reaches the session.
export async function login(
  pane: string,
  timeout: number,
  herdr: Herdr = herdrCli,
  inbox: Inbox = askInbox(mainCheckout()),
  repo = mainCheckout(),
  wait = (ms: number) => Bun.sleep(ms),
): Promise<{ id: string; rc?: number }> {
  const marker = await run(pane, GITHUB_LOGIN, herdr, repo)
  const { pane: info } = await call(herdr, ["pane", "get", pane])
  const from = (await labelOf(herdr, info.workspace_id)).replace(/^shell-|-\d+$/g, "")
  let code: string | undefined
  for (let tries = 0; !code && tries < 60; tries++) {
    if (tries) await wait(500)
    const seen = await herdr([
      "pane",
      "read",
      pane,
      "--source",
      "recent-unwrapped",
      "--lines",
      "200",
    ])
    const { output, rc } = since(seen.code === 0 ? seen.out : "", marker)
    if (output.includes(DEVICE)) code = CODE.exec(output)?.[1]
    if (!code && rc !== undefined)
      throw new Refusal(`gh auth login ended rc=${rc} before it printed a one-time code`)
  }
  if (!code) throw new Refusal("gh auth login printed no one-time code in 30 s")
  const id = await inbox.post(loginCard(from, code)).catch((error: Error) => {
    throw new Refusal(
      `${error.message}; gh's login still waits in ${pane} until its code expires, so close its workspace`,
    )
  })
  const { rc } = await read(pane, marker, timeout, herdr)
  await inbox.close(
    id,
    rc === 0
      ? "Signed in: gh saw the login finish"
      : rc === undefined
        ? "No sign-in seen in time: ask again for a new code"
        : `gh's login ended rc=${rc}: ask again for a new code`,
  )
  return { id, rc }
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

export async function main(
  argv: string[],
  herdr: Herdr = herdrCli,
  inbox: Inbox = askInbox(mainCheckout()),
): Promise<number> {
  const [verb, first, second, ...rest] = argv
  try {
    if (verb === "open" && first && !second) {
      const made = await open(first, process.cwd(), herdr)
      console.log(`pane ${made.pane} workspace ${made.workspace} label ${made.label}`)
      return 0
    }
    if ((verb === "run" || verb === "login") && !process.execArgv.includes("--no-env-file"))
      throw new Refusal(
        `shell-pane ${verb} takes bun run --no-env-file, as the hooks run with no env file, so no worktree .env reaches the guards`,
      )
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
    if (verb === "login" && first && second === "github") {
      const at = rest.indexOf("--timeout")
      const timeout = at === -1 ? 900_000 : Number(rest[at + 1])
      if (!Number.isInteger(timeout) || timeout <= 0) throw new Refusal(USAGE)
      const { id, rc } = await login(first, timeout, herdr, inbox)
      console.log(
        rc === 0
          ? `signed in; card ${id} closed`
          : `no sign-in (rc=${rc ?? "unknown"}); card ${id} closed`,
      )
      return rc === 0 ? 0 : rc === undefined ? 2 : 1
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

if (import.meta.main) {
  if (process.argv[2] === "screen") {
    const input = JSON.parse(await Bun.stdin.text())
    const reason = await screenHere(input.command, input.cwd, input.repo, input.session)
    console.log(JSON.stringify({ reason }))
    process.exit(0)
  }
  process.exit(await main(process.argv.slice(2)))
}
