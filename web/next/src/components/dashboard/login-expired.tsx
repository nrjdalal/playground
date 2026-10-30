"use client"

import type { Worker } from "@api/hono"
import { useMutation } from "@tanstack/react-query"
import * as React from "react"

import { AddAccountDialog } from "@/components/settings/add-account-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { apiClient, unwrap } from "@/lib/api/client"

// Restarts a session whose login expired, on the account just added or, with none, on this Mac's own login.
const restartSession = (sessionId: string, account?: string) =>
  unwrap(
    apiClient.v1.workers[":sessionId"].restart.$post({
      json: account ? { account } : {},
      param: { sessionId },
    }),
  )

// A session whose Claude login expired: Add account opens Settings' own dialog, and the account it keeps restarts the session on it, its conversation kept; Restart reopens it on this Mac's own login, for a sign-in made since. Neither needs a terminal.
export function LoginExpired({ label, worker }: { label: string; worker: Worker }) {
  const [refused, setRefused] = React.useState<string | null>(null)
  const restart = useMutation({
    mutationFn: async (account?: string) => {
      const { error } = await restartSession(worker.sessionId, account)
      if (error) throw new Error(error.message)
      return account
    },
    onError: (error) => setRefused(error.message),
    onSuccess: (account) => {
      setRefused(null)
      toast.add({
        title: account ? `${label} restarted on ${account}` : `${label} restarted`,
        type: "success",
      })
    },
  })
  return (
    <Alert data-slot="login-expired" variant="destructive" className="mt-3 mb-4">
      <AlertTitle>{label}&apos;s Claude login expired</AlertTitle>
      <AlertDescription>
        <p>
          Add a Claude account and {label} restarts on it, with its conversation kept. Signed in
          again on this Mac already? Restart it on that login.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AddAccountDialog
            disabled={restart.isPending}
            onAdded={(account) => {
              if (account.provider === "claude" && account.email) restart.mutate(account.email)
            }}
            trigger={<Button size="sm" />}
          >
            Add account
          </AddAccountDialog>
          <Button
            size="sm"
            variant="outline"
            disabled={restart.isPending}
            onClick={() => restart.mutate(undefined)}
          >
            {restart.isPending ? <Spinner /> : null}
            Restart
          </Button>
        </div>
        {refused ? <p className="mt-2 whitespace-pre-wrap select-text">{refused}</p> : null}
      </AlertDescription>
    </Alert>
  )
}
