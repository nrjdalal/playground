import { SessionView } from "@/components/sessions/session-view"
import { PageShell } from "@/components/shell/page-shell"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <PageShell size="lg">
      <SessionView id={decodeURIComponent(id)} />
    </PageShell>
  )
}
