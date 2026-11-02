import { join } from "node:path"

// A hook wrapper runs its script from the main checkout, which follows main, so a factory session on canary loses the hook's tool the moment canary registers a script main lacks; this check fails such a registration until a ship puts its script on main.

export type Wrapper = { file: string; line: number; scripts: string[] }

const SCRIPT = /scripts\/hooks\/(?:bundled\/)?[\w-]+\.(?:ts|js)/g
const RUNS = "bun --no-env-file"

// Pure: the wrappers in one file's text, each a line that runs a hook script with bun, with every script it may run (a bundle-then-source wrapper names two); a SKILL.md registers hooks in its frontmatter alone.
export function wrappersOf(file: string, text: string): Wrapper[] {
  const lines = text.split("\n")
  const end = !file.endsWith(".md")
    ? lines.length
    : lines[0] === "---"
      ? lines.indexOf("---", 1)
      : 0
  const wrappers: Wrapper[] = []
  for (const [i, line] of lines.slice(0, Math.max(end, 0)).entries()) {
    const scripts = [...new Set(line.match(SCRIPT) ?? [])]
    if (line.includes(RUNS) && scripts.length) wrappers.push({ file, line: i + 1, scripts })
  }
  return wrappers
}

const git = async (root: string, ...args: string[]) => {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stderr: "pipe", stdout: "pipe" })
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return { code, stdout }
}

// Every wrapper in the tracked settings and skill files under root whose scripts ref holds none of, as one line each; throws when ref does not read, so an unread main never passes.
export async function missingOn(root: string, ref: string): Promise<string[]> {
  if ((await git(root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)).code !== 0)
    throw new Error(
      `${ref} does not read in ${root}; fetch it (git fetch origin main) and run again`,
    )
  const listed = await git(
    root,
    "grep",
    "-l",
    "-e",
    RUNS,
    "--and",
    "-e",
    "scripts/hooks/",
    "--",
    "*.json",
    "*SKILL.md",
    ":!tests",
  )
  const missing: string[] = []
  for (const file of listed.stdout.split("\n").filter(Boolean)) {
    for (const wrapper of wrappersOf(file, await Bun.file(join(root, file)).text())) {
      const held = await Promise.all(
        wrapper.scripts.map(
          async (script) => (await git(root, "cat-file", "-e", `${ref}:${script}`)).code === 0,
        ),
      )
      if (!held.includes(true))
        missing.push(
          `${file}:${wrapper.line} runs ${wrapper.scripts.join(" or ")}, which ${ref} lacks: the main checkout follows main, so register a hook in the ship after its script`,
        )
    }
  }
  return missing
}

if (import.meta.main) {
  const root = (await git(".", "rev-parse", "--show-toplevel")).stdout.trim() || "."
  // a shallow checkout carries no origin/main, so fetch it, and fail below when even that does not read
  if ((await git(root, "rev-parse", "--verify", "--quiet", "origin/main^{commit}")).code !== 0)
    await git(root, "fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main")
  try {
    const missing = await missingOn(root, "origin/main")
    for (const line of missing) console.error(line)
    if (missing.length) process.exit(1)
    console.log("every hook registration runs a script origin/main holds")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
