import { UsageView } from "@/app/(protected)/dashboard/apps/usage/components/usage-view"
import { PageShell } from "@/components/shell/page-shell"

export default function Page() {
  return (
    <PageShell size="lg">
      <UsageView />
    </PageShell>
  )
}
