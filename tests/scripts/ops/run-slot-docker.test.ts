import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, SCRIPT } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// #1083, 6 Nov 00:38Z: a parallel docker compose build outside run-slot filled the Docker VM the live dashboard's Postgres shares, and got it killed
// A machine whose fake docker lists api and web for `compose config --services`, logs each compose build's services as it starts and ends (a pause between, so two builds at once interleave), and touches its last word for any other call.
const dockerMachine = () => {
  const m = machine()
  const log = join(m.root, "docker.log")
  writeFileSync(
    join(m.bin, "docker"),
    `#!/bin/bash
case " $* " in
  *" config --services "*) printf 'api\\nweb\\n'; exit 0 ;;
  *" compose "*" build"*) shift; while [ "$1" != build ]; do shift; done; shift
    echo "start $*" >> ${log}; sleep 0.3; echo "end $*" >> ${log}; exit 0 ;;
esac
touch "\${@: -1}"
`,
  )
  chmodSync(join(m.bin, "docker"), 0o755)
  const holdDocker = () => m.hold("run-slot-docker", 0, "docker")
  const builds = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [])
  // a docker command through run-slot, its stderr read as it comes, as start() reads a run's
  const docker = (who: string, words: string[]) => {
    const p = Bun.spawn(["bash", SCRIPT, who, "--", "docker", ...words], {
      cwd: m.root,
      env: m.env(),
      stderr: "pipe",
    })
    let err = ""
    const read = (async () => {
      for await (const chunk of p.stderr) err += new TextDecoder().decode(chunk)
    })()
    const done = async () => {
      const code = await p.exited
      await read
      return { code, err }
    }
    return { done, p, stderr: () => err }
  }
  return { ...m, builds, docker, holdDocker }
}

describe("run-slot runs one docker build at a time on the machine (#1083)", () => {
  test("a docker build waits while another holds run-slot-docker, and runs once it is given back", async () => {
    const m = dockerMachine()
    m.holdDocker()
    const run = m.start("worker-d", {}, SCRIPT, ["docker", "build", "."])
    expect(await run.saw(/waiting for run-slot-docker/g)).toBe(true)
    expect(existsSync(run.marker)).toBe(false)
    m.release("run-slot-docker")
    expect(await run.ran()).toBe(true)
    expect(existsSync(join(m.ops, "run-slot-docker"))).toBe(false)
  })

  test("a run that builds no image starts beside a held run-slot-docker", async () => {
    const m = dockerMachine()
    m.holdDocker()
    expect(await m.runs("worker-e")).toBe(true)
  })

  test("a docker compose build naming no service builds each service config lists, one after another", async () => {
    const m = dockerMachine()
    const { code, err } = await m.docker("worker-d", ["compose", "build", "--no-cache"]).done()
    expect(code).toBe(0)
    expect(m.builds()).toEqual([
      "start --no-cache api",
      "end --no-cache api",
      "start --no-cache web",
      "end --no-cache web",
    ])
    expect(err).toContain("docker-build: building api (1 of 2)")
    expect(err).toContain("docker-build: building web (2 of 2)")
  })

  test("a docker compose build naming two services builds them one after another", async () => {
    const m = dockerMachine()
    expect((await m.docker("worker-d", ["compose", "build", "web", "api"]).done()).code).toBe(0)
    expect(m.builds()).toEqual(["start web", "end web", "start api", "end api"])
  })

  test("a docker compose build naming one service runs as it is", async () => {
    const m = dockerMachine()
    expect((await m.docker("worker-d", ["compose", "build", "api"]).done()).code).toBe(0)
    expect(m.builds()).toEqual(["start api", "end api"])
  })

  test.each([
    ["docker compose up", ["compose", "up", "-d"], "--no-build"],
    ["docker compose up --build", ["compose", "up", "--build"], "--no-build"],
    ["docker buildx bake", ["buildx", "bake"], "one run-slot run at a time"],
  ])("%s, which builds its images at once, is refused with the fix", async (_name, words, fix) => {
    const m = dockerMachine()
    const { code, err } = await m.docker("worker-d", words).done()
    expect(code).toBe(2)
    expect(err).toContain("run-slot.sh refuses")
    expect(err).toContain(fix)
    expect(m.builds()).toEqual([])
  })

  test("a chain that builds an image is refused, so each build is a run of its own", async () => {
    const m = dockerMachine()
    const p = Bun.spawn(
      ["bash", SCRIPT, "worker-d", "--", "bash", "-c", "true && docker build ."],
      {
        cwd: m.root,
        env: m.env(),
        stderr: "pipe",
      },
    )
    expect(await p.exited).toBe(2)
    expect(await new Response(p.stderr).text()).toContain(
      "refuses a chain that builds a docker image",
    )
  })

  test("a docker build that ends gives run-slot-docker back, so the next one starts at once", async () => {
    const m = dockerMachine()
    expect(await m.start("worker-d", {}, SCRIPT, ["docker", "build", "."]).ran()).toBe(true)
    const next = m.start("worker-f", {}, SCRIPT, ["docker", "build", "."])
    expect(await next.ran()).toBe(true)
    expect(next.p.exitCode).toBe(0)
  })
})
