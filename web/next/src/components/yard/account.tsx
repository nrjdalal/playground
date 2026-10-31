"use client"

import { roleAtLeast } from "@packages/auth/access"
import { invitePath, tokenNameSchema } from "@packages/message"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { inviteRequests } from "@/lib/yard"
import { INVITES_KEY, TOKENS_KEY, yardApi } from "@/lib/yard-api"

// Account and tokens: each token is a device's way to post without a browser, named for that device (never "web"), its secret shown once. A member asks the owner to let someone in here, and the owner sees those requests.
export function Account({ role }: { role: string | null | undefined }) {
  const client = useQueryClient()
  const { data: tokens } = useQuery({
    queryFn: async () => (await yardApi.tokens()).tokens,
    queryKey: TOKENS_KEY,
  })
  const [name, setName] = useState("")
  const [secret, setSecret] = useState<string | null>(null)
  const parsed = name ? tokenNameSchema.safeParse(name) : null
  const create = async () => {
    if (!parsed?.success) return
    try {
      const { token } = await yardApi.createToken(parsed.data)
      setSecret(token.secret)
      setName("")
      await client.invalidateQueries({ queryKey: TOKENS_KEY })
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  const revoke = async (id: string) => {
    try {
      await yardApi.revokeToken(id)
      await client.invalidateQueries({ queryKey: TOKENS_KEY })
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6">
      <h1 className="text-lg font-semibold">Account and tokens</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <FieldGroup>
          <Field data-invalid={parsed?.success === false || undefined}>
            <FieldLabel htmlFor="token-name">New token, named for its device</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="token-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="macbook"
                value={name}
              />
              <Button disabled={!parsed?.success} type="submit">
                Create
              </Button>
            </div>
            {parsed?.success === false && (
              <FieldError>{parsed.error.issues[0]?.message}</FieldError>
            )}
          </Field>
        </FieldGroup>
      </form>
      {secret && (
        <div className="bg-muted rounded-md p-3 text-xs">
          <p className="mb-1 font-medium">Copy it now: it is shown this once.</p>
          <code className="break-all">{secret}</code>
        </div>
      )}
      <ul className="divide-y rounded-md border text-sm">
        {tokens?.map((token) => (
          <li key={token.id} className="flex items-center gap-3 px-3 py-2">
            <span className="font-medium">{token.name}</span>
            <span className="text-muted-foreground text-xs">
              {token.revokedAt
                ? "Revoked"
                : token.lastUsedAt
                  ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                  : "Never used"}
            </span>
            {!token.revokedAt && (
              <Button
                className="ml-auto"
                onClick={() => void revoke(token.id)}
                size="sm"
                variant="outline"
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
        {tokens?.length === 0 && (
          <li className="text-muted-foreground px-3 py-2 text-xs">No tokens yet.</li>
        )}
      </ul>
      {roleAtLeast(role, "owner") ? <InviteRequests /> : <RequestInvite />}
    </main>
  )
}

// Each member's request to let someone in, opening its own page to approve or deny it.
function InviteRequests() {
  const { data: requests } = useQuery({
    queryFn: async () => inviteRequests((await yardApi.invites()).invites),
    queryKey: INVITES_KEY,
  })
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Invite requests</h2>
      <ul className="divide-y rounded-md border text-sm">
        {requests?.map((invite) => (
          <li key={invite.id}>
            <Link className="hover:bg-muted flex px-3 py-2" href={invitePath(invite.id)}>
              {invite.requestedBy?.login ?? "A member"} asks to let {invite.forLogin ?? "someone"}{" "}
              in
            </Link>
          </li>
        ))}
        {requests?.length === 0 && (
          <li className="text-muted-foreground px-3 py-2 text-xs">None waiting.</li>
        )}
      </ul>
    </section>
  )
}

// A member asks the owner to let a GitHub login in; the request waits on the owner's approval, from this web session alone, as a token never asks.
function RequestInvite() {
  const [login, setLogin] = useState("")
  const [sent, setSent] = useState<string | null>(null)
  const request = async () => {
    const forLogin = login.trim()
    if (!forLogin) return
    try {
      await yardApi.requestInvite(forLogin)
      setSent(forLogin)
      setLogin("")
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void request()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invite-login">Ask to let someone in, by GitHub login</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="invite-login"
              onChange={(event) => setLogin(event.target.value)}
              placeholder="octocat"
              value={login}
            />
            <Button disabled={!login.trim()} type="submit">
              Ask
            </Button>
          </div>
          {sent && (
            <p className="text-muted-foreground text-xs">
              Asked for {sent}. It waits on the owner&apos;s approval.
            </p>
          )}
        </Field>
      </FieldGroup>
    </form>
  )
}
