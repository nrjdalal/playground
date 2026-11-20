// An `ask get` item from a run's joined output (job.ts's `out + err`): the text from the first `{` to the last `}`, so any stderr line after the JSON leaves the parse whole.
export const askItemText = (out: string): string =>
  out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)
