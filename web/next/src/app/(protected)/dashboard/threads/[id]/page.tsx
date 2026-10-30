import { ThreadView } from "@/components/dashboard/thread-view"
import { PageShell } from "@/components/shell/page-shell"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const thread = decodeURIComponent(id)
  return (
    <PageShell className="flex flex-1 flex-col">
      <ThreadView key={thread} id={thread} />
    </PageShell>
  )
}
