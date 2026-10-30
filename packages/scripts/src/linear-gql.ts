// One Linear GraphQL call for the scripts that read or write Linear: the key goes only into the Authorization header, a failure names Linear's status and first error, and every failure masks the key, should Linear or the fetch echo it.
const TIMEOUT_MS = 60_000

export type Gql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>

export const linearGql =
  (key: string, fetchImpl: typeof fetch = fetch): Gql =>
  async (query, variables = {}) => {
    if (!key) throw new Error("LINEAR_API_KEY is not set")
    const res = await fetchImpl("https://api.linear.app/graphql", {
      body: JSON.stringify({ query, variables }),
      headers: { Authorization: key, "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw new Error((err instanceof Error ? err.message : String(err)).replaceAll(key, "***"))
    })
    const body = (await res.json().catch(() => ({}))) as {
      data?: unknown
      errors?: { message?: string }[]
    }
    if (res.ok && body.data && !body.errors?.length) return body.data
    const message = (body.errors?.[0]?.message ?? res.statusText).replaceAll(key, "***")
    throw new Error(`Linear ${res.status}: ${message}`.slice(0, 200))
  }
