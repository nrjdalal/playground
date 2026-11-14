export type Tunnel = { host: string; key: string; port: number; user: string }

export const tunnelOf = (_row: unknown, _home: string, _user: string): Tunnel => ({
  host: "",
  key: "",
  port: 0,
  user: "",
})

export const sshArgs = (_tunnel: Tunnel): string[] => []

export const linkOf = (_port: number): string => ""

export const whyOf = (_stderr: string, _tunnel: Tunnel, _code: number): string => ""

export const keep = async (_options: {
  data: string
  env: Record<string, string | undefined>
  listens?: (port: number) => Promise<boolean>
  maxWaitMs?: number
  minWaitMs?: number
  post?: (link: string, host: string) => Promise<string | null>
  signal: AbortSignal
}): Promise<void> => {}
