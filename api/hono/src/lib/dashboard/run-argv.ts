const RUN_TIMEOUT_MS = 30_000

// An argv run with no shell, its output read whole and killed past its timeout: the step a grant decision's Approve runs, and a root step's with system/root.ts's ROOT_TIMEOUT_MS (ArgvRun in inbox.ts).
export const runArgv = async (argv: string[], timeout: number = RUN_TIMEOUT_MS) => {
  const child = Bun.spawn(argv, {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout,
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code: code ?? 1, err: err.trim(), out: out.trim() }
}
