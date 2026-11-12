// The PR body the body and merge-on-ready tests share, in the pr skill's template, its Evidence opening with an A/B line.
export const SKILL_BODY = [
  "## TL;DR",
  "",
  "The board shows each PR once. You see one row for each PR.",
  "",
  "## Summary",
  "",
  "The board reads each PR once.",
  "",
  "## Evidence",
  "",
  "- A/B: rows a PR shows, A canary 2, B branch 1, n=12 against a bar of 1",
  "- **Before:** two rows. **After:** one.",
  "",
  "## Merge Danger",
  "",
  "**Door:** two-way",
  "",
  "**Blast Radius:** board",
  "",
  "## Links",
  "",
  "- Closes #1906",
].join("\n")

// The pr skill's file as git show reads it at a head, its template inside its first markdown fence, for a stub or scratch git the body gate reads it through.
export const PR_TEMPLATE =
  "Use this template:\n\n```markdown\n**Door:** <one-way or two-way>\n```\n"
