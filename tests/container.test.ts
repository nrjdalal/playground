import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { testContainerName } from "./container"

const ROOT = join(import.meta.dir, "..")

test("a test container's name reads playground-test-<suite>-<pid>, the runner's pid last (#1480)", () => {
  expect(testContainerName("ask")).toBe(`playground-test-ask-${process.pid}`)
  expect(testContainerName("dashboard-ingest")).toMatch(/^playground-test-[a-z0-9-]+-\d+$/)
})

// The matcher reads docker and run from parts, so this file's own text never holds the argv start the scan below looks for.
const START = new RegExp(`"${"docker"}"\\s*,\\s*"${"run"}",`, "g")
// A start is an argv handed to a spawn call; a bare array in a fixture table holds no opener and starts nothing.
const OPENER = /spawn(?:Sync)?\(\s*\[?\s*$/
// A fixture that passes an argv to a spawn yet starts nothing marks itself this way on a line above, naming why.
const NOT_A_START = "not a container start:"

const walk = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

test("every docker run a test starts names its container playground-test-<suite>-<pid> (#1480)", () => {
  const unnamed: string[] = []
  for (const file of walk(join(ROOT, "tests"))) {
    const text = readFileSync(file, "utf8")
    for (const m of text.matchAll(START)) {
      const upto = text.slice(0, m.index!)
      const lines = upto.split("\n")
      const lineStart = upto.lastIndexOf("\n") + 1
      const window = [...lines.slice(-5), upto.slice(lineStart)].join("\n")
      if (!OPENER.test(window)) continue
      if (window.includes(NOT_A_START)) continue
      const raw = text.slice(m.index!, m.index! + 2000).split(/\]\s*[),]/)[0] ?? ""
      const argv: string[] = raw.match(/"([^"\\]|\\.)*"/g) ?? []
      const at = argv.indexOf(`"${"--name"}"`)
      // the name arrives as the helper's call or as the literal it returns, and only once, since docker keeps a start's last --name
      const names = argv.filter((word) => word.startsWith(`"${"--name"}`)).length
      const named =
        at !== -1 &&
        names === 1 &&
        (/^"playground-test-[a-z0-9-]+-\d+"$/.test(argv[at + 1] ?? "") ||
          new RegExp(`${"testContainerName"}\\("[a-z0-9-]+"\\)`).test(raw))
      if (!named) unnamed.push(`${relative(ROOT, file)}:${lines.length}`)
    }
  }
  expect(unnamed).toEqual([])
})
