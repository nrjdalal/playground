// A check for the factory's sessions, run on Bash by guards.ts, so it has no main block of its own: refuses a Vercel CLI call (vercel or vc, behind any wrapper, bun x, bunx or npx) that moves what production serves (a production deploy, which also migrates the hosted database, a redeploy, a promote, a rollback, an alias or a rolling release), but for the Ops lead in a call that names no role variable and sources no file, and one that writes the project's secrets to disk, prints them or hands them to a command (env pull, pull, env ls --json, env run, link, an integration add that pulls the env) or writes through vercel api or reads its /env, for every session; reads, previews and help run.
import { toolWords } from "./no-main-checkout"
import { namesRole, opsLead } from "./role"
import { type Env, lex, parseFlags, run, unreadable, type Visit, type Word } from "./shell"

type Environment = Record<string, string | undefined>
type Verdict = { production: boolean; what: string }

const NAMES = ["vc", "vercel"]
// vercel 65.8.0's options that take a value, global and of the commands judged here, from each one's --help.
const TAKES = new Set([
  "--archive",
  "--build-env",
  "--cwd",
  "--env",
  "--environment",
  "--field",
  "--generate",
  "--git-branch",
  "--global-config",
  "--header",
  "--input",
  "--local-config",
  "--meta",
  "--method",
  "--project",
  "--raw-field",
  "--regions",
  "--scope",
  "--spec-url",
  "--target",
  "--timeout",
  "--token",
  "-A",
  "-e",
  "-F",
  "-f",
  "-H",
  "-p",
  "-Q",
  "-S",
  "-t",
  "-X",
])
// vercel 65.8.0's commands (`vercel --help`) and their short names; any other first word is the path the default command, deploy, takes.
const COMMANDS = new Set(
  "activity agent agent-runs ai-gateway alerts alias api bisect blob budgets build buy cache certs changelog ci comments connect contract crons curl daemons deploy deploy-hooks dev dns domains drains env environments feedback firewall flags git global-config health help httpstat init inspect install integration kms link list login logout logs ls mcp metrics microfrontends monitors open organizations pricing project promote pull redeploy redirects remove rm rollback rolling-release routes sandbox schedules security setup signup skills storage switch teams telemetry token-pass tokens traces upgrade usage vcr version webhooks whoami".split(
    " ",
  ),
)
const HELP = new Set(["--help", "--version", "-h", "-v"])
const API_BODY = new Set(["--field", "--input", "--raw-field", "-F", "-f"])

const MENTION = /\bv(?:ercel|c)\b/i
// vercel or vc as a word of its own (an assignment's value, a tool at a version), so a program built at run time on such a line may be it.
const NAMED = /(?:^|[\s=;&|(`'"])v(?:ercel|c)(?=$|[\s;&|)`'"@])/i

// What one vercel call does that the hook refuses, or undefined when it reads, deploys a preview or prints help.
function judge(args: Word[], fed: boolean): Verdict | undefined {
  const { flags, positionals } = parseFlags(args, TAKES)
  if (flags.some((f) => HELP.has(f.name))) return
  const [sub, ...rest] = positionals
  if (sub && unreadable(sub)) return { production: false, what: "a subcommand built at run time" }
  const built = fed || args.some(unreadable)
  const has = (...names: string[]) => flags.some((f) => names.includes(f.name))
  // whether the last of these flags names production, or one it cannot read; absent, the command's own default
  const toProduction = (names: string[], absent: boolean) => {
    const flag = flags.findLast((f) => names.includes(f.name))
    if (!flag) return absent
    return !flag.value || unreadable(flag.value) || flag.value.value.toLowerCase() === "production"
  }
  const next = rest[0]?.value
  const name = sub?.value
  if (name === undefined || name === "deploy" || !COMMANDS.has(name))
    return has("--prod") || toProduction(["--environment", "--target"], false) || built
      ? { production: true, what: "a production deploy" }
      : undefined
  if (name === "redeploy")
    return toProduction(["--environment", "-e", "--target"], true) || built
      ? { production: true, what: "a redeploy that may land in production" }
      : undefined
  if (name === "promote" || name === "rollback")
    return next === "status" ? undefined : { production: true, what: `a ${name}` }
  if (name === "alias")
    return next === undefined || next === "list" || next === "ls"
      ? undefined
      : { production: true, what: "an alias change" }
  if (name === "rolling-release")
    return next === "inspect" ? undefined : { production: true, what: "a rolling release step" }
  if (name === "link") return { production: false, what: "a vercel link, which pulls the env" }
  if (name === "pull") return { production: false, what: "a vercel pull, which pulls the env" }
  if (name === "integration")
    return next === "add" && !has("--no-env-pull")
      ? { production: false, what: "an integration add without --no-env-pull" }
      : undefined
  if (name === "env") {
    if (rest[0] && unreadable(rest[0]))
      return { production: false, what: "an env subcommand built at run time" }
    if (next === "pull" || next === "run") return { production: false, what: `an env ${next}` }
    if ((next === "ls" || next === "list") && (has("--json") || built))
      return { production: false, what: "an env list with its values" }
    return
  }
  if (name === "api") return judgeApi(rest, flags, built)
}

// A vercel api call: a write (a method other than GET, or a body, which makes it a POST) or a read of a project's env.
function judgeApi(
  rest: Word[],
  flags: ReturnType<typeof parseFlags>["flags"],
  built: boolean,
): Verdict | undefined {
  const [endpoint] = rest
  if (!endpoint || endpoint.value === "list") return
  if (built) return { production: false, what: "a vercel api call built at run time" }
  const method = flags.findLast((f) => f.name === "-X" || f.name === "--method")
  if (method && (!method.value || method.value.value.toUpperCase() !== "GET"))
    return { production: false, what: "a vercel api write" }
  if (!method && flags.some((f) => API_BODY.has(f.name)))
    return { production: false, what: "a vercel api write, a body making it a POST" }
  if (/(?:^|\/)env(?:[/?#]|$)/i.test(endpoint.value))
    return { production: false, what: "a vercel api read of a project's env" }
}

export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  const {
    cwd,
    tool_input: toolInput,
    tool_name: tool,
  } = JSON.parse(raw) as {
    cwd?: unknown
    tool_input?: { command?: unknown }
    tool_name?: unknown
  }
  if (tool !== "Bash" || typeof toolInput?.command !== "string") return
  const command = toolInput.command
  if (!MENTION.test(command.replace(/["'\\]/g, ""))) return
  const verdicts: Verdict[] = []
  const visit: Visit = async (_cmd, parsed, shell) => {
    if (parsed.first && unreadable(parsed.first) && NAMED.test(command))
      verdicts.push({
        production: false,
        what: "a program built at run time on a line naming vercel",
      })
    const words = toolWords(NAMES, parsed.name, parsed.args, shell)
    // xargs hands it words from stdin, which the hook cannot read
    const verdict = words && judge(words, parsed.xargs !== undefined)
    if (verdict) verdicts.push(verdict)
    return undefined
  }
  const env: Env = {
    cwd: typeof cwd === "string" ? cwd : undefined,
    files: new Map(),
    known: {},
    process: {},
    vars: new Map(),
  }
  await run(lex(command), env, visit)
  const always = verdicts.find((v) => !v.production)
  if (always)
    return `no-raw-vercel hook refuses ${always.what}: it writes the project's secrets to disk, prints them or hands them to a command, or writes through the API. The reads run: whoami, ls, inspect, logs, env ls without --json and a vercel api GET outside /env; a secret reaches a project through an Inbox secret ask.`
  const production = verdicts.find((v) => v.production)
  if (!production || ((await opsLead(raw, environment)) && !namesRole(command))) return
  return `no-raw-vercel hook refuses ${production.what}: it changes what production serves, and a production deploy also migrates the hosted database. Production ships from main through the release skill's ship:merge, which Vercel deploys from git; the Ops lead alone makes a hand production move, in a call that names no role variable and sources no file. A preview deploy (vercel deploy without --prod) and the reads (whoami, ls, inspect, logs) run.`
}
