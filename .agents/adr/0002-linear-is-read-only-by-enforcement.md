# linear is read-only by enforcement: a forked subagent with the write tools removed

linear only reads, and triage-and-implement calls it in the middle of a run. "Read-only" held in practice (no write calls in two live runs), but only because the instructions said so. The goal was a block that cannot be ignored and that does not take triage-and-implement's own write tools away.

## What was tested (Claude Code 2.1.286, live `claude -p` runs, 5 Oct 2026)

| Setup | Write inside the read-only skill | Write back in the calling skill | Write on the next turn |
|---|---|---|---|
| `disallowed-tools` on the main thread | denied | **still denied** until the turn ends | allowed |
| Control: no `disallowed-tools` | allowed | allowed | allowed |
| `disallowed-tools` with `context: fork`, `background: false` | denied | allowed | allowed |

Inside a fork, every form tried enforced exactly what it named: an exact MCP tool name (`mcp__linear-shared__list_teams` denied, `get_team` allowed), a glob (`mcp__linear-shared__list_*`), a whole server (`mcp__linear-shared` denied both), and Bash prefixes (`Bash(gh pr comment:*)` denied `gh pr comment --help | head -1`, while an unrelated `echo` ran).

## Decision

linear runs with `context: fork` and `background: false`, and its `disallowed-tools` removes file writes, Linear, GitHub and Slack writes, every MCP server it has no use for (Notion, PostHog, Nylas, 1Password, Figma, Datadog, Wispr Flow, Claude Docs, computer use, and the bare-named `notion`, `datadog` and `langsmith` servers), `Agent`, `Workflow`, `Artifact`, `Skill` and `EnterWorktree`, and these commands: the git subcommands that write to a repo, the working tree or the disk that are listed in the frontmatter (`push`, `commit`, `checkout`, `reset`, `merge`, `branch`, `fetch`, `clone`, `config`, `remote`, `format-patch` and more), the global options that front them (`-C`, `-c`, `--no-pager`, `--git-dir` and `--work-tree`, the last two also as `--opt=<path>`), since a probe showed `git -C <repo> push` gets past a `git push` prefix (branches are listed by URL with `git ls-remote --heads https://github.com/...`), and every `gh` command group and alias that can write (gh 2.102: all but the read-only `search`, `status`, `browse`, `attestation`, `licenses` and `completion`), including the built-in `gh co` alias for `pr checkout`. triage-and-implement asks it for a **verdict** on a ticket (`free`, `check first`, `skipped`) instead of loading the intake rules into its own context, since a fork returns only its final message.

On the main thread the block would last for the rest of the turn, and triage-and-implement's continuations stay inside one turn, so a non-forked linear would strand the run. `tests/test_skill_frontmatter.py` therefore fails any skill that uses `disallowed-tools` without a fork.

## Consequences

- Each verdict costs a subagent: slower and more tokens than reading the rules inline.
- Residual gaps, read-only by instruction only: Bash can still write files (`>`, `tee`, `sed -i`) and can reach a write command under another spelling (`/usr/bin/git push`, `env git push`, `sh -c ...`, or a global option not listed, such as `git --bare`), since prefix rules match only the direct form, and a git subcommand not listed stays open; a tool added later to an allowed server (Linear, GitHub, Slack) is open until its name matches a pattern here; an MCP server under a name not listed here is open; built-in tools not listed (CronCreate, TaskStop and the like) stay available; and a `gh` group or alias added later is open until it is listed.
- A typed `/linear` in a headless run executes without the "forked execution" wrapper, but the blocklist still applied in every probe.
- claim (ADR 0003) reuses this fork and blocklist with exactly two writes left open: assigning a Linear issue and sending a Slack DM.
- end-of-day's scan (7 Oct 2026) reuses the fork and blocklist but blocks `gh pr` and `gh api` by write form instead of whole group, so `gh pr view` and `gh api` GETs run: each `gh pr` write and its aliases (`co`, `new`), and each `gh api` method, field, input, `graphql` and `-i` form, are named, and a write form gh adds later is open until it is listed. end-of-day starts it through `scripts/scan.sh`, a headless `claude -p` in a checkout of the org's code, since a fork has only its caller's MCP servers and Playground's checkout turns the shared ones off; that outer session holds every write tool and is read-only by instruction alone, its only instruction being to call end-of-day's scan and print the result.
- Since 5 Oct 2026 the forked, read-only skill is linear's scan, and `/linear` runs inline and prints its report: a forked skill the user types shows its result as command output under the prompt, not as a reply, and the owner wanted the full pane.
