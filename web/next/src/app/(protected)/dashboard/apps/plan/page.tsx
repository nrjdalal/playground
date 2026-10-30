import { PlanView } from "@/app/(protected)/dashboard/apps/plan/components/plan-view"
import { PageShell } from "@/components/shell/page-shell"

export default function Page() {
  return (
    <PageShell size="lg">
      <PlanView />
    </PageShell>
  )
}
