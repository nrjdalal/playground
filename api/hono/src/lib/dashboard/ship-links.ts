// Pure: a ship decision with each PR it lists given its page in repo (owner/name), so its card opens each one; any other item, or no repo, as it came.
export function linkShipPrs(input: unknown, repo: string): unknown {
  if (!repo || typeof input !== "object" || input === null) return input
  const preview = (input as { preview?: unknown }).preview
  if (typeof preview !== "object" || preview === null) return input
  const ship = preview as { prs?: unknown; type?: unknown }
  if (ship.type !== "ship" || !Array.isArray(ship.prs)) return input
  const prs = ship.prs.map((pr: unknown) =>
    typeof pr === "object" && pr !== null && Number.isInteger((pr as { number?: unknown }).number)
      ? { ...pr, url: `https://github.com/${repo}/pull/${(pr as { number: number }).number}` }
      : pr,
  )
  return { ...input, preview: { ...ship, prs } }
}

// Pure: owner/name from a GitHub remote URL (https or ssh), else "".
export const repoOfRemote = (url: string): string =>
  /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())?.[1] ?? ""
