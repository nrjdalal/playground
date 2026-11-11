import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { launchOf, lw, placing, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// A built trial world: a fake herdr-core that logs each call's words and the variables the wrapper sets or drops, with the pin its build would write; changed rewrites the binary after the pin, as a swapped copy would be.
const FAKE_HC = `#!/bin/bash
printf '%s\\x1f' "$@" >> "$HOME/hc.calls"
printf '\\n' >> "$HOME/hc.calls"
printf '%s\\n' "HC_SESSION=$HC_SESSION" "HC_TRIAL_START=\${HC_TRIAL_START:+set}" "HERDR_PANE_ID=\${HERDR_PANE_ID-unset}" "PLAYGROUND_ROLE=\${PLAYGROUND_ROLE-unset}" "SSH_CONNECTION=$SSH_CONNECTION" "XDG_CONFIG_HOME=$XDG_CONFIG_HOME" "XDG_STATE_HOME=$XDG_STATE_HOME" > "$HOME/hc.env"
[ "$1" = --version ] && echo "hc 0.1.20"
exit 0
`
const world =
  (changed = false) =>
  (home: string) => {
    const binary = lw(home, "hc-trial", "bin", "herdr-core")
    mkdirSync(join(binary, ".."), { recursive: true })
    writeFileSync(binary, FAKE_HC)
    chmodSync(binary, 0o755)
    writeFileSync(
      lw(home, "hc-trial", "pin"),
      `${new Bun.CryptoHasher("sha256").update(FAKE_HC).digest("hex")}\n`,
    )
    // The socket folder the wrapper reuses while it stands, made in the case's home so none lands in the user's temp folder.
    mkdirSync(join(home, "hc-run"))
    writeFileSync(lw(home, "hc-trial", "runtime-dir"), `${join(home, "hc-run")}\n`)
    if (changed) writeFileSync(binary, `${FAKE_HC}# swapped\n`)
  }
const hcCalls = (r: { home: string }): string[][] => {
  const f = join(r.home, "hc.calls")
  if (!existsSync(f)) return []
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x1f").slice(0, -1))
}

describe("a probe starts in hc's trial world with --runtime hc (#1715)", () => {
  test("it opens as a terminal named for it through the world's wrapper, with no herdr call and no resume record", async () => {
    const r = await spawn(
      ["probe", "probe-hc-a", "worker-x", "b.md", "--runtime", "hc"],
      [],
      { HERDR_PANE_ID: "w1:p1", PLAYGROUND_ROLE: "worker" },
      undefined,
      undefined,
      world(),
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    const launch = join(r.home, ".playground", "launch", "probe-hc-a.sh")
    expect(hcCalls(r)).toEqual([
      ["--version"],
      ["run", "--bg", "--no-parent", "--name", "probe-hc-a", "--cwd", root, "bash", launch],
    ])
    expect(r.out).toContain("hc terminal probe-hc-a")
    expect(readFileSync(join(r.home, "hc.env"), "utf8")).toBe(
      [
        "HC_SESSION=pgtrial",
        "HC_TRIAL_START=",
        "HERDR_PANE_ID=unset",
        "PLAYGROUND_ROLE=unset",
        "SSH_CONNECTION=127.0.0.1 1 127.0.0.1 22",
        `XDG_CONFIG_HOME=${realpathSync(lw(r.home, "hc-trial", "config"))}`,
        `XDG_STATE_HOME=${realpathSync(lw(r.home, "hc-trial", "state"))}`,
        "",
      ].join("\n"),
    )
    expect(launchOf(r)).toContain(
      "unset SSH_CONNECTION XDG_CONFIG_HOME XDG_RUNTIME_DIR XDG_STATE_HOME\n",
    )
    expect(readFileSync(lw(r.home, "hc-trial", "hc"), "utf8")).toBe(
      readFileSync(join(root, "scripts", "hc-trial.sh"), "utf8"),
    )
    expect(
      readFileSync(lw(r.home, "hc-trial", "config", "herdr-core", "config.toml"), "utf8"),
    ).toBe("notes = false\n")
    expect(readFileSync(lw(r.home, "runtimes", "probe-hc-a"), "utf8")).toBe("hc\n")
    expect(existsSync(lw(r.home, "resume", "probe-hc-a.sh"))).toBe(false)
    expect(placing(r)).toEqual([])
  })

  test("a world whose binary no longer hashes to its pin is refused, and the binary never runs", async () => {
    const r = await spawn(
      ["probe", "probe-hc-a", "worker-x", "b.md", "--runtime", "hc"],
      [],
      {},
      undefined,
      undefined,
      world(true),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("the trial world's hc does not run")
    expect(r.err).toContain("not its pin")
    expect(hcCalls(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes", "probe-hc-a"))).toBe(false)
  })

  const PROBE_ALONE = "--runtime hc starts a probe alone"
  test.each([
    ["a worker", ["worker", "worker-x", "b.md", "--title", "Plain test work"], PROBE_ALONE],
    ["a runner", ["runner", "runner-x", "b.md"], PROBE_ALONE],
    [
      "a reviewer's column",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "b.md", "--pr", "1"],
      PROBE_ALONE,
    ],
    ["a probe's column", ["column", "probe", "probe-x", "worker-x", "w1:p2", "b.md"], PROBE_ALONE],
    ["a manager", ["manager", "builder", "brief-builder.md"], PROBE_ALONE],
    ["a resume", ["resume", "worker-x", root], PROBE_ALONE],
    ["a restore", ["restore"], "restore takes no other words"],
    ["a close", ["close", "worker-x"], "close takes a session's name alone"],
  ])(
    "%s with --runtime hc is refused, with no hc call and no world built",
    async (_, args, says) => {
      const r = await spawn([...args, "--runtime", "hc"], [], {})
      expect(r.code).not.toBe(0)
      expect(r.err).toContain(says)
      expect(hcCalls(r)).toEqual([])
      expect(existsSync(lw(r.home, "hc-trial"))).toBe(false)
      expect(placing(r)).toEqual([])
    },
  )
})
