// alias.ts <routes.json> <url>...: whether each bare alias holds the port of the live stack's own route in portless's route file, read only; a url's host less its first label is its bare alias (desk.playground.localhost's is playground.localhost). Prints one line, and exits 0 when every alias holds its port, 1 when one points at another port, and 2 for a missing file, unreadable JSON or a missing route.
type Route = { hostname?: unknown; port?: unknown }

export const checkAliases = (file: string, text: string | null, urls: string[]) => {
  if (text === null) return { code: 2, line: `no route file at ${file}` }
  let routes: Route[]
  try {
    routes = JSON.parse(text)
    if (!Array.isArray(routes)) throw new Error("not a list")
  } catch {
    return { code: 2, line: `the route file ${file} is not JSON` }
  }
  const ports = new Map(routes.map((r) => [r.hostname, r.port]))
  const pairs = urls.map((url) => {
    const own = new URL(url).hostname
    return { bare: own.split(".").slice(1).join("."), own }
  })
  const held: unknown[] = []
  for (const { bare, own } of pairs) {
    for (const host of [own, bare])
      if (!ports.has(host)) return { code: 2, line: `no route for ${host} in ${file}` }
    if (ports.get(bare) !== ports.get(own))
      return {
        code: 1,
        line: `${bare} points at port ${ports.get(bare)}, but the live stack's ${own} is on ${ports.get(own)}`,
      }
    held.push(ports.get(own))
  }
  return {
    code: 0,
    line: `${pairs.map((p) => p.bare).join(" and ")} hold the live stack's ports ${held.join(" and ")}`,
  }
}

if (import.meta.main) {
  const [file = "", ...urls] = process.argv.slice(2)
  const text = await Bun.file(file)
    .text()
    .catch(() => null)
  const { code, line } = checkAliases(file, text, urls)
  console.log(line)
  process.exit(code)
}
