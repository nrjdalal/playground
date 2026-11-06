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
  // every docker call with the builder it runs under, and the marker the fake's buildx create leaves
  const calls = join(m.root, "docker-calls.log")
  const made = join(m.root, "builder-made")
  writeFileSync(
    join(m.bin, "docker"),
    `#!/bin/bash
echo "BUILDX_BUILDER=\${BUILDX_BUILDER:-} $*" >> ${calls}
case " $* " in
  *" buildx inspect "*) [ -f ${made} ] ; exit ;;
  *" buildx create "*) touch ${made}; exit 0 ;;
  *" buildx stop "*) exit 0 ;;
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
  const dockerCalls = () =>
    existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []
  return { ...m, builds, docker, dockerCalls, holdDocker, made }
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

  test("portless's compose up through bunx is refused with the same fix", async () => {
    const m = dockerMachine()
    const p = Bun.spawn(
      ["bash", SCRIPT, "worker-d", "--", "bunx", "portless", "compose", "up", "-d"],
      {
        cwd: m.root,
        env: m.env(),
        stderr: "pipe",
      },
    )
    expect(await p.exited).toBe(2)
    expect(await new Response(p.stderr).text()).toContain("--no-build")
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

  test("a docker build runs in the capped builder, made when missing with its memory cap, and stopped after", async () => {
    const m = dockerMachine()
    expect(await m.start("worker-d", {}, SCRIPT, ["docker", "build", "."]).ran()).toBe(true)
    const calls = m.dockerCalls()
    expect(calls[0]).toBe("BUILDX_BUILDER= buildx inspect playground-capped")
    expect(calls[1]).toBe(
      "BUILDX_BUILDER= buildx create --name playground-capped --driver docker-container --driver-opt memory=1536m --driver-opt memory-swap=1536m --driver-opt default-load=true",
    )
    expect(calls[2]).toStartWith("BUILDX_BUILDER=playground-capped build . ")
    expect(calls[3]).toBe("BUILDX_BUILDER= buildx stop playground-capped")
  })

  test("a compose build's services each build in the capped builder, which is made once", async () => {
    const m = dockerMachine()
    writeFileSync(m.made, "")
    expect((await m.docker("worker-d", ["compose", "build"]).done()).code).toBe(0)
    const builds = m.dockerCalls().filter((call) => call.includes(" build "))
    expect(builds).toEqual([
      "BUILDX_BUILDER=playground-capped compose build api",
      "BUILDX_BUILDER=playground-capped compose build web",
    ])
    expect(m.dockerCalls().some((call) => call.includes("buildx create"))).toBe(false)
  })

  test.each([
    ["--builder", ["buildx", "--builder", "default", "build", "."]],
    ["--builder=", ["build", "--builder=default", "."]],
    ["compose build --builder", ["compose", "build", "--builder", "default"]],
  ])(
    "a docker build naming its own builder with %s is refused, since it would leave the cap",
    async (_name, words) => {
      const m = dockerMachine()
      const { code, err } = await m.docker("worker-d", words).done()
      expect(code).toBe(2)
      expect(err).toContain("names its own builder")
      expect(m.dockerCalls()).toEqual([])
    },
  )

  test("a docker build does not run uncapped when the capped builder cannot be made", async () => {
    const m = dockerMachine()
    writeFileSync(
      join(m.bin, "docker"),
      `#!/bin/bash\necho "$*" >> ${join(m.root, "docker-calls.log")}\ncase " $* " in *" buildx "*) exit 1 ;; esac\ntouch "\${@: -1}"\n`,
    )
    const run = m.start("worker-d", {}, SCRIPT, ["docker", "build", "."])
    expect(await run.ran()).toBe(false)
    expect(run.p.exitCode).toBe(1)
    expect(m.dockerCalls().some((call) => call.startsWith("build "))).toBe(false)
  })

  test("a docker build that ends gives run-slot-docker back, so the next one starts at once", async () => {
    const m = dockerMachine()
    expect(await m.start("worker-d", {}, SCRIPT, ["docker", "build", "."]).ran()).toBe(true)
    const next = m.start("worker-f", {}, SCRIPT, ["docker", "build", "."])
    expect(await next.ran()).toBe(true)
    expect(next.p.exitCode).toBe(0)
  })
})
