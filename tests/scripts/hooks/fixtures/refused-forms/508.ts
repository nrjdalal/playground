import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["data folder", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "ext score behind env -u of the role",
        "env -u PLAYGROUND_ROLE playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env -u of the role, attached",
        "env -uPLAYGROUND_ROLE playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env --unset of the role",
        "env --unset PLAYGROUND_ROLE playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env --unset= of the role",
        "env --unset=PLAYGROUND_ROLE playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with the role cleared",
        "PLAYGROUND_ROLE= playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env with the role cleared",
        "env PLAYGROUND_ROLE= playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with another role",
        "PLAYGROUND_ROLE=owner playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env -u of the session id",
        "env -u CLAUDE_CODE_SESSION_ID playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with another session id",
        "CLAUDE_CODE_SESSION_ID=other playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env with another config folder",
        "env CLAUDE_CONFIG_DIR=/tmp/c playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with another config folder",
        "CLAUDE_CONFIG_DIR=/tmp/c playground ext score login doc x abc 5 --reason ok",
      ],
      ["ext score behind env -i", "env -i playground ext score login doc x abc 5 --reason ok"],
      [
        "ext score behind env -i with a path",
        "env -i PATH=/usr/bin playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env --ignore-environment",
        "env --ignore-environment playground ext score login doc x abc 5 --reason ok",
      ],
      ["ext score behind env -", "env - playground ext score login doc x abc 5 --reason ok"],
      [
        "ext score behind env -S with the role unset",
        `env -S "-u PLAYGROUND_ROLE playground ext score login doc x abc 5 --reason ok"`,
      ],
      [
        "ext score behind nice and env -u",
        "nice env -u PLAYGROUND_ROLE playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env's -i grouped with -u",
        "env -iuTZ playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env's -i grouped with -P",
        "env -iP /usr/bin playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env's -i grouped with -S",
        `env -iS "playground ext score login doc x abc 5 --reason ok"`,
      ],
      [
        "ext score behind env's -i grouped with -L",
        "env -iL x playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score behind env's -i grouped with -U",
        "env -iU x playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with the role appended to",
        "PLAYGROUND_ROLE+=x playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with the session id appended to",
        "CLAUDE_CODE_SESSION_ID+=x playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score with the config folder appended to",
        "CLAUDE_CONFIG_DIR+=x playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score in bash -c with the role cleared",
        "PLAYGROUND_ROLE= bash -c 'playground ext score login doc x abc 5 --reason ok'",
      ],
      [
        "ext score in bash -c behind env -u",
        "env -u PLAYGROUND_ROLE bash -c 'playground ext score login doc x abc 5 --reason ok'",
      ],
      [
        "ext score in sh -c behind env -i",
        "env -i sh -c 'playground ext score login doc x abc 5 --reason ok'",
      ],
      [
        "ext score in zsh -c with another session id",
        "CLAUDE_CODE_SESSION_ID=x zsh -c 'playground ext score login doc x abc 5 --reason ok'",
      ],
      [
        "ext score echoed to sh with the role cleared",
        "echo 'playground ext score login doc x abc 5 --reason ok' | PLAYGROUND_ROLE= sh",
      ],
      [
        "ext score after the role is exported empty",
        "export PLAYGROUND_ROLE=; playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score after the role is set empty",
        "PLAYGROUND_ROLE=; playground ext score login doc x abc 5 --reason ok",
      ],
      [
        "ext score by bun run behind env -u",
        "env -u PLAYGROUND_ROLE bun run packages/scripts/src/playground/cli.ts ext score login doc x abc 5 --reason ok",
        "checkout",
      ],
      [
        "ext score split by an empty quote in bash -c",
        "PLAYGROUND_ROLE= bash -c 'playground ext s\"\"core login doc x abc 5 --reason ok'",
      ],
      [
        "ext score split by a backslash in bash -c",
        "PLAYGROUND_ROLE= bash -c 'playground ext sc\\ore login doc x abc 5 --reason ok'",
      ],
      [
        "ext score quoted inside bash -c",
        `PLAYGROUND_ROLE= bash -c "playground ext 'score' login doc x abc 5 --reason ok"`,
      ],
      [
        "ext score split by an empty quote in env -i sh -c",
        "env -i sh -c 'playground ext s\"\"core login doc x abc 5 --reason ok'",
      ],
      [
        "ext score split by an empty quote, echoed to sh",
        "echo 'playground ext s\"\"core login doc x abc 5 --reason ok' | PLAYGROUND_ROLE= sh",
      ],
      [
        "ext quoted in zsh -c with another session id",
        "CLAUDE_CODE_SESSION_ID=x zsh -c 'playground \"ext\" score login doc x abc 5 --reason ok'",
      ],
      [
        "ext score as a locale string in bash -c",
        "PLAYGROUND_ROLE= bash -c 'playground ext $\"score\" login doc x abc 5 --reason ok'",
      ],
    ],
  },
]
