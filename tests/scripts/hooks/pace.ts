import { stepsTaken } from "../../../scripts/hooks/shell"

// The process's CPU time so far in ms, which a busy machine's waits leave out, where they stretch a clock's reading.
const cpu = (): number => {
  const { system, user } = process.cpuUsage()
  return (system + user) / 1000
}

// How many times more CPU time a hook takes over a command than over a same-length `echo` of one word and `tail`, each the fastest of `runs` taken in turn, so a bound holds however busy the machine is; `tail` gives the baseline what makes the hook read the whole line.
export async function overBaseline(
  check: (command: string) => Promise<unknown>,
  command: string,
  tail = "",
  runs = 5,
): Promise<number> {
  const baseline = `echo ${"a".repeat(Math.max(1, command.length - 5 - tail.length))}${tail}`
  let base = Infinity
  let took = Infinity
  for (let i = 0; i < runs; i++) {
    let started = cpu()
    await check(baseline)
    base = Math.min(base, cpu() - started)
    started = cpu()
    await check(command)
    took = Math.min(took, cpu() - started)
  }
  return took / base
}

// What `run` returns and the steps shell.ts's tick() counted while it ran, a count no load stretches.
export async function stepsOf<T>(run: () => Promise<T>): Promise<[T, number]> {
  const before = stepsTaken()
  const result = await run()
  return [result, stepsTaken() - before]
}
