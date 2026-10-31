import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", "..", "..")
const procs = join(root, "scripts", "ops", "dashboard", "procs.sh")
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "procs-drain-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A stand-in for docker whose exec records its arguments and counts no open delivery.
const execs = join(scratch, "execs")
await Bun.write(
  join(scratch, "bin", "docker"),
  `#!/bin/sh\n[ "$1" = exec ] || exit 9\necho "$*" >> "${execs}"\necho 0\n`,
)
chmodSync(join(scratch, "bin", "docker"), 0o755)
const state = join(scratch, "config", "playground", "ops", "dashboard")

// Stops dashboard-dev with nothing recorded, so only its drain reads the database, and returns what docker ran.
const stop = async (named: string | null) => {
  rmSync(execs, { force: true })
  rmSync(join(state, "dashboard-db"), { force: true })
  await Bun.write(join(state, ".keep"), "")
  if (named !== null) await Bun.write(join(state, "dashboard-db"), named)
  const proc = Bun.spawn(["bash", procs, "stop", "dashboard-dev"], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(scratch, "config"),
      PLAYGROUND_DATA_DIR: join(join(scratch, "config"), "playground"),
      PATH: `${join(scratch, "bin")}:${process.env.PATH}`,
    },
    stdout: "pipe",
  })
  expect(await proc.exited).toBe(0)
  return Bun.file(execs)
    .text()
    .catch(() => "")
}

describe("procs.sh's drain (#1335)", () => {
  test("counts open deliveries in the container the supervisor found, whatever its name", async () => {
    expect(await stop("playground-dispatcher-db\n")).toContain(
      "exec playground-dispatcher-db psql -U postgres -tAc select count(*) from pg_stat_activity",
    )
  })

  test("reads no database when the supervisor found none, or left no name", async () => {
    expect(await stop("")).toBe("")
    expect(await stop(null)).toBe("")
  })

  test("names no container of its own", async () => {
    expect(await Bun.file(procs).text()).not.toContain("playground-dashboard-db")
  })
})

test("procs.sh reads its state folder in the data folder PLAYGROUND_DATA_DIR names, not a fixed dispatcher folder", async () => {
  const data = join(scratch, "data")
  rmSync(execs, { force: true })
  await Bun.write(join(data, "ops", "dashboard", "dashboard-db"), "acme-db\n")
  const proc = Bun.spawn(["bash", procs, "stop", "dashboard-dev"], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(scratch, "config"),
      PATH: `${join(scratch, "bin")}:${process.env.PATH}`,
      PLAYGROUND_DATA_DIR: data,
    },
    stdout: "pipe",
  })
  expect(await proc.exited).toBe(0)
  expect(await Bun.file(execs).text()).toContain("exec acme-db psql")
})

// its usage is its whole leading comment block, lines added to the header included, and no code line after it
test("an unknown verb prints the header and stops before the code", () => {
  const [shebang, ...rest] = readFileSync(procs, "utf8").split("\n")
  const header = ["# A line added to the header.", "# And a second one.", ...rest]
  const copy = join(scratch, "procs.sh")
  writeFileSync(copy, [shebang, ...header].join("\n"))
  const r = Bun.spawnSync(["bash", copy, "nope", "web"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(scratch, "config") },
  })
  const block = header.slice(
    0,
    header.findIndex((line) => !line.startsWith("#")),
  )
  expect(r.exitCode).toBe(2)
  expect(r.stdout.toString()).toBe(`${block.join("\n")}\n`)
})
