import { z } from "zod"

type Env = Record<string, string | undefined>

// One other machine the System panel reads over ssh: its name on the page and the user@host ssh reaches it at, neither able to become a flag.
export const peerSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  target: z.string().regex(/^[A-Za-z0-9._][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/),
})

export type Peer = z.infer<typeof peerSchema>

// The one place an organisation's own values come from: who owns the dashboard and whose work queue it reads, each read from env with a generic default, so a copy for anyone else names no person, team or workspace. Pure: it reads only the env it is given. The data folder is data-dir.ts's, in packages/env, since it reads the disk.
export const orgSchema = z.object({
  // The other machines the System panel sums with this one (none by default, so one machine shows alone) and the ssh key it reaches them with (none, ssh's own default).
  cluster: z.object({
    key: z.string().startsWith("/").optional(),
    // each name once in any case, since a peer's password item takes its name lowercased (peerSecret), so two names equal but for case would share one
    peers: z
      .array(peerSchema)
      .default([])
      .refine(
        (peers) => new Set(peers.map((peer) => peer.name.toLowerCase())).size === peers.length,
        "each peer name is listed once, in any case",
      ),
  }),
  owner: z.object({ name: z.string().default("Owner") }),
  // The owner's day-job pull requests, which the Pull requests tab shows beside the dashboard's own queue: the GitHub org they are read from (unset, no work queue) and what the queue is called.
  work: z.object({
    label: z.string().default("Work"),
    org: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
  }),
})

export type Org = z.infer<typeof orgSchema>

// Pure: the first of these env names holding a value, an empty one read as unset; a renamed key lists its new name first and its old one after, which still reads.
export const envValue = (env: Env, ...names: string[]): string | undefined =>
  names.map((name) => env[name]).find(Boolean)

// Pure: PLAYGROUND_PEERS's comma list of name=user@host, each split at its first =, for the schema to check.
const peersOf = (value: string | undefined) =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf("=")
      return at < 0
        ? { name: "", target: entry }
        : { name: entry.slice(0, at), target: entry.slice(at + 1) }
    })

// Pure: the organisation's config from env; throws on a value its schema refuses.
export const orgOf = (env: Env): Org =>
  orgSchema.parse({
    cluster: {
      key: envValue(env, "PLAYGROUND_PEER_KEY"),
      peers: peersOf(envValue(env, "PLAYGROUND_PEERS")),
    },
    owner: { name: envValue(env, "PLAYGROUND_OWNER_NAME") },
    work: { label: envValue(env, "WORK_LABEL"), org: envValue(env, "WORK_GITHUB_ORG") },
  })
