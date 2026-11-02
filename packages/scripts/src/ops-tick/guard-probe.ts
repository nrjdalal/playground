import { unlink } from "node:fs/promises"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"
import type { Context } from "./tick"

type Settings = { hooks: Record<string, { hooks: { command: string }[] }[]> }

// The PreToolUse guards the factory's settings register, each by its script's name, once.
export const preToolUseGuards = async (repo: string): Promise<string[]> => {
  const settings = (await Bun.file(
    join(repo, "scripts", "factory-settings.json"),
  ).json()) as Settings
  const names = (settings.hooks.PreToolUse ?? []).flatMap((entry) =>
    entry.hooks.map((hook) => hook.command.match(/scripts\/hooks\/([\w-]+)\.ts/)?.[1]),
  )
  return [...new Set(names.filter((name): name is string => !!name))]
}

// Each guard's own exit on an empty input, run as its wrapper runs it but without the wrapper's tail, which turns a crash into a refusal: 0 or 2 is a guard that starts, and any other exit, a missing script's included, is one whose wrapper refuses every factory call it guards; the dispatcher is told once a change of what is broken, and the state is kept in tick/guard-probe.json.
export const guardProbe = async (ctx: Context) => {
  const statePath = join(ctx.ops, "tick", "guard-probe.json")
  const broken: string[] = []
  for (const name of await preToolUseGuards(ctx.repo)) {
    const { code, out } = await ctx.run(
      [
        "sh",
        "-c",
        'cd -P "$1" && exec bun --no-env-file "scripts/hooks/$2.ts"',
        "guard-probe",
        ctx.repo,
        name,
      ],
      30_000,
      "{}",
    )
    if (code === 0 || code === 2) continue
    const why = out.trim().split("\n").at(-1)?.slice(0, 80)
    broken.push(`${name} (exit ${code}${why ? `: ${why}` : ""})`)
  }
  const told = (await Bun.file(statePath)
    .json()
    .catch(() => null)) as { text?: string } | null
  if (!broken.length) {
    if (told) await unlink(statePath)
    return
  }
  const text = `PreToolUse guards that cannot start, so their wrappers refuse every factory call they guard: ${broken.join("; ")}. Fix: bun install in ${ctx.repo}`
  if (told?.text === text) return
  if (await ctx.send("dispatcher", text, true))
    await writeAtomic(statePath, JSON.stringify({ text }))
}
