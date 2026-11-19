import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir as systemTmp } from "node:os"
import { join } from "node:path"

import { type Docker, GuardError, locate } from "../../../../../../api/hono/src/lib/sessions/guard"
import type { Run } from "../../../../../../api/hono/src/lib/setup/container"
import {
  MoveError,
  moveIfExposed,
  moveToLoopback,
} from "../../../../../../api/hono/src/lib/setup/move"

const PORT = 55432
const NAME = "playground-db-Ab12"
const SECRET = randomUUID()
const URL = `postgres://postgres:${SECRET}@localhost:${PORT}/postgres`

type Box = {
  cmd: string[]
  env: string[]
  hostIp: string
  id: string
  image: string
  labels: Record<string, string>
  restart: string
  running: boolean
  volumesFrom?: string
}

// dump is what a stubbed `pg_dump` returns: its stdout on success.
type Dump = {
  content?: string
}

// Docker as a small machine: containers by name, each with its binding, config and restart policy; `fail` names a verb that fails once its count of calls reaches it.
const fakeDocker = (hostIp: string, fail: Record<string, number> = {}, dump: Dump = {}) => {
  const boxes = new Map<string, Box>([
    [
      NAME,
      {
        cmd: ["postgres", "-c", "max_connections=200"],
        env: [`POSTGRES_PASSWORD=${SECRET}`, "PGDATA=/var/lib/postgresql/data"],
        hostIp,
        id: "old0id",
        image: "sha256:abc",
        labels: { "made.by": "first-run" },
        restart: "unless-stopped",
        running: true,
      },
    ],
  ])
  const calls: string[][] = []
  const seen: Record<string, number> = {}
  const ok = (stdout = "") => ({ code: 0, stderr: "", stdout })
  const no = (stderr: string) => ({ code: 1, stderr, stdout: "" })
  const inspectOf = (name: string, box: Box) => ({
    Config: { Cmd: box.cmd, Env: box.env, Image: "postgres:alpine", Labels: box.labels },
    HostConfig: { RestartPolicy: { MaximumRetryCount: 0, Name: box.restart } },
    Id: box.id,
    Image: box.image,
    Name: `/${name}`,
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: box.hostIp, HostPort: String(PORT) }] } },
  })
  const find = (key: string) =>
    [...boxes.entries()].find(([name, box]) => name === key || box.id === key)
  const exec = (args: string[]) => {
    const verb = args[0]
    seen[verb] = (seen[verb] ?? 0) + 1
    if (fail[verb] !== undefined && seen[verb] >= fail[verb]) return no(`${verb} broke`)
    const at = find(args.at(-1)!)
    if (verb === "ps")
      return ok(
        [...boxes.values()]
          .filter((b) => b.running)
          .map((b) => b.id)
          .join("\n"),
      )
    if (verb === "inspect") {
      const found = args.slice(1).map(find)
      if (found.some((entry) => !entry)) return no(`Error: No such object: ${args[1]}`)
      return ok(JSON.stringify(found.map((entry) => inspectOf(entry![0], entry![1]))))
    }
    if (verb === "stop" && at) at[1].running = false
    else if (verb === "start" && at) at[1].running = true
    else if (verb === "update" && at) at[1].restart = args[2]
    else if (verb === "rename" && find(args[1]!)) {
      const [name, box] = find(args[1]!)!
      boxes.delete(name)
      boxes.set(args[2]!, box)
    } else if (verb === "rm" && at) boxes.delete(at[0])
    else if (verb === "exec") {
      const sub = args[2]
      seen[sub] = (seen[sub] ?? 0) + 1
      if (fail[sub] !== undefined && seen[sub] >= fail[sub]) return no(`${sub} broke`)
      return find(args[1])?.[1].running ? ok() : no("not running")
    } else if (verb === "cp") {
      const name = args[1]!.split(":")[0]
      if (!find(name)) return no(`Error: No such container: ${name}`)
      writeFileSync(args[2]!, dump.content ?? "")
      return ok()
    } else if (verb === "run") {
      const flag = (name: string) => args.flatMap((arg, i) => (arg === name ? [args[i + 1]!] : []))
      const image = args.findIndex((arg) => arg.startsWith("sha256:"))
      boxes.set(flag("--name")[0]!, {
        cmd: args.slice(image + 1),
        env: flag("-e"),
        hostIp: flag("-p")[0]!.split(":")[0]!,
        id: "new0id",
        image: args[image]!,
        labels: Object.fromEntries(flag("--label").map((label) => label.split("="))),
        restart: flag("--restart")[0]!,
        running: true,
        volumesFrom: flag("--volumes-from")[0],
      })
    } else if (!at) return no(`Error: No such container: ${args.at(-1)}`)
    return ok()
  }
  const run: Run = async (args) => {
    calls.push(args)
    return exec(args)
  }
  // the guard's own reader, on the same machine, uncounted
  const sync: Docker = (args) => {
    const out = exec(args)
    if (out.code !== 0) throw new GuardError("docker-down", out.stderr)
    return out.stdout
  }
  return { boxes, calls, run, sync }
}

const noWait = async () => {}

const writes = (calls: string[][]) =>
  calls.filter(([verb]) => !["inspect", "ps", "exec"].includes(verb!))

const dumpIn = (dir: string): string =>
  readdirSync(dir).find((name) => name.startsWith("pg_dump_")) ?? ""

describe("moveIfExposed", () => {
  test("moves an exposed database onto 127.0.0.1 on the same port, keeping its volumes, image, command, environment, labels and restart policy", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0")
    const lines = await moveIfExposed(
      URL,
      docker.run,
      (url) => locate(url, docker.sync),
      noWait,
      dumpDir,
    )
    const moved = docker.boxes.get(NAME)!
    expect(moved).toMatchObject({
      cmd: ["postgres", "-c", "max_connections=200"],
      env: [`POSTGRES_PASSWORD=${SECRET}`, "PGDATA=/var/lib/postgresql/data"],
      hostIp: "127.0.0.1",
      image: "sha256:abc",
      labels: { "made.by": "first-run" },
      restart: "unless-stopped",
      running: true,
      volumesFrom: `${NAME}-old`,
    })
    expect(docker.calls).toContainEqual([
      "run",
      "-d",
      "--name",
      NAME,
      "-p",
      `127.0.0.1:${PORT}:5432`,
      "--volumes-from",
      `${NAME}-old`,
      "--restart",
      "unless-stopped",
      "-e",
      `POSTGRES_PASSWORD=${SECRET}`,
      "-e",
      "PGDATA=/var/lib/postgresql/data",
      "--label",
      "made.by=first-run",
      "sha256:abc",
      "postgres",
      "-c",
      "max_connections=200",
    ])
    // the old one is stopped, kept, and stays stopped after a Docker restart
    expect(docker.boxes.get(`${NAME}-old`)).toMatchObject({ restart: "no", running: false })
    expect(docker.calls.some(([verb]) => verb === "rm")).toBe(false)
    const dumpName = dumpIn(dumpDir)
    expect(dumpName).toBeTruthy()
    expect(lines[0]).toBe(
      `Moved the database ${NAME} onto 127.0.0.1:${PORT} alone, keeping its data`,
    )
    expect(lines.some((line) => line.includes(dumpName))).toBe(true)
    expect(lines.at(-1)).toBe(
      `${NAME}-old is stopped and kept; once the Dashboard reads its data, remove it with: docker rm -v ${NAME}-old`,
    )
  })

  test("the follower's guard passes after the move, naming the moved container on loopback alone", async () => {
    const docker = fakeDocker("0.0.0.0")
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    expect(() => locate(URL, docker.sync)).toThrow(/beyond loopback/)
    await moveIfExposed(URL, docker.run, (url) => locate(url, docker.sync), noWait, dumpDir)
    expect(locate(URL, docker.sync).owner).toMatchObject({ addresses: ["127.0.0.1"], name: NAME })
  })

  test("leaves a database on loopback alone with no Docker write", async () => {
    const docker = fakeDocker("127.0.0.1")
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    expect(
      await moveIfExposed(URL, docker.run, (url) => locate(url, docker.sync), noWait, dumpDir),
    ).toEqual([])
    expect(writes(docker.calls)).toEqual([])
  })

  test("runs once: a second run finds the moved database on loopback and writes nothing", async () => {
    const docker = fakeDocker("::")
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    await moveIfExposed(URL, docker.run, (url) => locate(url, docker.sync), noWait, dumpDir)
    const before = docker.calls.length
    expect(
      await moveIfExposed(URL, docker.run, (url) => locate(url, docker.sync), noWait, dumpDir),
    ).toEqual([])
    expect(writes(docker.calls.slice(before))).toEqual([])
  })

  test("a container already on loopback takes no dump before the move", async () => {
    const docker = fakeDocker("127.0.0.1")
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    expect(
      await moveIfExposed(URL, docker.run, (url) => locate(url, docker.sync), noWait, dumpDir),
    ).toEqual([])
    expect(docker.calls.some(([verb, , sub]) => verb === "exec" && sub === "pg_dump")).toBe(false)
  })

  test("an exposed database dumps before the stop, the dump file mode 600 and the note naming its path", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0", {}, { content: "PGDUMP-DATA" })
    const lines = await moveIfExposed(
      URL,
      docker.run,
      (url) => locate(url, docker.sync),
      noWait,
      dumpDir,
    )
    const dumpIdx = docker.calls.findIndex(([verb, , sub]) => verb === "exec" && sub === "pg_dump")
    const stopIdx = docker.calls.findIndex(([verb]) => verb === "stop")
    // the dump runs before the stop, read from the stub's call order
    expect(dumpIdx).toBeGreaterThanOrEqual(0)
    expect(dumpIdx).toBeLessThan(stopIdx)
    const name = dumpIn(dumpDir)
    expect(name).toBeTruthy()
    // the dump file is mode 600, named with the UTC time, and carries the dump's stdout
    expect(statSync(join(dumpDir, name)).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(dumpDir, name), "utf8")).toBe("PGDUMP-DATA")
    expect(/pg_dump_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(name)).toBe(true)
    // the move's note names the dump's path, which the roll's line carries
    expect(lines.some((line) => line.includes(name))).toBe(true)
  })

  test("a database the URL names with another user and database dumps those, not the default postgres", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0")
    await moveIfExposed(
      `postgres://admin:${SECRET}@localhost:${PORT}/shop`,
      docker.run,
      (url) => locate(url, docker.sync),
      noWait,
      dumpDir,
    )
    const dumpCall = docker.calls.find(([verb, , sub]) => verb === "exec" && sub === "pg_dump")
    // the dump carries the URL's user and database, not the "postgres" fallback
    expect(dumpCall).toBeDefined()
    expect(dumpCall).toContain("-U")
    expect(dumpCall).toContain("admin")
    expect(dumpCall).toContain("-d")
    expect(dumpCall).toContain("shop")
  })

  test("a percent-encoded user decodes to the dump's -U, not the encoded form", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0")
    await moveIfExposed(
      `postgres://a%40b:${SECRET}@localhost:${PORT}/shop`,
      docker.run,
      (url) => locate(url, docker.sync),
      noWait,
      dumpDir,
    )
    // the decodeURIComponent strips the %40, so the -U carries a@b, never the encoded a%40b
    const dumpCall = docker.calls.find(([verb, , sub]) => verb === "exec" && sub === "pg_dump")
    expect(dumpCall).toBeDefined()
    expect(dumpCall).toContain("-U")
    expect(dumpCall).toContain("a@b")
    expect(dumpCall).not.toContain("a%40b")
  })
})

describe("moveToLoopback", () => {
  test("a failed start puts the old container back as it was, started, and says why with no secret", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0", { run: 1 })
    const failure = await moveToLoopback(NAME, PORT, docker.run, noWait, dumpDir).catch(
      (error) => error,
    )
    expect(failure).toBeInstanceOf(MoveError)
    expect(failure.message).toBe(
      `the move failed (docker run failed: run broke); ${NAME} is started again as it was`,
    )
    expect(failure.message).not.toContain(SECRET)
    expect([...docker.boxes.keys()]).toEqual([NAME])
    expect(docker.boxes.get(NAME)).toMatchObject({
      hostIp: "0.0.0.0",
      id: "old0id",
      restart: "unless-stopped",
      running: true,
    })
  })

  test("a moved database that never answers is removed and the old one put back", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0", { pg_isready: 1 })
    const failure = await moveToLoopback(NAME, PORT, docker.run, noWait, dumpDir).catch(
      (error) => error,
    )
    expect(failure.message).toContain(`${NAME} is started again as it was`)
    expect(docker.boxes.get(NAME)).toMatchObject({ id: "old0id", running: true })
    expect(docker.boxes.has(`${NAME}-old`)).toBe(false)
  })

  test("refuses with nothing touched while a container already holds the -old name", async () => {
    const docker = fakeDocker("0.0.0.0")
    docker.boxes.set(`${NAME}-old`, { ...docker.boxes.get(NAME)!, id: "older", running: false })
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    await expect(moveToLoopback(NAME, PORT, docker.run, noWait, dumpDir)).rejects.toThrow(
      `${NAME}-old already exists`,
    )
    expect(writes(docker.calls)).toEqual([])
  })

  test("a failed dump refuses the move and leaves the old container running", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0", { pg_dump: 1 })
    const failure = await moveToLoopback(NAME, PORT, docker.run, noWait, dumpDir).catch(
      (error) => error,
    )
    expect(failure).toBeInstanceOf(MoveError)
    // the dump runs before the stop, so a failed dump leaves the container untouched
    expect(docker.calls.some(([verb]) => verb === "stop")).toBe(false)
    expect(docker.boxes.get(NAME)).toMatchObject({ running: true })
    expect(docker.boxes.has(`${NAME}-old`)).toBe(false)
  })

  test("names the dump's path in its note", async () => {
    const dumpDir = mkdtempSync(join(systemTmp(), "move-dump-"))
    const docker = fakeDocker("0.0.0.0", {}, { content: "PGDUMP-DATA" })
    const lines = await moveToLoopback(NAME, PORT, docker.run, noWait, dumpDir)
    const name = dumpIn(dumpDir)
    expect(name).toBeTruthy()
    expect(lines.some((line) => line.includes(name))).toBe(true)
  })
})
