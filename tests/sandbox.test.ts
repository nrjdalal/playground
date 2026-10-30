import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"

// The suite runs through packages/scripts/src/test-sandbox.ts, which puts a fake claude first on PATH and a scratch HOME and CLAUDE_CONFIG_DIR under TEST_SANDBOX_HOME before bun starts, so no test can start a real session or read the real config by accident. A bare bun test stops at tests/require-sandbox.ts before these load; they check the sandbox itself is built right.
describe("the test sandbox", () => {
  test("a claude on PATH is the fake, which refuses loudly", async () => {
    const proc = Bun.spawn(["claude", "--version"], { stderr: "pipe", stdout: "pipe" })
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    expect(code).toBe(99)
    expect(err).toContain("the test sandbox stopped a real claude call")
  })

  test("HOME and CLAUDE_CONFIG_DIR sit in the sandbox, not the real home", () => {
    const { CLAUDE_CONFIG_DIR, HOME, PATH, TEST_SANDBOX_HOME } = process.env
    if (typeof TEST_SANDBOX_HOME !== "string")
      throw new Error("run the suite through bun run test: the sandbox wraps it")
    if (
      typeof HOME !== "string" ||
      typeof CLAUDE_CONFIG_DIR !== "string" ||
      typeof PATH !== "string"
    )
      throw new Error("the sandbox sets HOME, CLAUDE_CONFIG_DIR and PATH")
    expect(homedir()).toBe(HOME)
    expect(HOME.startsWith(TEST_SANDBOX_HOME)).toBe(true)
    expect(CLAUDE_CONFIG_DIR.startsWith(TEST_SANDBOX_HOME)).toBe(true)
    expect(PATH.split(":")[0].endsWith("bin")).toBe(true)
  })
})
