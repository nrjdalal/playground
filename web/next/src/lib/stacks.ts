import { apiClient, unwrap } from "@/lib/api/client"

export const STACKS_QUERY_KEY = ["dashboard", "stacks"] as const

// Every project's worktrees on this machine, running or stopped, which the Inbox's Preview row offers in its picker.
export async function fetchStacks() {
  const { data, error } = await unwrap(apiClient.v1.stacks.$get())
  if (error) throw new Error(error.message)
  return data
}

// A stopped worktree started as a Vibeground on a copy of the live database, on the owner's click; a refusal throws its reason.
export async function startStack(path: string) {
  const { data, error } = await unwrap(apiClient.v1.stacks.start.$post({ json: { path } }))
  if (error) throw new Error(error.message)
  return data
}

// A Vibeground stopped, its copy removed and its worktree kept.
export async function stopStack(path: string) {
  const { error } = await unwrap(apiClient.v1.stacks.stop.$post({ json: { path } }))
  if (error) throw new Error(error.message)
}
