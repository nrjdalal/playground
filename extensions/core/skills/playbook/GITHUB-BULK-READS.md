# Reading many PRs in one query

A sweep over many PRs (an inventory, a recovery scan, an org-wide check) reads through one batched GraphQL query, not paced REST: 50 PRs a query, each node carrying its files, reviews and dates, cost one point a query measured (a dry run gave `cost: 1` for 50 PRs with files and reviews), and 996 PRs took 20 queries, estimated from that cost,
where the same sweep through paced REST spent about 2,000 calls, estimated, and the shared 5,000/h quota at 04:31Z on 26 Oct ([rules/github.md](../../rules/github.md), the **github** rule).
code-review-loop's `state.py scan` batches its PR reads too (`SCAN_QUERY`), and names the shape to copy.
A single PR's read stays REST.

1. Probe the budget before the first batch.
   Done when you know what a batch may spend.

   ```bash
   gh api graphql -f query='query { rateLimit { cost remaining resetAt } }'
   ```

2. Page the batched query, 50 PRs a page.
   Ask only the fields the sweep reads; every extra field spends points.
   `states` takes `OPEN`, `CLOSED` and `MERGED`, so an inventory passes all three; `files(first: 50)` cuts a PR with more files, and a sweep that counts files raises the count and its cost with it.
   Carry `rateLimit { cost remaining }` in the query, so each page reports what it spent.
   Done when the page returns and `rateLimit` shows what it spent.

   ```graphql
   query ($owner: String!, $name: String!, $cursor: String, $states: [PullRequestState!]) {
     rateLimit {
       cost
       remaining
     }
     repository(owner: $owner, name: $name) {
       pullRequests(first: 50, after: $cursor, states: $states) {
         pageInfo {
           hasNextPage
           endCursor
         }
         nodes {
           number
           title
           updatedAt
           headRefName
           isDraft
           files(first: 50) {
             nodes {
               path
             }
           }
           reviews(last: 1) {
             nodes {
               state
               submittedAt
               author {
                 login
               }
             }
           }
         }
       }
     }
   }
   ```

   ```bash
   gh api graphql -f owner=<owner> -f name=<repo> -f cursor= -F query=@query.graphql
   ```

3. Feed each page's `pageInfo.endCursor` back as `$cursor` until `hasNextPage` is false.
   Done when the sweep holds every PR the filters name and nothing was read twice.

On a refused call, wait for the reset the rule names and retry nothing before it: the probe's `remaining` is the budget, and a sweep that would outspend it waits or narrows its filters first.

## On a rate limit

Wait until the reset the failing call's own `X-RateLimit-Reset` header gives (`gh api -i` prints it), or, when no header came back, each quota's `reset` from `gh api rate_limit`, though that can disagree, and retry nothing before then.
code-review-loop's `state.py wait` does both.
Done when the reset has passed and the retried call answers.
