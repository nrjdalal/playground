import { z } from "zod"

import { run } from "@/lib/dashboard/agents"
import { MAX_ATTACHMENT_BYTES } from "@/lib/dashboard/attachments"
import {
  ASSET_URL,
  pullSchema,
  releaseSchema,
  repoOf,
  type Pull,
  type Release,
} from "@/plugins/changelog/sources"

// The CLI's reads of GitHub, each one gh call in the checkout's own repository; only the CLI calls these, never a route, so a fixture stack never reaches GitHub through the changelog.

const GH_MS = 30_000
const PULL_FIELDS = "baseRefName,body,mergeCommit,mergedAt,number,title,url"

async function gh<T>(args: string[], schema: z.ZodType<T>): Promise<T> {
  const name = `gh ${args.slice(0, 3).join(" ")}`
  const { code, out } = await run(["gh", ...args], GH_MS, name)
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`)
  return schema.parse(JSON.parse(out))
}

// The newest merges into canary, at most `limit`: sync reads a few, the seed every one since its floor.
export const readMergedPulls = (limit: number): Promise<Pull[]> =>
  gh(
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--base",
      "canary",
      "--limit",
      String(limit),
      "--json",
      PULL_FIELDS,
    ],
    z.array(pullSchema),
  )

export const readRelease = (tag: string): Promise<Release> =>
  gh(["release", "view", tag, "--json", "body,createdAt,tagName,url"], releaseSchema)

// The published versions' tags, newest first; drafts and pre-releases are not on main yet.
export const readReleaseTags = async (): Promise<string[]> =>
  (
    await gh(
      ["release", "list", "--limit", "100", "--json", "isDraft,isPrerelease,tagName"],
      z.array(
        z.object({
          isDraft: z.boolean(),
          isPrerelease: z.boolean(),
          tagName: z.string(),
        }),
      ),
    )
  )
    .filter((release) => !release.isDraft && !release.isPrerelease)
    .map((release) => release.tagName)

// A PR's comments by the repository's owner, oldest first: the factory posts its evidence as the owner, so another account's image is never copied.
export const readOwnerComments = async (pull: Pick<Pull, "number" | "url">): Promise<string[]> => {
  const repo = repoOf(pull.url)
  const { comments } = await gh(
    ["pr", "view", String(pull.number), "-R", repo, "--json", "comments"],
    z.object({
      comments: z.array(z.object({ author: z.object({ login: z.string() }), body: z.string() })),
    }),
  )
  const owner = repo.split("/")[0]?.toLowerCase()
  return comments
    .filter((comment) => comment.author.login.toLowerCase() === owner)
    .map((comment) => comment.body)
}

// A merge commit's whole message, for a PR whose body gives no detail.
export const readCommitMessage = async (
  pull: Pick<Pull, "mergeCommit" | "number" | "url">,
): Promise<string | null> => {
  if (!pull.mergeCommit) return null
  const { commit } = await gh(
    ["api", `repos/${repoOf(pull.url)}/commits/${pull.mergeCommit.oid}`],
    z.object({ commit: z.object({ message: z.string() }) }),
  )
  return commit.message
}

let token: Promise<string> | null = null

// gh's own token, read once per run and held in memory only, never logged or written.
const ghToken = (): Promise<string> =>
  (token ??= run(["gh", "auth", "token"], GH_MS, "gh auth token").then(({ code, out }) => {
    if (code !== 0 || !out) throw new Error("gh auth token failed; is gh signed in?")
    return out
  }))

// One GitHub-hosted image's bytes. A private repository's asset answers 404 without a token, so the token goes to github.com alone, which answers with a short-lived signed URL on GitHub's storage; that URL is fetched without it.
export async function downloadAsset(url: string): Promise<Uint8Array> {
  if (!ASSET_URL.test(url)) throw new Error(`not a GitHub asset URL: ${url}`)
  const first = await fetch(url, {
    headers: { Authorization: `token ${await ghToken()}` },
    redirect: "manual",
    signal: AbortSignal.timeout(GH_MS),
  })
  const location = first.headers.get("location")
  if (first.status < 300 || first.status >= 400 || !location?.startsWith("https://")) {
    throw new Error(`${url} answered ${first.status}, not a redirect to its file`)
  }
  const file = await fetch(location, {
    redirect: "error",
    signal: AbortSignal.timeout(GH_MS),
  })
  if (!file.ok) throw new Error(`${url}'s file answered ${file.status}`)
  if (Number(file.headers.get("content-length")) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${url} is over 10 MB`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${url} is over 10 MB`)
  return bytes
}

export type GitHub = {
  comments: typeof readOwnerComments
  commitMessage: typeof readCommitMessage
  download: typeof downloadAsset
  merged: typeof readMergedPulls
  release: typeof readRelease
  releaseTags: typeof readReleaseTags
}

export const github: GitHub = {
  comments: readOwnerComments,
  commitMessage: readCommitMessage,
  download: downloadAsset,
  merged: readMergedPulls,
  release: readRelease,
  releaseTags: readReleaseTags,
}
