// alias.ts <routes.json> <url>...: whether each bare alias holds the port of the live stack's own route in portless's route file, read only; a url's host less its first label is its bare alias (desk.playground.localhost's is playground.localhost). Prints one line, and exits 0 when every alias holds its port, else 1, a missing file, unreadable JSON or a missing route included.
type Route = { hostname?: unknown; port?: unknown }

export const checkAliases = (file: string, text: string | null, urls: string[]) => {
  if (text === null) return { line: `no route file at ${file}`, ok: false }
  let routes: Route[]
  try {
    routes = JSON.parse(text)
    if (!Array.isArray(routes)) throw new Error("not a list")
  } catch {
    return { line: `the route file ${file} is not JSON`, ok: false }
  }
  const ports = new Map(routes.map((r) => [r.hostname, r.port]))
  const pairs = urls.map((url) => {
    const own = new URL(url).hostname
    return { bare: own.split(".").slice(1).join("."), own }
  })
  const held: unknown[] = []
  for (const { bare, own } of pairs) {
    for (const host of [own, bare])
      if (!ports.has(host)) return { line: `no route for ${host} in ${file}`, ok: false }
    if (ports.get(bare) !== ports.get(own))
      return {
        line: `${bare} points at port ${ports.get(bare)}, but the live stack's ${own} is on ${ports.get(own)}`,
        ok: false,
      }
    held.push(ports.get(own))
  }
  return {
    line: `${pairs.map((p) => p.bare).join(" and ")} hold the live stack's ports ${held.join(" and ")}`,
    ok: true,
  }
}

if (import.meta.main) {
  const [file = "", ...urls] = process.argv.slice(2)
  const text = await Bun.file(file)
    .text()
    .catch(() => null)
  const { line, ok } = checkAliases(file, text, urls)
  console.log(line)
  process.exit(ok ? 0 : 1)
}
