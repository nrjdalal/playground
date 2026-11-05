"use client"

import { RELAY_PREFIX } from "@packages/message"
import { RiKey2Line, RiShieldKeyholeLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { apiClient, unwrap } from "@/lib/api/client"
import { config } from "@/lib/config"
import { makeBrowserKey, readBrowserKey } from "@/lib/remote-key"
import { relativeTime } from "@/lib/time"

const REMOTE_KEY = ["remote"] as const

// How often the Mac's Remote section reads again, so a pair request sent from Yard shows while the page is open.
const REMOTE_POLL_MS = 5000

// Settings > Remote: on this Mac, the browser key Yard's writes will count from and the pair request waiting on Approve; on the hosted Yard, this browser's own key and the pair request it sends to the Mac.
export function Remote() {
  return (
    <section aria-labelledby="settings-remote" className="flex flex-col gap-2">
      <h2 id="settings-remote" className="text-muted-foreground text-sm font-medium">
        Remote
      </h2>
      {config.hosted ? <PairThisBrowser /> : <MacRemote />}
    </section>
  )
}

function MacRemote() {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery({
    queryFn: async () => {
      const { data, error } = await unwrap(apiClient.v1.remote.$get())
      if (error) throw new Error(error.message)
      return data
    },
    queryKey: REMOTE_KEY,
    refetchInterval: REMOTE_POLL_MS,
  })
  const [revoking, setRevoking] = React.useState(false)
  const now = new Date()
  const refresh = () => queryClient.invalidateQueries({ queryKey: REMOTE_KEY })

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await unwrap(apiClient.v1.remote.approve.$post({ json: { id } }))
      if (error) throw new Error(error.message)
      return data
    },
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSettled: refresh,
    onSuccess: (key) => toast.add({ title: `Paired ${key.fingerprint}`, type: "success" }),
  })
  const revoke = useMutation({
    mutationFn: async () => {
      const { error } = await unwrap(apiClient.v1.remote.revoke.$post())
      if (error) throw new Error(error.message)
    },
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSettled: refresh,
    onSuccess: () => {
      setRevoking(false)
      toast.add({ title: "Key revoked", type: "success" })
    },
  })

  if (isPending) return <div aria-busy="true" className="h-14" />
  if (error)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Remote could not be read</EmptyTitle>
          <EmptyDescription>{error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const { key, pending } = data
  return (
    <>
      {key || pending ? (
        <ItemGroup className="gap-2">
          {pending && (
            <Item variant="outline" size="sm">
              <ItemMedia variant="icon">
                <RiShieldKeyholeLine />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Pair request from @{pending.login}</ItemTitle>
                <ItemDescription>
                  <span className="font-mono">{pending.fingerprint}</span> · asked{" "}
                  {relativeTime(pending.at, now)}. Approve only if your browser shows this
                  fingerprint{key ? "; it replaces the key paired now" : ""}.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(pending.id)}
                >
                  {approve.isPending && <Spinner />}
                  Approve
                </Button>
              </ItemActions>
            </Item>
          )}
          {key && (
            <Item variant="outline" size="sm">
              <ItemMedia variant="icon">
                <RiKey2Line />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Paired browser key</ItemTitle>
                <ItemDescription>
                  <span className="font-mono">{key.fingerprint}</span> · @{key.login} · paired{" "}
                  {relativeTime(key.pairedAt, now)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="sm" onClick={() => setRevoking(true)}>
                  Revoke
                </Button>
              </ItemActions>
            </Item>
          )}
        </ItemGroup>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No browser key paired</EmptyTitle>
            <EmptyDescription>
              Pair from Settings on the hosted Yard: the browser's request waits here for your
              Approve.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title="Revoke the paired key?"
        description="Writes that key signs are refused from now on. Pair again from the browser to send from Yard."
        action="Revoke"
        variant="destructive"
        pending={revoke.isPending}
        onConfirm={() => revoke.mutate()}
      />
    </>
  )
}

// the pair request goes to the hosted relay itself, which apiClient points past
async function sendPair(publicKey: unknown): Promise<string> {
  const response = await fetch(`${config.api.url}${RELAY_PREFIX}/pair`, {
    body: JSON.stringify({ key: publicKey }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  const body = (await response.json().catch(() => null)) as {
    data?: { fingerprint: string }
    error?: { message: string }
  } | null
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "The Mac did not answer")
  return body.data.fingerprint
}

function PairThisBrowser() {
  const { data: browserKey, isPending } = useQuery({
    queryFn: readBrowserKey,
    queryKey: ["remote", "browser"],
  })
  const [sent, setSent] = React.useState<string | null>(null)
  const pair = useMutation({
    mutationFn: async () => sendPair((browserKey ?? (await makeBrowserKey())).publicKey),
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: setSent,
  })
  if (isPending) return <div aria-busy="true" className="h-14" />
  return (
    <ItemGroup className="gap-2">
      <Item variant="outline" size="sm">
        <ItemMedia variant="icon">
          <RiKey2Line />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>This browser's key</ItemTitle>
          <ItemDescription>
            {sent ? (
              <>
                Approve <span className="font-mono">{sent}</span> in your Mac's Settings, under
                Remote.
              </>
            ) : browserKey ? (
              <>
                <span className="font-mono">{browserKey.fingerprint}</span>. Pair it with your Mac
                to send from Yard.
              </>
            ) : (
              "Pair this browser with your Mac to send from Yard. Its key stays in this browser."
            )}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            variant="outline"
            size="sm"
            disabled={pair.isPending}
            onClick={() => pair.mutate()}
          >
            {pair.isPending && <Spinner />}
            {sent ? "Send again" : "Pair"}
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
