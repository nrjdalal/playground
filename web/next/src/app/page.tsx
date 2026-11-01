import { site } from "@packages/config/site"
import { redirect } from "next/navigation"

import { config } from "@/lib/config"

// The dashboard is the home: a visit with no session gets its first-run pane there. The hosted build has no dashboard pages, so its home is the way in, the navbar's Sign in with GitHub.
export default function Home() {
  if (!config.hosted) redirect("/dashboard")
  return (
    <main className="flex flex-col items-center gap-2 px-6 py-32 text-center">
      <h1 className="text-2xl font-semibold">{site.name}</h1>
      <p className="text-muted-foreground text-sm">Sign in with GitHub to continue.</p>
    </main>
  )
}
