import { appendFileSync } from "node:fs"

// The replays' gh: bin/gh on PATH answers each call from the replay's made-up recording, so a skill's GitHub reads come back the same every run; any call the recording lacks is a miss, which fails the replay.

export type GhRecorded = { argv: string[]; code?: number; stdout: string }

const ORG_FLAGS = new Set(["--owner"])
const REPO_FLAGS = new Set(["-R", "--repo"])

const unquote = (token: string) => token.replace(/^["']+|["']+$/g, "")

// Pure: the call with its org written `<org>` and a pull request's URL as its number, so a skill naming its company's org and one reading it from config ask the same thing.
export const normalise = (argv: string[]): string[] =>
  argv.flatMap((token, i) => {
    const at = token.indexOf("=")
    const [flag, value] = at < 0 ? [token, undefined] : [token.slice(0, at), token.slice(at + 1)]
    const previous = argv[i - 1] ?? ""
    if (ORG_FLAGS.has(previous)) return ["<org>"]
    if (REPO_FLAGS.has(previous)) return [token.replace(/^[^/]+\//, "<org>/")]
    if (value !== undefined && ORG_FLAGS.has(flag)) return [`${flag}=<org>`]
    if (value !== undefined && REPO_FLAGS.has(flag))
      return [`${flag}=${value.replace(/^[^/]+\//, "<org>/")}`]
    const pull = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)\/?$/.exec(unquote(token))
    if (pull) return [pull[1]!]
    return [unquote(token).replace(/(^|\/)repos\/[^/]+\//, "$1repos/<org>/")]
  })

// Pure: whether every token of the recorded argv appears in the call, in order.
const within = (want: string[], got: string[]): boolean => {
  let at = 0
  for (const token of got) if (at < want.length && unquote(want[at]!) === token) at++
  return at === want.length
}

// Pure: the recorded answer whose argv the call holds, the longest first, so a specific entry wins over a general one.
export const ghRecorded = (recording: GhRecorded[], argv: string[]): GhRecorded | undefined => {
  const call = normalise(argv)
  return recording
    .filter((entry) => within(entry.argv, call))
    .sort((a, b) => b.argv.length - a.argv.length)[0]
}

// gh signed in on the made-up host, whatever the recording holds, since a skill checks it before its first read.
const AUTH_STATUS =
  "github.example.test\n  ✓ Logged in to github.example.test account made-up-owner (keyring)\n"

// One gh call: its recorded stdout and exit code, or a miss on stderr and in the log (PARITY_MISSES), exit 1.
export const main = async (
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<number> => {
  const recording = env.PARITY_GH ? ((await Bun.file(env.PARITY_GH).json()) as GhRecorded[]) : []
  if (argv[0] === "auth" && argv[1] === "status") {
    process.stdout.write(AUTH_STATUS)
    return 0
  }
  const hit = ghRecorded(recording, argv)
  if (hit) {
    process.stdout.write(hit.stdout)
    return hit.code ?? 0
  }
  if (env.PARITY_MISSES)
    appendFileSync(env.PARITY_MISSES, `${JSON.stringify({ argv, kind: "miss", server: "gh" })}\n`)
  process.stderr.write(`gh: not in the recording: ${argv.join(" ")}\n`)
  return 1
}
