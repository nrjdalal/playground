import { join } from "node:path"

import { GUARDS } from "../../../scripts/hooks/guards"

const ROOT = join(import.meta.dir, "..", "..", "..")
const RUN_BY_GUARDS = new Set(GUARDS.map((g) => g.name))

export type Hook = {
  args?: string[]
  command: string
  onFailure?: string
  timeout?: number
  type: string
}
export type Entry = { hooks: Hook[]; matcher: string }

// Whether a hook runs the guard: a shell-form hook names its bundle in its command, and the exec-form hook runs guards.ts, which runs every guard GUARDS names.
export const runs = (hook: Hook, guard: string) =>
  hook.args
    ? hook.args.join(" ").includes("scripts/hooks/bundled/guards.js") && RUN_BY_GUARDS.has(guard)
    : hook.command.includes(`scripts/hooks/bundled/${guard}.js`)

// Each PreToolUse entry of a settings file, or a skill's frontmatter read as one, that runs the guard.
export const entriesOf = (pre: Entry[], guard: string) =>
  pre.filter((entry) => entry.hooks.some((hook) => runs(hook, guard)))

// Each PreToolUse entry of a settings file that runs the guard, read from the file.
export async function registered(file: string, guard: string): Promise<Entry[]> {
  const settings = (await Bun.file(join(ROOT, file)).json()) as {
    hooks: { PreToolUse: Entry[] }
  }
  return entriesOf(settings.hooks.PreToolUse, guard)
}

// Whether a call of the tool reaches the guard through any entry of the file.
export async function hears(file: string, guard: string, tool: string): Promise<boolean> {
  return (await registered(file, guard)).some((entry) => new RegExp(entry.matcher).test(tool))
}

// A tester whose test(tool) says whether a call of the tool reaches the guard through any entry of the file, for a test that reads a matcher.
export async function hearing(
  file: string,
  guard: string,
): Promise<{ test: (tool: string) => boolean }> {
  const entries = await registered(file, guard)
  return { test: (tool) => entries.some((entry) => new RegExp(entry.matcher).test(tool)) }
}
