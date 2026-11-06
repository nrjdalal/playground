import type { Group } from "./_shared"

// The path each row's zsh P-flag assignment gives the variable the row holds, built at run time from pieces, so it spells no guarded folder: a path under NEVER_MADE.
const BUILT = `$(printf '%s/.play%sground/exten%ssions/.no-such-folder/x' "$HOME" "" "")`

// The setup each row shares: X held at a scratch path, and N set to X's name by a substitution the hook cannot read, so the P-flag line sets X unseen.
const HELD = `X=/tmp/a; N=$(printf '\\x58')`

// The P-flag line that sets X past every quoted-heredoc shape below.
const SETS = `: \${(P)N::=${BUILT}}`

// The forms the review of this file's source found refused: in each, a quoted heredoc's delimiter appears where the shell reads no heredoc, or where the scan cannot be sure where its body ends, so the setter on the next line runs and the line holds nothing; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "data folder", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "cp of a held variable past a quoted delimiter in a comment",
        `${HELD} # <<'EOF'\n${SETS}\nEOF\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a quoted delimiter inside double quotes",
        `${HELD}; echo "<<'EOF'"\n${SETS}\nEOF\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a here-string of a quoted word",
        `${HELD}; cat <<<'EOF'\n${SETS}\nEOF\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a quoted delimiter inside an ANSI-C string",
        `${HELD}; echo $'\\'<<\\'EOF\\''\n${SETS}\nEOF\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a quoted heredoc inside a substitution that ends at its delimiter and a parenthesis",
        `${HELD}; v=$(cat <<'EOF'\nx\nEOF)\n${SETS}\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a quoted heredoc inside a backtick",
        `${HELD}; v=\`cat <<'EOF'\nx\nEOF\n\`\n${SETS}\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a quoted heredoc inside a substitution inside double quotes",
        `${HELD}; v="$(cat <<'EOF'\nx\nEOF\n)"\n${SETS}\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a quoted heredoc in a case arm's unbalanced parenthesis",
        `${HELD}; case a in a) cat <<'EOF'\nx\nEOF\n;; esac\n${SETS}\ncp g "$X"`,
      ],
      [
        "cp of a held variable past a tab-stripped quoted heredoc that ends at a tab-indented delimiter",
        `${HELD}; cat <<-'EOF'\n\tEOF\n${SETS}\ncp g "$X"`,
      ],
    ],
  },
]
