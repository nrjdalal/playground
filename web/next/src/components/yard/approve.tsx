"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { TranscriptMessage } from "@/components/transcript-message"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { FromLine } from "@/components/yard/channel-view"
import { MessageLinks } from "@/components/yard/message-links"
import { YARD_KEY } from "@/lib/yard"
import { yardApi } from "@/lib/yard-api"

// A tier-two post waits until its sender's own signed-in web session sends it or denies it here, after reading what it says; a token never can. An Inbox card's Approve opens this page.
export function Approve({ id }: { id: string }) {
  const client = useQueryClient()
  const { data: message, error } = useQuery({
    queryFn: async () => (await yardApi.message(id)).message,
    queryKey: [...YARD_KEY, "message", id],
  })
  const [decided, setDecided] = useState<string | null>(null)
  const decide = async (choice: "approve" | "deny") => {
    try {
      setDecided((await yardApi[choice](id)).message.status ?? "sent")
      // the channel and the sidebar read again, so the decision shows there
      void client.invalidateQueries({ queryKey: YARD_KEY })
    } catch (failure) {
      toast.add({ title: (failure as Error).message, type: "error" })
    }
  }
  const status = decided ?? message?.status ?? "sent"
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-lg font-semibold">Approve a waiting message</h1>
      {error && (
        <p className="text-muted-foreground text-sm">No waiting message of yours has this link.</p>
      )}
      {message && (
        <TranscriptMessage
          at={message.at}
          now={new Date()}
          plain
          text={message.text}
          variant="muted"
          who={<FromLine message={message} />}
        >
          <MessageLinks links={message.links} />
        </TranscriptMessage>
      )}
      {message && status === "pending" ? (
        <div className="flex gap-2">
          <Button onClick={() => void decide("approve")}>Approve and send</Button>
          <Button onClick={() => void decide("deny")} variant="outline">
            Deny
          </Button>
        </div>
      ) : message ? (
        <p className="text-sm">
          {status === "denied" ? "Denied: it stays with you alone." : "Sent."}
        </p>
      ) : null}
    </main>
  )
}
