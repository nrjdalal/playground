import { features } from "@packages/config/site"
import { notFound } from "next/navigation"

import { PageShell } from "@/components/shell/page-shell"
import { ChangelogView } from "@/plugins/changelog/view"

export default function Page() {
  if (!features.changelog) notFound()
  return (
    <PageShell size="full" className="flex flex-col md:h-full">
      <ChangelogView />
    </PageShell>
  )
}
