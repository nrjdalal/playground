import { cookies } from "next/headers"

import { SystemHome } from "@/components/dashboard/system-home"
import {
  AGENT_ROWS_COOKIE,
  OLD_AGENT_ROWS_COOKIE,
  storedRows,
} from "@/components/dashboard/system-loading"
import { PageShell } from "@/components/shell/page-shell"

export default async function Page() {
  const cookieStore = await cookies()
  return (
    <PageShell size="lg">
      <SystemHome
        storedRows={storedRows(
          () =>
            cookieStore.get(AGENT_ROWS_COOKIE)?.value ??
            cookieStore.get(OLD_AGENT_ROWS_COOKIE)?.value,
        )}
      />
    </PageShell>
  )
}
