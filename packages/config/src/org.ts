import { z } from "zod"

type Env = Record<string, string | undefined>

// The one place an organisation's own values come from: who owns the dashboard and which integrations it runs, each read from env with a generic default, so a copy for anyone else names no person, team or workspace. Pure: it reads only the env it is given. The data folder is data-dir.ts's, in packages/env, since it reads the disk.
export const orgSchema = z.object({
  integrations: z.object({
    slack: z.object({ enabled: z.stringbool().default(false) }),
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

// Pure: the organisation's config from env; throws on a value its schema refuses.
export const orgOf = (env: Env): Org =>
  orgSchema.parse({
    integrations: {
      slack: { enabled: envValue(env, "SLACK_ENABLED") },
    },
    owner: { name: envValue(env, "PLAYGROUND_OWNER_NAME") },
    work: { label: envValue(env, "WORK_LABEL"), org: envValue(env, "WORK_GITHUB_ORG") },
  })
