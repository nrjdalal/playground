import { reachesConsole } from "@packages/auth/access"
import { notFound } from "next/navigation"

// The hosted build (Yard) serves the dashboard's pages to the owner rung alone, through the relay to the owner's own Mac: their layout calls this first, with the hosted session's user, so any other visit answers the app's 404 before anything else is read, and a local stack passes straight through.
export const localPagesOnly = (
  hosted: boolean,
  user: { banned?: boolean | null; role?: string | null } | null,
) => {
  if (hosted && !(user && reachesConsole(user, "owner"))) notFound()
}

// Its mirror: Yard's own pages under /yard exist on the hosted build alone, so a local stack answers each with the app's 404.
export const hostedPagesOnly = (hosted: boolean) => {
  if (!hosted) notFound()
}
