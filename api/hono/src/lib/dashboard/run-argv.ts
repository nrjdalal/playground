const RUN_TIMEOUT_MS = 30_000

// An argv run with no shell, its output read whole and killed past its timeout: the step a grant decision's Approve runs, and a root step's with system/root.ts's ROOT_TIMEOUT_MS (ArgvRun in inbox.ts); input goes to its stdin, so a peer install's password never sits in an argv.
export const runArgv = async (argv: string[], timeout: number = RUN_TIMEOUT_MS, input?: string) => {
  const child = Bun.spawn(argv, {
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new Blob([input]),
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
