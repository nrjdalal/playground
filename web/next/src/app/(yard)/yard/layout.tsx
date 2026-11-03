import { config } from "@/lib/config"
import { hostedPagesOnly } from "@/lib/local-pages"

// Yard's own pages exist on the hosted build alone: a local stack answers each with the app's 404, as the hosted build answers the dashboard's.
export default function YardLayout({ children }: { children: React.ReactNode }) {
  hostedPagesOnly(config.hosted)
  return children
}
