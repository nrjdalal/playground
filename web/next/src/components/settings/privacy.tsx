"use client"

import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { SetUpSettings } from "@/components/settings/set-up-settings"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ACCOUNTS_QUERY_KEY, readAccounts } from "@/lib/accounts"
import {
  PRIVACY_KEYS,
  type PrivacyForm,
  privacyFormSchema,
  privacyQueryKey,
  privacyValues,
  readPrivacySetting,
  savePrivacySetting,
} from "@/lib/privacy"

const text = (value: unknown) => (typeof value === "string" ? value : "")
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((name) => typeof name === "string").join(", ") : ""

// Settings > Privacy: the names you go by and the private archive repository, which the trace count and the leak guard read, each saved at your login's scope once it changes. While the first reads are pending it holds its space empty; before the settings are set up it shows Set up settings, as Accounts does.
export function Privacy() {
  const login = useQuery({ queryKey: ACCOUNTS_QUERY_KEY, queryFn: readAccounts })
  const archive = useQuery({
    queryKey: privacyQueryKey(PRIVACY_KEYS.archive),
    queryFn: () => readPrivacySetting(PRIVACY_KEYS.archive),
  })
  const names = useQuery({
    queryKey: privacyQueryKey(PRIVACY_KEYS.names),
    queryFn: () => readPrivacySetting(PRIVACY_KEYS.names),
  })
  const error = login.error ?? archive.error ?? names.error
  const scope = login.data?.scope
  return (
    <section aria-labelledby="settings-privacy" className="flex flex-col gap-2">
      <h2 id="settings-privacy" className="text-muted-foreground text-sm font-medium">
        Privacy
      </h2>
      {login.data?.login === false ? (
        <SetUpSettings />
      ) : error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Privacy could not be read</EmptyTitle>
            <EmptyDescription>{error.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : scope && archive.isSuccess && names.isSuccess ? (
        <PrivacyFields
          saved={{ archive: text(archive.data), names: list(names.data) }}
          scope={scope}
        />
      ) : (
        <div aria-busy="true" className="h-14" />
      )}
    </section>
  )
}

function PrivacyFields({ saved, scope }: { saved: PrivacyForm; scope: string }) {
  const queryClient = useQueryClient()
  const before = privacyValues(saved)
  const form = useForm({
    defaultValues: saved,
    onSubmit: async ({ value }) => {
      const changed = privacyValues(value).filter(
        (field, i) => JSON.stringify(field.value) !== JSON.stringify(before[i]!.value),
      )
      try {
        for (const field of changed) await savePrivacySetting(field.key, field.value, scope)
        toast.add({ title: changed.length ? "Privacy saved" : "Nothing changed", type: "success" })
      } catch (error) {
        toast.add({ title: (error as Error).message, type: "error" })
      } finally {
        for (const field of changed)
          await queryClient.invalidateQueries({ queryKey: privacyQueryKey(field.key) })
      }
    },
    validators: { onSubmit: privacyFormSchema },
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="names">
          {(field) => (
            <PrivacyField
              description="Your first name and handles, lowercase, separated by commas. The trace count looks for them in the repo."
              field={field}
              label="Names you go by"
              placeholder="yourname, yourhandle"
            />
          )}
        </form.Field>
        <form.Field name="archive">
          {(field) => (
            <PrivacyField
              description="A link into it is private history: the trace count counts it, and the leak guard keeps it out of public writes."
              field={field}
              label="Private archive repository"
              placeholder="owner/name"
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Field orientation="horizontal">
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Spinner />}
                Save
              </Button>
            </Field>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  )
}

type TextFieldApi = {
  handleBlur: () => void
  handleChange: (value: string) => void
  name: string
  state: { meta: { errors: unknown[]; isValid: boolean }; value: string }
}

function PrivacyField({
  description,
  field,
  label,
  placeholder,
}: {
  description: string
  field: TextFieldApi
  label: string
  placeholder: string
}) {
  const isInvalid = !field.state.meta.isValid
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        autoComplete="off"
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={isInvalid}
      />
      {isInvalid ? (
        <FieldError errors={field.state.meta.errors as { message?: string }[]} />
      ) : (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  )
}
