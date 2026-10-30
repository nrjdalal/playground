import { context, ruleText } from "../../../../scripts/hooks/rules"

type Env = Record<string, string | undefined>

// `playground rules [<name>]`: every standing rule's glance, as a factory session starts with them, or one rule whole, each with this machine's values in its slots; a name takes a hyphen for a space.
export const runRules = async (
  args: string[],
  cwd: string,
  env: Env,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> => {
  if (args.length > 1) {
    err("usage: playground rules [<name>]")
    return 2
  }
  if (!args[0]) {
    out(await context(cwd, env))
    return 0
  }
  const name = args[0].replaceAll("-", " ")
  const text = await ruleText(name, cwd, env)
  if (!text) {
    err(`playground: no rule named ${name}; playground rules lists them`)
    return 1
  }
  out(text)
  return 0
}
