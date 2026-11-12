import { join } from "node:path"

import { checkoutRoot } from "@/lib/dashboard/fixture"
import { runArgv } from "@/lib/dashboard/run-argv"

// Pure: the text of a draft with no link, a public post's (the public rule), or undefined for any other item: every draft names where it lands or why it has none (noLink), and a message to a colleague carries its Slack or Linear link.
export function publicDraftText(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const { kind, preview } = input as { kind?: unknown; preview?: unknown }
  if (kind !== "draft" || typeof preview !== "object" || preview === null) return undefined
  const { link, text } = preview as { link?: unknown; text?: unknown }
  return link === undefined && typeof text === "string" ? text : undefined
}

// Why bun run ask refuses a draft, or null: a public post's text goes to scripts/hooks/public-draft.ts as a child (run-argv.ts's run), so the leak guards' finders and lists it reads with stay out of the API's own graph; exit 2 is a refusal on its last stderr line and 0 posts, and any other exit, or an exit 2 that names nothing, refuses too, since a draft the check could not read must not post.
export async function publicDraftRefusal(
  input: unknown,
  { root = checkoutRoot(), run = runArgv }: { root?: string | null; run?: typeof runArgv } = {},
): Promise<string | null> {
  const text = publicDraftText(input)
  if (text === undefined) return null
  if (!root) return "this ask has no checkout to run the public-draft check from"
  const { code, err } = await run([
    process.execPath,
    "--no-env-file",
    join(root, "scripts", "hooks", "public-draft.ts"),
    text,
  ])
  if (code === 0) return null
  const reason = err.split("\n").at(-1) ?? ""
  if (code === 2 && reason) return reason
  return `the public-draft check failed (exit ${code}${reason ? `: ${reason}` : ""}), so this draft posts nothing; run bun install in ${root} when a module is missing, then post again`
}
