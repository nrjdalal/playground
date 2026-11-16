import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runArgv } from "../../../../../../api/hono/src/lib/dashboard/run-argv"
import {
  installArgv,
  installedRefusal,
  PKEXEC,
  repoScripts,
  ROOT_TIMEOUT_MS,
  SCRIPTS_DIR,
  stepArgv,
} from "../../../../../../api/hono/src/lib/system/root"
import {
  INSTALL_TEXT,
  ROOT_BASE,
  ROOT_DIR,
  ROOT_NAMES,
} from "../../../../../../packages/config/src/inbox"

const scratch = mkdtempSync(join(tmpdir(), "root-step-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const me = process.getuid!()
const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex")

describe("a root step's argv (PG-2433)", () => {
  test("is pkexec on the one installed script, with no argument", () => {
    expect(stepArgv("bwrap-userns")).toEqual([
      "/usr/bin/pkexec",
      "--disable-internal-agent",
      `${ROOT_DIR}/bwrap-userns`,
    ])
  })

  test("refuses a script not on the list", () => {
    expect(() => stepArgv("apt-install")).toThrow("apt-install is not a listed root step")
    expect(() => stepArgv("../../bin/sh")).toThrow("is not a listed root step")
    expect(() => stepArgv("toString")).toThrow("is not a listed root step")
  })

  test("refuses any argument taken from a card", () => {
    expect(() => stepArgv("bwrap-userns", "--rm")).toThrow("A root step takes no argument")
  })

  test("waits on the password window for 5 minutes", () => {
    expect(ROOT_TIMEOUT_MS).toBe(300_000)
  })
})

describe("the install's argv (PG-2433)", () => {
  test("holds the install text constant byte for byte, the scripts folder, then each hash in order", async () => {
    const scripts = await repoScripts()
    const argv = installArgv(scripts)
    expect(argv.slice(0, 4)).toEqual([...PKEXEC, "/bin/sh", "-c"])
    expect(argv[4]).toBe(INSTALL_TEXT)
    expect(argv.slice(5)).toEqual(["sh", SCRIPTS_DIR, ...scripts.map((s) => s.sha256)])
  })

  test("refuses a hash that holds a quote or $(", async () => {
    const [script] = await repoScripts()
    for (const bad of [`${"a".repeat(63)}'`, `$(id)${"a".repeat(59)}`, "A".repeat(64), ""]) {
      expect(() => installArgv([{ ...script!, sha256: bad }])).toThrow(
        "hash is not 64 lowercase hex",
      )
    }
  })

  test("refuses a list that is not every listed script once, in order", () => {
    expect(() => installArgv([])).toThrow(`An install lists ${ROOT_NAMES.join(", ")}`)
    const twice = ROOT_NAMES.map((name) => ({ name, sha256: "a".repeat(64) }))
    expect(() => installArgv([...twice, ...twice])).toThrow("An install lists")
  })

  test("each listed script is in this checkout", async () => {
    expect((await repoScripts()).map((s) => s.name)).toEqual([...ROOT_NAMES])
  })
})

// The install text itself, run by sh as this user on scratch folders: its fixed folder swapped for a scratch one and chown for a no-op, so nothing reaches /usr.
describe("the install text (PG-2433)", () => {
  let n = 0
  const setUp = async () => {
    const root = join(scratch, `install-${n++}`)
    const src = join(root, "src")
    mkdirSync(src, { recursive: true })
    for (const name of ROOT_NAMES) await Bun.write(join(src, name), `#!/bin/sh\necho ${name}\n`)
    const text = `chown() { :; }\n${INSTALL_TEXT.replace(`base=${ROOT_BASE}`, `base=${join(root, "base")}`)}`
    expect(text).not.toContain(ROOT_BASE)
    const run = (...hashes: string[]) =>
      runArgv(["/bin/sh", "-c", text, "sh", src, ...hashes], 10_000)
    const good = ROOT_NAMES.map((name) => hash(`#!/bin/sh\necho ${name}\n`))
    return { base: join(root, "base"), good, run, src }
  }
  const leftover = (base: string) =>
    existsSync(base) ? readdirSync(base).filter((f) => f.startsWith(".stage")) : []

  test("installs each script whose copy matches the approved hash, then removes its staging folder", async () => {
    const { base, good, run } = await setUp()
    const ran = await run(...good)
    expect(ran).toMatchObject({
      code: 0,
      out: `installed ${ROOT_NAMES.join(", ")} in ${base}/root`,
    })
    for (const name of ROOT_NAMES) expect(existsSync(join(base, "root", name))).toBe(true)
    expect(leftover(base)).toEqual([])
  })

  test("refuses a source changed after approval, moving nothing", async () => {
    const { base, good, run, src } = await setUp()
    await Bun.write(join(src, ROOT_NAMES[0]), "#!/bin/sh\necho changed\n")
    const ran = await run(...good)
    expect(ran.code).toBe(1)
    expect(ran.err).toBe(`refused: ${ROOT_NAMES[0]} changed since you approved it`)
    expect(existsSync(join(base, "root", ROOT_NAMES[0]))).toBe(false)
    expect(leftover(base)).toEqual([])
  })

  test("refuses a hash that holds a quote or $(, and a wrong count of hashes, before it copies anything", async () => {
    const { base, good, run } = await setUp()
    for (const bad of [`${"a".repeat(63)}'`, `$(touch ${base}-pwned)`, "A".repeat(64)]) {
      const ran = await run(...good.slice(1), bad)
      expect(ran).toMatchObject({ code: 1, err: "refused: a hash is not 64 lowercase hex" })
    }
    expect((await run()).err).toContain("hashes are needed")
    expect(existsSync(`${base}-pwned`)).toBe(false)
    expect(existsSync(base)).toBe(false)
  })
})

describe("an installed script's check (PG-2433)", () => {
  let n = 0
  const installed = async (body?: string) => {
    const dir = join(scratch, `lib-${n++}`, "root")
    mkdirSync(dir, { recursive: true })
    chmodSync(join(dir, ".."), 0o755)
    chmodSync(dir, 0o755)
    const repo = join(scratch, `repo-${n}`)
    mkdirSync(repo, { recursive: true })
    await Bun.write(join(repo, "bwrap-userns"), "#!/bin/sh\necho ok\n")
    await Bun.write(join(dir, "bwrap-userns"), body ?? "#!/bin/sh\necho ok\n")
    chmodSync(join(dir, "bwrap-userns"), 0o755)
    return { dir, repo }
  }

  test("passes a copy owned by root, changed by root alone, matching this checkout's", async () => {
    const { dir, repo } = await installed()
    expect(await installedRefusal("bwrap-userns", { dir, owner: me, repo })).toBeUndefined()
  })

  test("refuses a path not owned by root", async () => {
    const { dir, repo } = await installed()
    expect(await installedRefusal("bwrap-userns", { dir, repo })).toBe(
      `${join(dir, "..")} is not owned by root: approve a new install card`,
    )
  })

  test("refuses a script others can change, a link, and one not there", async () => {
    const writable = await installed()
    chmodSync(join(writable.dir, "bwrap-userns"), 0o775)
    expect(await installedRefusal("bwrap-userns", { ...writable, owner: me })).toContain(
      "can be changed by others than root",
    )
    const linked = await installed()
    rmSync(join(linked.dir, "bwrap-userns"))
    symlinkSync(join(linked.repo, "bwrap-userns"), join(linked.dir, "bwrap-userns"))
    expect(await installedRefusal("bwrap-userns", { ...linked, owner: me })).toContain("is a link")
    const gone = await installed()
    rmSync(join(gone.dir, "bwrap-userns"))
    expect(await installedRefusal("bwrap-userns", { ...gone, owner: me })).toContain("is not there")
  })

  test("refuses a stale install rather than run old code", async () => {
    const { dir, repo } = await installed("#!/bin/sh\necho old\n")
    expect(await installedRefusal("bwrap-userns", { dir, owner: me, repo })).toBe(
      `${join(dir, "bwrap-userns")} is an older copy: approve a new install card`,
    )
  })
})

describe("runArgv's timeout (PG-2433)", () => {
  test("stops a run past its timeout", async () => {
    const started = Date.now()
    const ran = await runArgv(["sleep", "5"], 200)
    expect(ran.code).toBe(143)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
