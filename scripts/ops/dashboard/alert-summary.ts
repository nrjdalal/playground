type Alert = Record<string, unknown>

// "None" for a missing or null key, where String(null) would print "null".
const text = (v: unknown): string => (v == null ? "None" : String(v))

export const summarize = (alerts: Alert | Alert[]): string => {
  const list = Array.isArray(alerts) ? alerts : [alerts]
  return list.map((a) => `${text(a.kind)} ${text(a.name)} since ${text(a.since)}`).join("; ")
}

if (import.meta.main) {
  const alerts = (await Bun.file(process.argv[2]).json()) as Alert | Alert[]
  console.log(summarize(alerts))
}
