import { AppList } from "@/components/apps/app-list"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Apps"
        description="Tools beside the workers, each showing what a skill or the sessions produced."
      />
      <AppList />
    </PageShell>
  )
}
