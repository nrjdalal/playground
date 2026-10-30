import { describe, expect, test } from "bun:test"

import {
  type AccountForm,
  accountBody,
  accountFormSchema,
  accountWords,
  addedTitle,
  addOutcome,
  openSignInLabel,
  setupBody,
  signInFor,
  signInServes,
} from "../../../../../web/next/src/lib/accounts"

const form = (more: Partial<AccountForm>): AccountForm => ({
  email: "",
  label: "",
  provider: "claude",
  token: "made.up",
  ...more,
})
const issues = (value: ReturnType<typeof form>) =>
  accountFormSchema.safeParse(value).error?.issues.map((issue) => issue.path.join(".")) ?? []

describe("the Add account form", () => {
  test("a Claude account needs an email, and a GLM key a label", () => {
    expect(issues(form({}))).toEqual(["email"])
    expect(issues(form({ email: "made-up@example.test" }))).toEqual([])
    expect(issues(form({ provider: "glm" }))).toEqual(["label"])
    expect(issues(form({ label: "zai", provider: "glm" }))).toEqual([])
  })

  test("a label is lowercase letters, digits, dots, dashes and underscores, and the token one word", () => {
    expect(issues(form({ email: "made-up@example.test", label: "Work" }))).toEqual(["label"])
    expect(issues(form({ email: "made-up@example.test", token: "" }))).toEqual(["token"])
    expect(issues(form({ email: "made-up@example.test", token: "made up" }))).toEqual(["token"])
  })

  test("sends only its provider's fields", () => {
    expect(
      accountBody(form({ email: "made-up@example.test", label: "zai", provider: "glm" })),
    ).toEqual({ label: "zai", provider: "glm", token: "made.up" })
    expect(accountBody(form({ email: " made-up@example.test ", token: " made.up " }))).toEqual({
      email: "made-up@example.test",
      provider: "claude",
      token: "made.up",
    })
  })
})

describe("a Claude sign-in", () => {
  const signIn = {
    browser: { name: "Chrome" },
    email: "made-up@example.test",
    id: "made-up-id",
    label: "work",
    url: "https://example.com/sign-in/made-up-id",
  }

  test("starts for the form's email and label, or says what to fix first", () => {
    expect(signInFor(form({ email: " made-up@example.test ", label: " work " }))).toEqual({
      email: "made-up@example.test",
      label: "work",
    })
    expect(signInFor(form({}))).toEqual({ refused: "Type the email of the account to add first" })
    expect(signInFor(form({ email: "made-up@example.test", label: "Work" }))).toEqual({
      refused: "Lowercase letters, digits, dots, dashes and underscores",
    })
    expect(setupBody({ email: "made-up@example.test", label: "" })).toEqual({
      email: "made-up@example.test",
    })
    expect(setupBody({ email: "made-up@example.test", label: "work" })).toEqual({
      email: "made-up@example.test",
      label: "work",
    })
  })

  test("serves the form only while its email and label are the ones it started for", () => {
    expect(signInServes(signIn, form({ email: "made-up@example.test", label: "work" }))).toBe(true)
    expect(signInServes(signIn, form({ email: "other@example.test", label: "work" }))).toBe(false)
    expect(signInServes(signIn, form({ email: "made-up@example.test" }))).toBe(false)
    expect(signInServes(null, form({ email: "made-up@example.test", label: "work" }))).toBe(false)
  })

  test("names the open button by the sign-in: Open sign-in first, then its browser's fresh profile, and none with Safari alone", () => {
    expect(openSignInLabel(null)).toBe("Open sign-in")
    expect(openSignInLabel(signIn)).toBe("Open in Chrome · fresh profile")
    expect(openSignInLabel({ browser: null })).toBeNull()
  })

  test("asks for the code it shows, and a GLM key for its API key", () => {
    const message = (value: AccountForm) =>
      accountFormSchema.safeParse(value).error?.issues.find((issue) => issue.path[0] === "token")
        ?.message
    expect(message(form({ email: "made-up@example.test", token: "" }))).toBe(
      "Paste the code the sign-in shows",
    )
    expect(message(form({ label: "zai", provider: "glm", token: "" }))).toBe("Paste the API key")
  })
})

describe("an account's row", () => {
  test("names a Claude account by its label over its email, and says whether its token is kept", () => {
    expect(
      accountWords(
        {
          email: "made-up@example.test",
          key: "made-up@example.test",
          label: "work",
          provider: "claude",
          stored: true,
        },
        "made-up@example.test",
      ),
    ).toEqual({
      description: "Claude · made-up@example.test · Token kept · Logged in",
      title: "work",
    })
    expect(
      accountWords({ email: null, key: "zai", label: "zai", provider: "glm", stored: false }),
    ).toEqual({ description: "GLM · No token kept", title: "zai" })
  })
})

describe("an Add's answer", () => {
  const account = { email: null, key: "zai", label: "zai", provider: "glm" as const, stored: true }

  test("is the account added, or the API's own words for a refusal, the 409 for no login included", async () => {
    expect(await addOutcome(async () => ({ data: { account }, error: null }))).toEqual({ account })
    const noLogin =
      "Accounts are kept in your settings, which need a login: run playground ext init"
    expect(await addOutcome(async () => ({ data: null, error: { message: noLogin } }))).toEqual({
      refused: noLogin,
    })
    expect(
      await addOutcome(async () => ({ data: null, error: { message: "zai is already listed" } })),
    ).toEqual({ refused: "zai is already listed" })
  })

  test("carries a Claude sign-in's confirmed, so the toast says when its account was not read back", async () => {
    expect(
      await addOutcome(async () => ({ data: { account, confirmed: false }, error: null })),
    ).toEqual({ account, confirmed: false })
    expect(addedTitle("pat@example.com", false)).toBe(
      "pat@example.com added, account not confirmed",
    )
    expect(addedTitle("pat@example.com", true)).toBe("pat@example.com added")
    expect(addedTitle("zai")).toBe("zai added")
  })
})
