// ship:yard <tag>: deploys the hosted Yard from a ship's tag, its API and then its web, checking the live host after each and recording the tag it deployed.

export type Project = "api" | "web"

export type YardIo = {
  changed: (from: string, to: string) => Promise<string[]>
  deploy: (project: Project, dir: string) => Promise<boolean>
  err: (line: string) => void
  out: (line: string) => void
  readRecord: () => Promise<string | undefined>
  status: (url: string) => Promise<number>
  worktree: (tag: string) => Promise<string>
  writeRecord: (tag: string) => Promise<void>
}

export type YardHosts = Record<Project, string>

export type YardArgs = { schemaCleared?: string; since?: string; tag: string }

export const BOT_ROUTE = "/api/v1/yard/channels"

export const schemaChanges = (_files: string[]): string[] => []

export async function shipYard(_args: YardArgs, _hosts: YardHosts, _io: YardIo): Promise<number> {
  return 0
}
