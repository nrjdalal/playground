import { SessionsDataTable } from "@/app/(protected)/dashboard/sessions/components/data-table"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"

export default function Page() {
  return (
    <PageShell size="lg" className="flex h-full flex-col">
      <PageHeader title="Sessions" description="Every Claude Code session here, live and past." />
      <SessionsDataTable />
    </PageShell>
  )
}
