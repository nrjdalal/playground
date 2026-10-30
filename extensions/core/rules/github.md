One GitHub account serves every session: poll a PR at most every {github.pollMinutes} minutes, read through REST, a sweep over many PRs through one batched GraphQL query, and on a rate limit wait for its reset.
Every session shares that account's quotas, so one session's waste stalls them all.
REST has a quota of its own, so a read or a comment post goes through `gh api repos/<owner>/<repo>/...` wherever REST serves it, since `gh pr` commands spend GraphQL.
A sweep over many PRs inverts that, since one batched GraphQL query carrying 50 PRs costs one point where paced REST spends thousands of calls.
On a rate limit, retry nothing before the reset the failing call names.
A PR stacked on another PR's branch keeps that branch as its base after the parent merges, so retarget it to the real base first and confirm its merge commit is an ancestor of the real base before calling it landed.
GITHUB-BULK-READS.md holds the batched query, the quota probe and the rate-limit wait.
