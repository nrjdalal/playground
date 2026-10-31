"use client"

import { roleAtLeast } from "@packages/auth/access"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { INVITES_KEY, yardApi, type YardInvite } from "@/lib/yard-api"

// A member's request to let a GitHub login in waits until the owner's own signed-in web session opens it here, which mints its code, shown this once to pass on, or denies it; a token never can.
export function InviteRequest({ id, role }: { id: string; role: string | null | undefined }) {
  const owner = roleAtLeast(role, "owner")
  const { data: invite, isPending } = useQuery({
    enabled: owner,
    queryFn: async () => (await yardApi.invites()).invites.find((row) => row.id === id) ?? null,
    queryKey: [...INVITES_KEY, id],
  })
  const client = useQueryClient()
  const [decided, setDecided] = useState<YardInvite | null>(null)
  const decide = async (choice: "approveInvite" | "denyInvite") => {
    try {
      setDecided((await yardApi[choice](id)).invite)
      // Account's request list reads again, so the decided one leaves it
      void client.invalidateQueries({ queryKey: INVITES_KEY })
    } catch (failure) {
      toast.add({ title: (failure as Error).message, type: "error" })
    }
  }
  const shown = decided ?? invite
  return (
    <PageShell size="sm">
      <PageHeader
        title="Approve an invite request"
        description="Let a GitHub login into Yard, or turn it away."
      />
      <div className="flex flex-col gap-4">
        <RequestState decide={decide} isPending={isPending} owner={owner} shown={shown} />
      </div>
    </PageShell>
  )
}

// What the page says of the request: who may decide, whether it exists, and where its decision stands.
function RequestState({
  decide,
  isPending,
  owner,
  shown,
}: {
  decide: (action: "approveInvite" | "denyInvite") => Promise<void>
  isPending: boolean
  owner: boolean
  shown: YardInvite | null | undefined
}) {
  if (!owner)
    return <p className="text-muted-foreground text-sm">Only the owner lets someone in.</p>
  if (!shown)
    return isPending ? null : (
      <p className="text-muted-foreground text-sm">No invite request has this link.</p>
    )
  return (
    <>
      <p className="text-sm">
        <span className="font-medium">{shown.requestedBy?.login ?? "A member"}</span> asks to let{" "}
        <span className="font-medium">{shown.forLogin ?? "someone"}</span> in.
      </p>
      <Outcome decide={decide} shown={shown} />
    </>
  )
}

function Outcome({
  decide,
  shown,
}: {
  decide: (action: "approveInvite" | "denyInvite") => Promise<void>
  shown: YardInvite
}) {
  if (shown.status === "requested")
    return (
      <div className="flex gap-2">
        <Button onClick={() => void decide("approveInvite")}>Approve</Button>
        <Button onClick={() => void decide("denyInvite")} variant="outline">
          Deny
        </Button>
      </div>
    )
  if (shown.status === "revoked") return <p className="text-sm">Denied.</p>
  if (!shown.code) return <p className="text-sm">Approved.</p>
  return (
    <p className="text-sm">
      Approved. Pass on this code, shown this once:{" "}
      <code className="bg-muted rounded px-1.5 py-0.5 font-mono">{shown.code}</code>
    </p>
  )
}
