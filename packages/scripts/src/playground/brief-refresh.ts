export type Send = (to: string, text: string) => Promise<boolean>

export const refreshBriefs = async (_o: {
  data: string
  live: (name: string) => boolean
  log: (line: string) => void
  managers: { kind: string; name: string }[]
  old: string
  repo: string
  send: Send
}): Promise<void> => {}

export const tellPending = async (_data: string, _name: string, _send: Send): Promise<boolean> =>
  false
