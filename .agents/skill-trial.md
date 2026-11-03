# Trying a skill headless

To try a skill headless before it merges, run `claude -p` in the shape `no-headless-login`'s reason gives, from the folder whose project settings load the shared MCP servers (Linear, GitHub, Slack), with `< /dev/null`, pointed at the branch's `SKILL.md` rather than linking the branch into `~/.claude/skills`.
A trial reads the file only, so the skill's frontmatter (`context: fork`, its `disallowed-tools`) and hooks do not apply: pass `--disallowedTools` with the skill's whole `disallowed-tools` list plus `SendMessage`, each entry its own argument (entries such as `Bash(git -C:*)` hold spaces, so a word-split list fails with `unknown option`; build the argument list in a script),
and the prompt before `--disallowedTools`, which takes every argument after it as a tool.
A trial covers the skill's reads and judgement: every write, nested skill and the keep-going loop are refused or absent.
To compare what a skill does before and after a change, run `bun run parity replay` instead (`web/next/content/docs/parity.mdx`, Replays): it runs on `dontAsk` with the skill's reads allowed and no `--disallowedTools`, so a refused write shows as a denial.
