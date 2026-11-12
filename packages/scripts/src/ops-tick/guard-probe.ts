import { unlink } from "node:fs/promises"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"
import type { Context } from "./tick"

type Settings = { hooks: Record<string, { hooks: { command: string }[] }[]> }

// The PreToolUse guards the factory's settings register, each by its script's name, once.
export const preToolUseGuards = async (repo: string): Promise<string[]> =>
  guardsIn(await Bun.file(join(repo, "scripts", "factory-settings.json")).text())

// The same, from the settings file's text, so hooks-bundle can read it from a tree git holds.
export const guardsIn = (text: string): string[] => {
  const settings = JSON.parse(text) as Settings
  const names = (settings.hooks.PreToolUse ?? []).flatMap((entry) =>
    entry.hooks.map((hook) => hook.command.match(/scripts\/hooks\/bundled\/([\w-]+)\.js/)?.[1]),
  )
  return [...new Set(names.filter((name): name is string => !!name))]
}

// Each guard's own exit on an empty input, run as its wrapper runs it but without the wrapper's tail, which turns a crash into a refusal: 0 or 2 is a guard that starts, and any other exit, a missing script's included, is one whose wrapper refuses every factory call it guards; the dispatcher is told once a change of what is broken, and the state is kept in tick/guard-probe.json.
export const guardProbe = async (ctx: Context) => {
  const statePath = join(ctx.ops, "tick", "guard-probe.json")
  const guards = await preToolUseGuards(ctx.repo)
  const broken: string[] = []
  for (const name of guards) {
    const { code, out } = await ctx.run(
      [
        "sh",
        "-c",
        'cd -P "$1" && s="scripts/hooks/bundled/$2.js" && { [ -f "$s" ] || s="scripts/hooks/$2.ts"; } && exec bun --no-env-file "$s"',
        "guard-probe",
        ctx.repo,
        name,
      ],
      30_000,
      "{}",
    )
    if (code === 0 || code === 2) continue
    const lines = out.split("\n").map((line) => line.trim())
    const why = (lines.find((line) => /^error:/i.test(line)) ?? lines.find(Boolean))?.slice(0, 80)
    broken.push(`${name} (exit ${code}${why ? `: ${why}` : ""})`)
  }
  const told = (await Bun.file(statePath)
    .json()
    .catch(() => null)) as { text?: string } | null
  if (!broken.length) {
    if (told) await unlink(statePath)
    return
  }
  // The count and the fix lead, since notify.sh cuts a line at 400 characters and every guard breaks at once when Bun or the bundles are gone.
  const text = `${broken.length} of ${guards.length} PreToolUse guards cannot start, so their wrappers refuse every factory call they guard. Fix: git checkout scripts/hooks/bundled, or bun run hooks:bundle, in ${ctx.repo}. ${broken.join("; ")}`
  if (told?.text === text) return
  if (await ctx.send("dispatcher", text, true))
    await writeAtomic(statePath, JSON.stringify({ text }))
}
