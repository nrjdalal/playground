// A process killed at a timeout may hold its pipes open past SIGKILL (a child that inherited its stdout), so a caller that waits on them unbounded waits forever. The wait is bounded instead: settle within the bound, or give up and let the caller throw as timed out.
export async function settledWithin<T>(read: Promise<T>, boundMs: number): Promise<T | undefined> {
  let bound: ReturnType<typeof setTimeout> | undefined
  const over = new Promise<undefined>((resolve) => {
    bound = setTimeout(() => resolve(undefined), boundMs)
  })
  const answer = await Promise.race([read, over])
  clearTimeout(bound)
  if (answer === undefined) read.catch(() => null)
  return answer
}
