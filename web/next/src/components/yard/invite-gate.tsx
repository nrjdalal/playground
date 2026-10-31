"use client"

import { inviteCodeSchema } from "@packages/message"
import { useForm } from "@tanstack/react-form"
import { useRouter } from "next/navigation"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { yardApi } from "@/lib/yard-api"

// Yard is invite-only: a signed-in user with no invite enters the code a member's request got approved, and joins.
export function InviteGate() {
  const router = useRouter()
  const form = useForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      try {
        await yardApi.redeem(value.code.trim())
        router.replace("/yard")
        router.refresh()
      } catch (error) {
        toast.add({ title: (error as Error).message, type: "error" })
      }
    },
    validators: { onSubmit: z.object({ code: inviteCodeSchema }) },
  })
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-lg font-semibold">Yard is invite-only</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FieldGroup>
          <form.Field name="code">
            {(field) => {
              const isInvalid = !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="invite-code">Invite code</FieldLabel>
                  <Input
                    aria-invalid={isInvalid}
                    autoComplete="off"
                    id="invite-code"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  {isInvalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : (
                    <FieldDescription>
                      Ask a member to request one for your GitHub login.
                    </FieldDescription>
                  )}
                </Field>
              )
            }}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.code}>
            {(code) => (
              <Button disabled={!code.trim()} type="submit">
                Join
              </Button>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </main>
  )
}
