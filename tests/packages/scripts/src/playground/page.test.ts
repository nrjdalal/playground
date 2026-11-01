import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/playground/cli.ts")
const dir = mkdtempSync(join(tmpdir(), "dispatcher-page-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

// A scratch config folder whose roster lists two sessions, and an open that writes what it was given, so a call to open leaves a file the test checks for.
const setup = async () => {
  const root = mkdtempSync(join(dir, "run-"))
  const config = join(root, "claude")
  await Bun.write(
    join(config, "playground", "roster.json"),
    JSON.stringify({ agents: [{ name: "planner" }, { name: "vwrv7f-worker" }] }),
  )
  const bin = join(root, "bin")
  await Bun.write(join(bin, "open"), `#!/bin/sh\necho "$@" >> ${join(root, "opened")}\n`)
  chmodSync(join(bin, "open"), 0o755)
  const page = (...args: string[]) => {
    const run = Bun.spawnSync([process.execPath, "--no-env-file", CLI, "page", ...args], {
      env: {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
        HOME: root,
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      },
      stderr: "pipe",
      stdout: "pipe",
    })
    return { code: run.exitCode, err: run.stderr.toString(), out: run.stdout.toString() }
  }
  return {
    opened: join(root, "opened"),
    page,
    previews: join(config, "playground", "previews"),
    root,
  }
}

describe("playground page (#1850)", () => {
  test("copies the page, writes its caption, appends its line, opens nothing, and takes a free name on a clash", async () => {
    const { opened, page, previews, root } = await setup()
    const file = join(root, "lookup.html")
    await Bun.write(file, "<!doctype html><title>Lookup</title>")
    const by = ["--title", "Property lookup", "--by", "vwrv7f-worker", "--for", "planner"]
    expect(page(file, ...by).code).toBe(0)
    expect(page(file, "--title", "Again", "--by", "planner").code).toBe(0)
    expect(readFileSync(join(previews, "lookup.html"), "utf8")).toBe(
      "<!doctype html><title>Lookup</title>",
    )
    expect(readFileSync(join(previews, "lookup.txt"), "utf8")).toBe("Property lookup\n")
    expect(readFileSync(join(previews, "lookup-2.txt"), "utf8")).toBe("Again\n")
    const lines = readFileSync(join(previews, "pages.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(lines.map(({ at: _, ...rest }) => rest)).toEqual([
      { by: "vwrv7f-worker", file: "lookup.html", for: "planner", title: "Property lookup" },
      { by: "planner", file: "lookup-2.html", for: null, title: "Again" },
    ])
    expect(Number.isNaN(Date.parse(lines[0].at))).toBe(false)
    expect(existsSync(opened)).toBe(false)
  })

  test("refuses a file that is not HTML and a --by or --for the roster does not list", async () => {
    const { page, previews, root } = await setup()
    const png = join(root, "shot.png")
    await Bun.write(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const binary = join(root, "binary.html")
    await Bun.write(binary, new Uint8Array([0xff, 0xfe, 0x00, 0x80]))
    const html = join(root, "ok.html")
    await Bun.write(html, "<p>ok</p>")
    const refusals = [
      page(png, "--title", "Shot", "--by", "planner"),
      page(binary, "--title", "Binary", "--by", "planner"),
      page(html, "--title", "Ok", "--by", "nobody-worker"),
      page(html, "--title", "Ok", "--by", "planner", "--for", "nobody"),
      page(html, "--by", "planner"),
    ]
    for (const refused of refusals) expect(refused.code).toBe(1)
    expect(refusals[0]!.err).toContain("not an HTML file")
    expect(refusals[1]!.err).toContain("not text")
    expect(refusals[2]!.err).toContain("no session named nobody-worker")
    expect(refusals[3]!.err).toContain("no session named nobody")
    expect(refusals[4]!.err).toContain("usage: playground page")
    expect(existsSync(previews)).toBe(false)
  })
})
