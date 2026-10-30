import type { Session } from "@packages/auth"
import { headers } from "next/headers"

import { apiClient } from "@/lib/api/client"
import { readSession } from "@/lib/auth/session"

export const auth = {
  api: {
    // Signed out (null) only on the API's word; while it restarts the read waits, then throws ApiUnavailable for the error boundary, so a dashboard roll never drops the page to the first-run pane.
    getSession: async (opts?: { disableCookieCache?: boolean }) => {
      const url = apiClient.auth["get-session"].$url()
      // Bypass the 300s session cookie cache so a just-changed role takes effect immediately (used by the console gate).
      if (opts?.disableCookieCache) url.searchParams.set("disableCookieCache", "true")
      const sent = Object.fromEntries((await headers()).entries())
      return readSession<Session>((signal) => fetch(url, { headers: sent, signal }))
    },
  },
}
