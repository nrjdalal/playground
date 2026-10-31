"use client"

import { roleAtLeast } from "@packages/auth/access"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

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
  const [decided, setDecided] = useState<YardInvite | null>(null)
  const decide = async (choice: "approveInvite" | "denyInvite") => {
    try {
      setDecided((await yardApi[choice](id)).invite)
    } catch (failure) {
      toast.add({ title: (failure as Error).message, type: "error" })
    }
  }
  const shown = decided ?? invite
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-lg font-semibold">Approve an invite request</h1>
      {!owner ? (
        <p className="text-muted-foreground text-sm">Only the owner lets someone in.</p>
      ) : !isPending && !shown ? (
        <p className="text-muted-foreground text-sm">No invite request has this link.</p>
      ) : shown ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{shown.requestedBy?.login ?? "A member"}</span> asks to
            let <span className="font-medium">{shown.forLogin ?? "someone"}</span> in.
          </p>
          {shown.status === "requested" ? (
            <div className="flex gap-2">
              <Button onClick={() => void decide("approveInvite")}>Approve</Button>
              <Button onClick={() => void decide("denyInvite")} variant="outline">
                Deny
              </Button>
            </div>
          ) : shown.status === "revoked" ? (
            <p className="text-sm">Denied.</p>
          ) : shown.code ? (
            <p className="text-sm">
              Approved. Pass on this code, shown this once:{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono">{shown.code}</code>
            </p>
          ) : (
            <p className="text-sm">Approved.</p>
          )}
        </>
      ) : null}
    </main>
  )
}
