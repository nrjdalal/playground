import { join } from "node:path"
import { parseArgs } from "node:util"

import { tree } from "../trace-count/count"
import { type Hit, leg1, leg2, line, orgTerms } from "./audit"

const USAGE = `Usage: bun run core-audit

Prints each place core holds a linked org's term (leg 1, read at run time from the
extensions, skipped when no org is linked) or a value shaped like one org's (leg 2),
one line a hit: path:line, the leg, the kind and where it belongs, never the matched
text. Ends with a count per kind, and exits 1 on any hit. Exits 2 when an org is
linked and no-public-leak's list is missing or a key of it is empty, or its policy
does not parse, since leg 1 would then read nothing and print a false all-clear.`

const { values } = parseArgs({ options: { help: { short: "h", type: "boolean" } } })
if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const root = join(import.meta.dir, "..", "..", "..", "..")
const files = await tree(root)
const read = await orgTerms(process.env)
if (read && "refusal" in read) {
  console.error(`core-audit: ${read.refusal}`)
  process.exit(2)
}
const terms = read
const hits: Hit[] = [...(terms ? leg1(files, terms) : []), ...leg2(files)]
for (const hit of hits) console.log(line(hit))
if (!terms) console.log("leg 1: no org linked, so no org's terms to read")
const counts = new Map<string, number>()
for (const hit of hits) {
  const key = `leg ${hit.leg} ${hit.kind}`
  counts.set(key, (counts.get(key) ?? 0) + 1)
}
console.log(
  counts.size
    ? [...counts].map(([key, n]) => `${key}: ${n}`).join("\n")
    : `0 hits on ${terms ? "both legs" : "leg 2"}`,
)
process.exit(hits.length ? 1 : 0)
