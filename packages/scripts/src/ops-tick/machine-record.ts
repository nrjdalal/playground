import { homedir, hostname } from "node:os"
import { dirname, join } from "node:path"

import { cloneOf } from "@packages/config/org"
import { factoryHomes, readPolicyOrDefaults } from "@packages/settings"

import { check, peerRecordArgv } from "../machine-record/record"
import type { Context } from "./tick"

const PEER_MS = 120_000

// The first line a failed ssh printed, or its exit.
const firstLine = (out: string, code: number) =>
  out
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? `exit ${code}`

// machine-record: the machine record's daily check, here and on each peer the checkout's .env names (PLAYGROUND_PEERS, through ops-peer-relay's clusterOf), each peer reached by peerRecordArgv's one ssh; every finding is one line to ops, led by its machine's name, and a peer the check cannot reach is one line too. home and the root-step folders (record.ts's ROOT_FOLDERS when unset) are a test's seams.
export const machineRecord =
  (home: string = process.env.HOME || homedir(), system?: string[]) =>
  async (ctx: Context) => {
    const data = dirname(ctx.ops)
    const here = hostname().split(".")[0]!
    const homes = factoryHomes(
      readPolicyOrDefaults(data).settings ?? { schemaVersion: 1, values: {} },
      {
        checkout: ctx.repo,
        data,
        home,
      },
    )
    const lines = (await check(data, { home, homes, run: ctx.run, system })).map(
      (line) => `${here}: ${line}`,
    )
    // loaded here, since the relay imports this beat's tick.ts for its heartbeat
    const { clusterOf, envKeysOf } = await import("../ops-peer-relay/relay")
    const env = Bun.file(join(ctx.repo, ".env"))
    const cluster = clusterOf(envKeysOf((await env.exists()) ? await env.text() : ""), home)
    if ("why" in cluster) lines.push(`peers not checked: ${cluster.why}`)
    else {
      const clone = cloneOf(ctx.repo, home)
      for (const peer of cluster.peers) {
        if (clone === null) {
          lines.push(
            `${peer.name}: not checked, since this checkout is not a plain path under home`,
          )
          continue
        }
        const ran = await ctx.run(peerRecordArgv(cluster.key, peer.target, clone, "check"), PEER_MS)
        // the check exits 0 with no finding and 1 with some; any other exit is ssh's or the clone's
        if (ran.code > 1) lines.push(`${peer.name}: not checked: ${firstLine(ran.out, ran.code)}`)
        else
          for (const line of ran.out.split("\n").filter((l) => /^\w+: /.test(l)))
            lines.push(`${peer.name}: ${line}`)
      }
    }
    for (const line of lines) await ctx.send("ops", `machine record: ${line}`)
  }
