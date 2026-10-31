"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { yardApi } from "@/lib/yard-api"

// Yard is invite-only: a signed-in user with no invite enters the code a member's request got approved, and joins.
export function InviteGate() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const redeem = async () => {
    try {
      await yardApi.redeem(code.trim())
      router.replace("/yard")
      router.refresh()
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-lg font-semibold">Yard is invite-only</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void redeem()
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-code">Invite code</FieldLabel>
            <Input
              id="invite-code"
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
              value={code}
            />
            <FieldDescription>Ask a member to request one for your GitHub login.</FieldDescription>
          </Field>
          <Button disabled={!code.trim()} type="submit">
            Join
          </Button>
        </FieldGroup>
      </form>
    </main>
  )
}
