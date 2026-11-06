import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", "..")
// The fixture's path as an import names it, built so this file's own text imports nothing: its reader, refused-forms.ts, or a file in its folder, refused-forms/.
const FIXTURE = "./fixtures/" + "refused-forms"
const IMPORTS =
  /(?:from|import|require)\s*\(?\s*["'][^"']*\/refused-forms(?:\/[^"']+)?(?:\.ts)?["']/
// The fixture's own files, its reader and its folder, which import each other; a source's file holds rows that name RUNS' words as data, and imports only ./_shared.
const OWN = /^tests\/scripts\/hooks\/fixtures\/refused-forms(?:\.ts|\/[^/]+\.ts)$/
// The ways a file can run a command, any of which could turn a row from data into a run.
const RUNS = ["Bun.spawn", "spawnSync", "child_process", "$`", "exec("]

type File = { path: string; text: string }

// Each file that imports the fixture from outside the fixture itself, tests/scripts/hooks/*.test.ts and the shell-pane launcher's test, which feeds its rows to every registered guard through the launcher's screen, and each importer that names a way to run a command.
function offenders(files: File[]): string[] {
  const found: string[] = []
  for (const { path, text } of files) {
    if (!IMPORTS.test(text)) continue
    if (!OWN.test(path) && !/^tests\/scripts\/(?:hooks\/[^/]+|shell-pane)\.test\.ts$/.test(path))
      found.push(`${path} imports it`)
    for (const word of RUNS) if (text.includes(word)) found.push(`${path} names ${word}`)
  }
  return found
}

async function repoFiles(): Promise<File[]> {
  const listed = Bun.spawnSync([
    "git",
    "-C",
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ])
  const paths = listed.stdout
    .toString()
    .split("\n")
    .filter((path) => /\.(?:[cm]?[jt]s|tsx)$/.test(path))
  return Promise.all(
    paths.map(async (path) => {
      const file = Bun.file(join(root, path))
      return { path, text: (await file.exists()) ? await file.text() : "" }
    }),
  )
}

describe("the refused-forms fixture's rows reach a guard only as check() input", () => {
  test("only a hooks test or the shell-pane test imports the fixture, and none of its importers names a way to run a command", async () => {
    const files = await repoFiles()
    expect(files.filter((file) => IMPORTS.test(file.text)).map((file) => file.path)).toContain(
      "tests/scripts/hooks/refused-forms.test.ts",
    )
    expect(offenders(files)).toEqual([])
  })

  test("scratch-git.ts, the git runner refused-forms.test.ts calls, imports neither the fixture nor a file that imports it", async () => {
    const helper = await Bun.file(join(import.meta.dir, "scratch-git.ts")).text()
    expect(IMPORTS.test(helper)).toBe(false)
    const local = [...helper.matchAll(/(?:from|import|require)\s*\(?\s*["'](\.[^"']+)["']/g)].map(
      (m) => m[1]!,
    )
    for (const specifier of local) {
      const base = join(import.meta.dir, specifier)
      const file = [base, `${base}.ts`].map((path) => Bun.file(path))
      const text = (await file[0]!.exists()) ? await file[0]!.text() : await file[1]!.text()
      expect(IMPORTS.test(text)).toBe(false)
    }
  })

  test.each([
    ["Bun.spawn", `Bun.spawn(["sh", "-c", row])`],
    ["spawnSync", `spawnSync("sh", ["-c", row])`],
    ["child_process", `import { exec } from "node:child_process"`],
    ["$`", "await $`${row}`"],
    ["exec(", `exec(row)`],
  ])("an importer naming %s is caught", (word, line) => {
    const text = `import { REFUSED_FORMS } from "${FIXTURE}"\n${line}\n`
    expect(offenders([{ path: "tests/scripts/hooks/x.test.ts", text }])).toContain(
      `tests/scripts/hooks/x.test.ts names ${word}`,
    )
  })

  test.each([
    ["a static import", `import { REFUSED_FORMS } from "${FIXTURE}"`],
    ["a dynamic import", `const forms = await import("${FIXTURE}.ts")`],
    ["a require", `const forms = require("${FIXTURE}")`],
    ["a static import of one source's file", `import { groups } from "${FIXTURE}/356"`],
    ["a dynamic import of one source's file", `const forms = await import("${FIXTURE}/356.ts")`],
  ])("%s from outside the hooks tests is caught", (_, text) => {
    expect(offenders([{ path: "tests/scripts/other.ts", text }])).toEqual([
      "tests/scripts/other.ts imports it",
    ])
  })
})
