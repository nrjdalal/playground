import { describe, expect, test } from "bun:test"

import { kind } from "../../../../packages/scripts/src/docker-build"

const words = (line: string) => line.split(" ")

describe("run-slot's docker build reader reads past the hooks' wrappers (#1083)", () => {
  test.each([
    ["docker build .", "run"],
    ["timeout 30 docker build .", "run"],
    ["timeout -s KILL 30 docker build .", "run"],
    ["nice docker compose build", "each"],
    ["nice -n 5 docker compose build api", "run"],
    ["exec docker compose build web api", "each"],
    ["command docker build .", "run"],
    ["time docker build .", "run"],
    ["time -p docker compose build", "each"],
    ["stdbuf -o0 docker build .", "run"],
    ["caffeinate -i docker compose build", "each"],
    ["nohup docker build .", "run"],
    ["env FOO=1 docker build .", "run"],
    ["DOCKER_BUILDKIT=1 docker build .", "run"],
    ["/usr/local/bin/docker build .", "run"],
    ["bunx portless compose build", "each"],
    ["docker compose up --no-build -d", "none"],
    ["docker run --rm alpine true", "none"],
    ["echo docker build", "none"],
    ["bun run test:file tests/scripts/ops/run-slot-docker.test.ts", "none"],
  ])("%s reads as %s", (line, want) => {
    expect(kind(words(line))).toBe(want)
  })

  test.each([
    ["sudo docker build .", "under sudo"],
    ["doas docker build .", "under doas"],
    ["env -i docker build .", "under env -i"],
    ["env -u BUILDX_BUILDER docker build .", "names its own builder"],
    ["env BUILDX_BUILDER=default docker build .", "names its own builder"],
    ["DOCKER_BUILDKIT=0 docker build .", "turns BuildKit off"],
    ["env DOCKER_BUILDKIT=0 nice docker build .", "turns BuildKit off"],
    ["docker build --builder=default .", "names its own builder"],
    ["timeout 30 docker bake", "builds its targets at once"],
    ["docker bake web", "builds its targets at once"],
    ["nice docker compose up -d", "without --no-build"],
    ["docker compose watch", "builds and rebuilds"],
    ["docker compose watch --no-up", "builds and rebuilds"],
    ["docker compose alpha watch", "builds and rebuilds"],
  ])("%s is refused: %s", (line, why) => {
    const verdict = kind(words(line))
    expect(verdict).toStartWith("refuse run-slot.sh refuses")
    expect(verdict).toContain(why)
  })

  test("a compose build whose words env -S split is refused, since each cannot cut it by service", () => {
    expect(kind(["env", "-S", "docker compose build", "api", "web"])).toContain("env -S")
  })
})
