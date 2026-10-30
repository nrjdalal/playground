import { PreviewsView } from "@/app/(protected)/dashboard/apps/previews/components/previews-view"
import { PageShell } from "@/components/shell/page-shell"

export default function Page() {
  return (
    <PageShell size="lg">
      <PreviewsView />
    </PageShell>
  )
}
