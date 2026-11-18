import { afterAll, beforeEach, describe, expect, test, vi } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  isNamedContainer,
  portFromPort,
  setupName,
  startArgv,
  startLocal,
  urlFor,
  withDatabase,
} from "../../../../../../api/hono/src/lib/setup/container"

// A fresh temp folder per test, so no startLocal writes a real .env and no test leaves files behind.
const dir = mkdtempSync(join(tmpdir(), "setup-container-"))
const envFile = join(dir, ".env")
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const URL = "postgres://postgres:postgres@localhost:54123/postgres"

// A fake Run: it logs each call, replies to the ones startLocal makes, and never touches Docker.
class FakeRun {
  calls: { args: string[]; when: string }[] = []
  constructor(public readonly when: string) {}
  run = async (args: string[]) => {
    this.calls.push({ args, when: this.when })
    return { code: 0, stderr: "", stdout: "" }
  }
}

// A fake that also answers docker ps and docker port, keyed on the first arg so startLocal's list reuses the running child.
class FakeDocker extends FakeRun {
  containers: string[]
  runningPort: number
  constructor(when: string, containers: string[] = [], runningPort: number = 54123) {
    super(when)
    this.containers = containers
    this.runningPort = runningPort
  }
  run = async (args: string[]) => {
    this.calls.push({ args, when: this.when })
    if (args[0] === "ps") {
      return { code: 0, stderr: "", stdout: this.containers.map((c) => c).join("\n") }
    }
    if (args[0] === "port") {
      return { code: 0, stderr: "", stdout: `5432/tcp -> 127.0.0.1:${this.runningPort}\n` }
    }
    return { code: 0, stderr: "", stdout: "" }
  }
}

// Pure: the name an argv names, as `run --name <name> -d ...`, so a test derives the child's name from the run call.
const named = (argv: string[]): string => argv[argv.indexOf("--name") + 1]

describe("startArgv", () => {
  test("publishes the Postgres port on 127.0.0.1 alone, with the checkout's name and the postgres login", () => {
    expect(startArgv("playground-db")).toEqual([
      "run",
      "--name",
      "playground-db",
      "-d",
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=postgres",
      "postgres:alpine",
    ])
  })

  test("binds the host port to 127.0.0.1, so only this machine can reach it", () => {
    const argv = startArgv("playground-db")
    expect(argv[argv.indexOf("-p") + 1]).toMatch(/^127\.0\.0\.1::5432$/)
  })
})

describe("portFromPort and urlFor", () => {
  test("portFromPort reads the host port docker port prints, or is null", () => {
    expect(portFromPort("5432/tcp -> 127.0.0.1:54123\n")).toBe(54123)
    expect(portFromPort("5432/tcp -> 127.0.0.1:54123")).toBe(54123)
    expect(portFromPort("")).toBeNull()
  })

  test("urlFor names the postgres login on localhost and the port", () => {
    expect(urlFor(54123)).toBe(URL)
  })
})

describe("isNamedContainer", () => {
  test("is a base dash four letters or digits, like a fresh start's child", () => {
    expect(isNamedContainer("playground-db", "playground-db-a1B2")).toBe(true)
    expect(isNamedContainer("playground-db", "playground-db-x9Kq")).toBe(true)
    expect(isNamedContainer("playground-db", "playground-db")).toBe(false)
    expect(isNamedContainer("playground-db", "playground-db-a1B2c")).toBe(false)
    expect(isNamedContainer("playground-db", "playground-db-12ab")).toBe(true)
  })
})

describe("withDatabase and setupName", () => {
  const live = { branch: "live/dashboard", database: "playground-dashboard-db" }
  test("withDatabase replaces the line or adds one, and setupName is the live database on its branch", () => {
    expect(withDatabase("", URL)).toContain(`POSTGRES_URL=${URL}\n`)
    expect(withDatabase("NODE_ENV=local\nPOSTGRES_URL=old\n", URL)).toBe(
      "NODE_ENV=local\nPOSTGRES_URL=" + URL + "\n",
    )
    expect(setupName("/repo/.claude/worktrees/pg-x-db", "feature", live)).toBe("playground-pg-x-db")
    expect(setupName("/repo", "live/dashboard", live)).toBe("playground-dashboard-db")
  })
})

// Spies, so no test waits, proves or migrates for real while the rest of startLocal is stubbed.
const noMigrate = vi.fn(async () => {})
const noProve = vi.fn(async () => "")
const noWait = vi.fn(async () => {})

// A fake startLocal: docker is fake, migrate/prove/wait are spies, and onStep logs.
const go = (
  docker: FakeDocker,
  fileText = "",
  more: Partial<Parameters<typeof startLocal>[0]> = {},
) =>
  startLocal({
    envFile,
    name: "playground-db",
    onStep: () => undefined,
    docker: docker.run,
    migrate: noMigrate,
    prove: noProve,
    wait: noWait,
    ...more,
  } as Parameters<typeof startLocal>[0])

beforeEach(async () => {
  await Bun.write(envFile, "")
  noMigrate.mockClear()
  noProve.mockClear()
  noWait.mockClear()
})

describe("startLocal", () => {
  test("starts the container published on 127.0.0.1 alone, waits, proves, migrates and saves .env", async () => {
    const docker = new FakeDocker("Starting", [], 54123)
    const url = await go(docker)

    // It lists, then runs the container on loopback alone, naming it, and reads the port back off that child.
    const runCall = docker.calls.find((c) => c.args[0] === "run")
    expect(runCall).toBeDefined()
    const child = named(runCall!.args)
    expect(runCall!.args).toEqual(startArgv(child))
    expect(runCall!.args).toContain("127.0.0.1::5432")

    expect(docker.calls.find((c) => c.args[0] === "port")!.args).toEqual(["port", child, "5432"])
    expect(url).toBe(urlFor(54123))

    const execCall = docker.calls.find((c) => c.args[0] === "exec")
    expect(execCall!.args).toEqual(["exec", child, "pg_isready", "-U", "postgres"])
    expect(noProve).toHaveBeenCalledWith(URL)
    expect(noMigrate).toHaveBeenCalledWith(URL)

    expect(await Bun.file(envFile).text()).toContain(`POSTGRES_URL=${URL}`)
  })

  test("the loopback argv is fixed: nothing comes from a request, only the checkout's name", async () => {
    const docker = new FakeDocker("Starting", [], 54123)
    await go(docker)
    const argv = docker.calls.find((c) => c.args[0] === "run")!.args
    expect(argv[argv.indexOf("-p") + 1]).toBe("127.0.0.1::5432")
    expect(argv).toEqual(startArgv(named(argv)))
  })

  test("when docker reports no port, it says what docker printed and leaves the running container", async () => {
    const docker = new FakeDocker("Starting", ["playground-db-a1B2"], 54123)
    const origRun = docker.run
    docker.run = async (args) =>
      args[0] === "port" ? { code: 0, stderr: "", stdout: "" } : { ...(await origRun(args)) }
    await expect(go(docker)).rejects.toThrow("docker reported no port")
  })

  test("a name already running is reused, not started again, so no argv run is made", async () => {
    const docker = new FakeDocker("Starting", ["playground-db-x9Kq"], 54123)
    await go(docker)
    expect(docker.calls.find((c) => c.args[0] === "run")).toBeUndefined()
  })

  test("with no name running, it starts one and, if the live dashboard's, keeps it running after a reboot", async () => {
    const docker = new FakeDocker("Starting", [], 54123)
    await go(docker, undefined, { name: "playground-dashboard-db", branch: "live/dashboard" })
    expect(docker.calls.find((c) => c.args[0] === "run")).toBeDefined()
    expect(docker.calls.find((c) => c.args[0] === "update")).toBeDefined()
  })

  test("with the live dashboard's own unsuffixed database, it refuses to start a second one beside it", async () => {
    const docker = new FakeDocker("Starting", ["playground-dashboard-db"], 54123)
    await expect(
      go(docker, undefined, { branch: "live", name: "playground-dashboard-db" }),
    ).rejects.toThrow("holds the")
  })

  test("when docker cannot list its containers, it says so and does not start one", async () => {
    const docker = new FakeDocker("Docker down", [], 54123)
    const origRun = docker.run
    docker.run = async (args) =>
      args[0] === "info" || args[0] === "ps"
        ? { code: 1, stderr: "docker down", stdout: "" }
        : { ...(await origRun(args)) }
    await expect(go(docker)).rejects.toThrow(/could not list|Docker is not running/)
  })

  test("when docker cannot start the container, it says what docker printed and leaves it unstarted", async () => {
    const docker = new FakeDocker("Starting", [], 54123)
    const origRun = docker.run
    docker.run = async (args) =>
      args[0] === "run"
        ? { code: 1, stderr: "cannot create network", stdout: "" }
        : { ...(await origRun(args)) }
    await expect(go(docker)).rejects.toThrow("docker run")
  })

  test("when Postgres does not come up, it waits, then says so and does not migrate or save .env", async () => {
    const docker = new FakeDocker("Starting", ["playground-db-a1B2"], 54123)
    const origRun = docker.run
    docker.run = async (args) =>
      args[0] === "exec" ? { code: 1, stderr: "", stdout: "" } : { ...(await origRun(args)) }
    await expect(go(docker)).rejects.toThrow("did not start")
    expect(noMigrate).not.toHaveBeenCalled()
    expect(await Bun.file(envFile).text()).not.toContain("POSTGRES_URL")
  })

  test("the container first run starts under it, published on 127.0.0.1 alone, passes the live guard", async () => {
    // A loopback-only container is the live dashboard's database; it is reused, and startArgv binds it to 127.0.0.1.
    const docker = new FakeDocker("Starting", ["playground-db-a1B2"], 54123)
    await go(docker, undefined, { branch: "live" })
    const runCall = docker.calls.find((c) => c.args[0] === "run")
    expect(runCall).toBeUndefined()
    // A fresh one would bind to loopback alone.
    expect(startArgv("playground-db")).toContain("127.0.0.1::5432")
  })
})
