export type Entry = "hosted" | "local" | { refused: string }

// Which app this process serves, decided once at boot: the hosted build (Yard) under PLAYGROUND_HOSTED, else the local dashboard, which refuses to serve on Vercel, since a deploy there is public and the dashboard reads every session's transcript.
export const entryOf = ({
  hosted,
  vercel,
}: {
  hosted: boolean
  vercel: string | undefined
}): Entry => {
  if (hosted) return "hosted"
  if (vercel === "1")
    return {
      refused:
        "a local build will not serve on Vercel, since the dashboard is never deployed; the hosted build sets PLAYGROUND_HOSTED=1",
    }
  return "local"
}
