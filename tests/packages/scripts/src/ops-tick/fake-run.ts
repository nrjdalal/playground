import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

// One command's answer: what it writes to stdout and to stderr, and its exit code.
export type Answer = { code?: number; err?: string; out?: string }

// What fakeRun answers, by the first key a command's joined argv holds: an Answer, or a string as its stdout alone.
export type Answers = Record<string, Answer | string>

// gh api graphql's answer with errors, as measured: the body on stdout with no newline after it, its failed aliases null in data, each error's message on stderr after "gh: ", and exit 1.
export const ghErrors = (repository: Record<string, unknown>, messages: string[]): Answer => ({
  code: 1,
  err: `gh: ${messages.join("\n")}\n`,
  out: JSON.stringify({ data: { repository }, errors: messages.map((message) => ({ message })) }),
})

// bun run's own stderr around the script's, as measured: "$ <command>" first unless --silent, the script's name standing in for its command, then "error: script ... exited" when it fails.
const bunRunErr = (argv: string[], code: number, err: string): string => {
  const rest = argv.slice(2)
  if (rest.includes("--silent")) return err
  const at = rest.findIndex((arg, i) => !arg.startsWith("--") && rest[i - 1] !== "--cwd")
  const echo = `$ ${rest.slice(at).join(" ")}\n`
  const failed = code === 0 ? "" : `error: script "${rest[at]}" exited with code ${code}\n`
  return `${echo}${err}${failed}`
}

// A fake ctx.run that answers each command by the first key its argv, joined by spaces, holds, and returns out as the real run does: stdout, then stderr, with bun run's own lines; a string answer is stdout alone. Every argv and stdin is recorded.
export const fakeRun = (answers: Answers = {}) => {
  const runs: string[][] = []
  const inputs: string[] = []
  const run: Context["run"] = async (argv, _timeoutMs, stdin) => {
    runs.push(argv)
    if (stdin) inputs.push(stdin)
    const line = argv.join(" ")
    const key = Object.keys(answers).find((k) => line.includes(k))
    const answer = key === undefined ? {} : answers[key]!
    const { code = 0, err = "", out = "" } = typeof answer === "string" ? { out: answer } : answer
    const bunRun = argv[0] === "bun" && argv[1] === "run"
    return { code, out: out + (bunRun ? bunRunErr(argv, code, err) : err) }
  }
  return { inputs, run, runs }
}
