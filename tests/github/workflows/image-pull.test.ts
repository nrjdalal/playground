import { describe, expect, test } from "bun:test"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "../../..")
const SELF = relative(ROOT, import.meta.path)

type Step = { name?: string; run?: string }
type Workflow = { jobs: Record<string, { steps: Step[] }> }

// a docker run argv handed straight to a spawn, which starts a container; an argv in a table of sample commands starts none
const SPAWNED =
  /\b(?:Bun\.spawn(?:Sync)?|spawnSync|spawn|execFileSync)\(\s*\[\s*["'`]docker["'`]\s*,\s*["'`]run["'`]\s*,([^\]]*)\]/g
const ELEMENT = /["'`]([^"'`]*)["'`]|([A-Za-z_$][\w$]*)/g
const IMAGE = /^[a-z][a-z0-9._/-]*:\w[\w.-]*$/

// The images a test file's source starts a container from, a const of the same file read for its value.
const spawnedImages = (source: string): string[] => {
  const consts = new Map(
    [...source.matchAll(/const ([A-Za-z_$][\w$]*) = ["'`]([^"'`$]*)["'`]/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  )
  return [...source.matchAll(SPAWNED)].flatMap((call) =>
    [...call[1]!.matchAll(ELEMENT)]
      .map((element) => element[1] ?? consts.get(element[2]!) ?? "")
      .filter((value) => IMAGE.test(value)),
  )
}

// PG-1058: a fresh runner pulled each image inside a test's 60s beforeAll, which timed out, so the Suite job pulls every image a test starts first.
describe("the Suite job pulls every image a test starts before the shard runs", () => {
  test("its pull step names exactly the images the tests spawn, before Test this shard, timing each", async () => {
    const { jobs } = Bun.YAML.parse(
      await Bun.file(join(ROOT, ".github/workflows/auto-check-build.yml")).text(),
    ) as Workflow
    const suite = Object.values(jobs).find((job) =>
      job.steps.some((step) => /test-sandbox\.ts/.test(step.run ?? "")),
    )!
    const names = suite.steps.map((step) => step.name)
    const pull = suite.steps.find((step) => step.name === "Pull the test images")
    expect(pull).toBeDefined()
    expect(names.indexOf("Pull the test images")).toBeLessThan(names.indexOf("Test this shard"))
    expect(pull!.run).toContain("pulled in")
    const pulled = /for image in ([^;]+);/
      .exec(pull!.run ?? "")![1]!
      .trim()
      .split(/\s+/)
    const used = new Set<string>()
    for await (const file of new Bun.Glob("tests/**/*.{ts,tsx}").scan({ cwd: ROOT }))
      if (file !== SELF)
        for (const image of spawnedImages(await Bun.file(join(ROOT, file)).text())) used.add(image)
    expect([...pulled].sort()).toEqual([...used].sort())
  })

  test("an image counts only where a test spawns docker run with it", () => {
    // not a container start: the rows are sample source text the parser below reads, nothing here spawns
    const source = [
      'const IMAGE = "postgres:18-alpine"',
      'Bun.spawnSync(["docker", "run", "-d", "--rm", "-p", "127.0.0.1::5432", IMAGE])',
      'Bun.spawnSync(["docker", "run", "-d", "--rm", "-p", "127.0.0.1::6379", "redis:alpine"], { env })',
      // inspect data, a URL, an argv in a table of sample commands and a shell string start nothing
      '{ Image: "postgres:alpine", Name: "/playground-db" }',
      'POSTGRES_URL: "postgres://postgres:pw@127.0.0.1:5432/postgres"',
      '["docker", "run", "--rm", "--network", "none", "bash:5", "bash", "-c", "true"],',
      '["docker run --rm alpine:3 true", "none"],',
    ].join("\n")
    expect(spawnedImages(source)).toEqual(["postgres:18-alpine", "redis:alpine"])
  })
})
