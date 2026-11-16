// PreToolUse hook: refuses a command whose program name is not spelled plainly (a glob, a zsh group, a brace list, an ANSI-C escape, or an expansion but a HOME or PLAYGROUND_REPO folder), since each guard that reads a program by its name missed one new spelling of it after another; a plain name is one every guard reads.
import { type Env, knownVariables, lex, marked, plainProgram, run, type Visit } from "./shell"

const visit: Visit = async (cmd, { first }, at) => {
  if (!first || cmd.casePattern || plainProgram(first, at)) return
  const typed = first.source ?? first.value
  const held = /^"?\$\{?([A-Za-z_]\w*)\}?"?$/.exec(typed)?.[1]
  const value = held === undefined ? undefined : at.vars.get(held)
  const rewrite =
    value && !value.unknown && !marked(value.value) && value.value.trim()
      ? ` Here, write \`${value.value}\` in place of \`${typed}\`.`
      : ""
  return `no-hidden-program hook refuses a program name it cannot read as one plain name: \`${typed}\` is a pattern, a brace list, an escape or an expansion, and each guard reads a program by its name. Spell the program's name or path as plain text; a quoted or escaped name, ~, $HOME and $PLAYGROUND_REPO are fine.${rewrite}`
}

async function inspect(raw: string, environment: Record<string, string | undefined>) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as Record<string, unknown>
  if (tool !== "Bash") return
  const command = (toolInput as { command?: unknown } | null)?.command
  if (typeof command !== "string") return
  const directory = typeof cwd === "string" ? cwd : undefined
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit)
}

// Fails closed: a call it cannot read is refused, since a program it cannot read is the case it is for.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch (error) {
    return `no-hidden-program hook could not read this call (${error}), so it refuses it. Split it into plain commands and run them again.`
  }
}
