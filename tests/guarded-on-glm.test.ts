import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { sourceIn } from "./glm-refused-sources"

const root = join(import.meta.dir, "..")

// What points a job at GLM: Claude Code's model remap, spawn.sh's GLM backend, a GLM model, Z.ai's endpoint, or its Keychain item.
const GLM = /ANTHROPIC_DEFAULT_[A-Z]+_MODEL|--backend glm|\bglm-\d|api\.z\.ai|\w+-glm(?=["'\s])/
// A claude token (a "claude" literal, a claude* or CLAUDE* name or call, a $CLAUDE word) followed by -p or --print in the same argv or line; an argv may run across lines after a comma, a shell line after a backslash.
const HEADLESS =
  /(?:\bclaude\w*(?:\(\))?|\bCLAUDE\w*|\$\{?CLAUDE\w*\}?)["'}]?\)?(?:[^\]);|&`\n]|,\s*\n|\\\n)*?(?<=[\s,"'`(])(?:-p|--print)(?=["'\s,\])`]|$)/m
// A job that drops ANTHROPIC_BASE_URL, or every ANTHROPIC_ variable by its prefix, before its claude starts.
const CLEARS =
  /(?:\.pop\(|\bdel\b|\bdelete\b|\benv -u\b|\bunset\b)[^\n]{0,30}ANTHROPIC_BASE_URL|startsWith\(\s*["']ANTHROPIC_["']|\$\{!ANTHROPIC_@\}/i
// Comment lines and Python docstrings (a triple-quoted string that opens its line), which can name `claude -p` without running it.
const code = (text: string) =>
  text
    .replace(/"""[\s\S]*?"""/g, (string, at: number) =>
      /^\s*$/.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at)) ? "" : string,
    )
    .split("\n")
    .filter((line) => !/^\s*(?:#|\/\/|\/\*|\*(?:\s|\/|$))/.test(line))
    .join("\n")

// Why a job's file can start on GLM: it names a word of the glm-refused-sources list and wires GLM, or it starts claude on whatever backend the shell that runs it was given.
function findings(path: string, text: string): string[] {
  const out: string[] = []
  const source = sourceIn(text)
  const glm = text.match(GLM)?.[0]
  if (source && glm) out.push(`${path}: names a refused source (${source}) and wires GLM (${glm})`)
  if (HEADLESS.test(code(text)) && !CLEARS.test(code(text)))
    out.push(
      `${path}: starts a headless claude on the environment it inherits, so a GLM shell's ANTHROPIC_BASE_URL reaches it; clear the GLM variables`,
    )
  return out
}

// Shaped like the 26 Oct ops-linear edit: a Linear scan whose claude child was pointed at Z.ai.
const GLM_EDIT = `CWD = os.path.join(HOME, "example-org")
LINEAR_URL = "https://api.linear.app/graphql"

def child_env():
    env = dict(os.environ)
    tk = subprocess.run(["security", "find-generic-password", "-s", "playground-glm", "-a", "zai", "-w"], capture_output=True, text=True).stdout.strip()
    env.update(ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic", ANTHROPIC_AUTH_TOKEN=tk, ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.3-flash")
    return env

subprocess.run([CLAUDE, "-p", "/example-scan", "--model", "opus"], env=child_env())
`

// The same job before the edit: its claude child takes the shell's environment whole.
const INHERITS = `LINEAR_URL = "https://api.linear.app/graphql"

def child_env():
    return dict(os.environ)

subprocess.run([CLAUDE, "-p", "/example-scan", "--model", "opus"], env=child_env())
`

// The fixed shape: the child drops every GLM variable before claude starts.
const CLEARED = `LINEAR_URL = "https://api.linear.app/graphql"

def child_env():
    env = dict(os.environ)
    env.pop("ANTHROPIC_BASE_URL", None)
    env.pop("ANTHROPIC_AUTH_TOKEN", None)
    return env

subprocess.run([CLAUDE, "-p", "/example-scan", "--model", "opus"], env=child_env())
`

describe("no job naming a refused source can start on GLM", () => {
  test("a job shaped like the 26 Oct ops-linear edit is refused, naming its source and its GLM wiring", () => {
    expect(findings("ops/example/scan.py", GLM_EDIT)).toEqual([
      "ops/example/scan.py: names a refused source (linear) and wires GLM (playground-glm)",
      "ops/example/scan.py: starts a headless claude on the environment it inherits, so a GLM shell's ANTHROPIC_BASE_URL reaches it; clear the GLM variables",
    ])
  })

  test("a job whose claude child inherits the shell's backend is refused", () => {
    expect(findings("ops/example/scan.py", INHERITS)).toEqual([
      "ops/example/scan.py: starts a headless claude on the environment it inherits, so a GLM shell's ANTHROPIC_BASE_URL reaches it; clear the GLM variables",
    ])
  })

  test("a job that clears the GLM variables passes", () => {
    expect(findings("ops/example/scan.py", CLEARED)).toEqual([])
  })

  test.each([
    ['["claude", "-p", "/example-scan"]', "scan.ts"],
    ['[claude, "--model", model, "-p", "/example-scan"]', "scan.py"],
    ["claude --model opus -p /example-scan", "run.sh"],
    ["await Bun.$`claude -p /example-scan`", "scan.ts"],
    ['subprocess.run("claude -p /example-scan", shell=True)', "scan.py"],
    ['"$CLAUDE" -p /example-scan', "run.sh"],
    ["claude --print /example-scan", "run.sh"],
    ["claude \\\n  --model opus -p /example-scan", "run.sh"],
    ['[shutil.which("claude"), "-p", "/example-scan"]', "scan.py"],
    ['case "$1" in\n  scan) run_scan ;;\n  *) claude -p "$P" ;;\nesac', "run.sh"],
    ['SCRIPT = """\nclaude -p /example-scan\n"""\nsubprocess.run(SCRIPT, shell=True)', "scan.py"],
    ['A = """x\n"""\nsubprocess.run("claude -p /example-scan", shell=True)\n"""Doc."""', "scan.py"],
  ])("a headless start written as %s is refused", (line, file) => {
    expect(findings(`ops/example/${file}`, `${line}\n`)).toHaveLength(1)
  })

  test.each([
    ["a comment naming one", "# runs claude -p elsewhere\nclaude --version\n"],
    ["a docstring naming one", '"""Runs claude -p elsewhere."""\n'],
    ["a ps read by pid", '["ps", "-o", "command=", "-p", pid]\n'],
    ["a prefix unset first", "unset ${!ANTHROPIC_@}\nclaude -p /example-scan\n"],
  ])("%s is no inherited start", (_, text) => {
    expect(findings("ops/example/run.sh", text)).toEqual([])
  })

  test("a comment that names a clear does not clear", () => {
    expect(
      findings("ops/example/run.sh", "# unset ANTHROPIC_BASE_URL here\nclaude -p /example-scan\n"),
    ).toHaveLength(1)
  })

  test("a job that sets ANTHROPIC_BASE_URL rather than clearing it is refused", () => {
    const text =
      'env["ANTHROPIC_BASE_URL"] = base\nsubprocess.run([CLAUDE, "-p", "/example-scan"], env=env)\n'
    expect(findings("ops/example/scan.py", text)).toHaveLength(1)
  })

  test("every ops job in the repo, and the code it runs, keeps a guarded org's data off GLM", async () => {
    const tracked =
      await Bun.$`git ls-files --cached --others --exclude-standard scripts/ops packages/scripts/src api/hono/src skills`
        .cwd(root)
        .text()
    const files = tracked.split("\n").filter((file) => /\.(?:py|sh|ts)$/.test(file))
    expect(files.length).toBeGreaterThan(100)
    const found = await Promise.all(
      files.map(async (file) => findings(file, await Bun.file(join(root, file)).text())),
    )
    expect(found.flat()).toEqual([])
  })
})
