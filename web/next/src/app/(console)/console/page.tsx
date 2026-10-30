import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"

export default function Page() {
  return (
    <PageShell>
      <PageHeader title="Console" description="Admin tools, in the sidebar for admins." />
    </PageShell>
  )
}
