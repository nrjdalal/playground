import { apiClient, unwrap } from "@/lib/api/client"

export const STACKS_QUERY_KEY = ["dashboard", "stacks"] as const

// Every project's worktrees on this machine, running or stopped, which the Inbox's Preview row offers in its picker.
export async function fetchStacks() {
  const { data, error } = await unwrap(apiClient.v1.stacks.$get())
  if (error) throw new Error(error.message)
  return data
}
