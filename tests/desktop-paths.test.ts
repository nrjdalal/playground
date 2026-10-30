import { expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

// macOS guards the Desktop folder, so a pane herdr or Claude Code opens there fails until the owner grants Full Disk Access again after each update; the factory lives under its code root instead.
const DESKTOP_PATH = /(~|\$HOME|\$\{HOME\}|\/Users\/[^/\s"'`]+)\/Desktop\b|["']\/?Desktop["'/]/

// This file spells the paths it refuses, the research files are a record of where things lived, and a line marked as the folder the factory left names it as the one to leave.
const LEFT = "the folder the factory left"

const SKIPPED = ["tests/desktop-paths.test.ts", ".github/notes/plans/new-factory/research/"]

const offenders = (files: Record<string, string>): string[] =>
  Object.entries(files).flatMap(([file, text]) =>
    SKIPPED.some((skip) => file === skip || (skip.endsWith("/") && file.startsWith(skip)))
      ? []
      : text
          .split("\n")
          .flatMap((line, i) =>
            DESKTOP_PATH.test(line) && !line.includes(LEFT) ? [`${file}:${i + 1}`] : [],
          ),
  )

test("a Desktop path in any of its spellings is caught, and a mention of the folder, of Docker Desktop or a line marked as the folder the factory left is not", () => {
  expect(
    offenders({
      "a.sh": 'cd "$HOME/Desktop/acme-labs/x"',
      "b.md": "run it from `~/Desktop/acme-labs/x`",
      "c.ts": 'join(homedir(), "Desktop", "acme-labs")',
      "d.py": "os.path.join(home, 'Desktop', 'x')",
      "e.sh": "cd /Users/me/Desktop/acme/archive",
      "f.sh": 'cd "${HOME}/Desktop"',
      "i.ts": 'const dir = home + "/Desktop/acme-labs/x"',
      "j.py": "path = 'Desktop/acme-labs/x'",
      "k.sh": 'cd "$HOME/Desktop" # #1675',
      "g.md": "macOS guards the Desktop folder; install OrbStack or Docker Desktop",
      "h.sh": 'desktop="$HOME/Desktop/" # the folder the factory left',
      ".github/notes/plans/new-factory/research/r.md": "~/Desktop/acme/archive",
    }),
  ).toEqual([
    "a.sh:1",
    "b.md:1",
    "c.ts:1",
    "d.py:1",
    "e.sh:1",
    "f.sh:1",
    "i.ts:1",
    "j.py:1",
    "k.sh:1",
  ])
})

test("no tracked file names a path under the Desktop folder", async () => {
  const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT }).stdout.toString()
  const files: Record<string, string> = {}
  for (const file of listed.split("\0").filter(Boolean)) {
    const handle = Bun.file(join(ROOT, file))
    if (!(await handle.exists())) continue
    const bytes = new Uint8Array(await handle.arrayBuffer())
    if (!bytes.includes(0)) files[file] = new TextDecoder().decode(bytes)
  }
  expect(offenders(files)).toEqual([])
})
