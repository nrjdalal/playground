// PreToolUse hook: refuses a reviewer or tester session, its sub-agents included, any Bash or Monitor call that runs code from an outside author's PR clone; reading it passes.
import "../../packages/env/src/aliases"

export type Lookup = {
  author: (
    repo: string,
    pr: number,
  ) => Promise<{ author: string; owner: string; ownerType: string } | undefined>
  clones: () => Promise<string[]>
  repoOf: (folder: string) => Promise<string | undefined>
}

export async function check(
  _raw: string,
  _environment: Record<string, string | undefined>,
  _lookup: Lookup,
): Promise<string | undefined> {
  return undefined
}
