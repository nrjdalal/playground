// How many times longer a hook takes over a command than over a same-length `echo` of one word and `tail`, each the fastest of `runs` taken in turn, so a bound holds however busy the machine is; `tail` gives the baseline what makes the hook read the whole line.
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
    let started = performance.now()
    await check(baseline)
    base = Math.min(base, performance.now() - started)
    started = performance.now()
    await check(command)
    took = Math.min(took, performance.now() - started)
  }
  return took / base
}
