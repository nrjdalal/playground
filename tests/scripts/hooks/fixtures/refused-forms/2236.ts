import type { Group, Row } from "./_shared"

// #2236: an in-place sed's or perl's replacement that writes into a hook a remover of the home or of a folder that holds the root (a remover after a glued pipe or as a brace-list command, the home by an expansion, a substitution or a variable included), the data folder by its bare name, or a brace list whose alternative spells the root after a prefix, each judged the same from every working folder; rows are data, as refused-forms.ts says.
const WHOLE = ", on a line read whole"
const rows = (): Row[] => [
  [
    "an in-place sed whose s/// writes a remover of the home into a git hook",
    String.raw`sed -i '' 's/a/rm ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// writes a remover of the home into a git hook",
    String.raw`perl -pi -e 's/a/rm ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the filesystem's root into a git hook",
    String.raw`sed -i '' 's/a/rm \//' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the data folder by its bare name",
    String.raw`sed -i '' 's/a/rm .playground/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a recursive remover of the data folder by its bare name",
    String.raw`sed -i '' 's/a/rm -r .playground/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the data folder under $HOME",
    String.raw`sed -i '' 's/a/rm $HOME\/.playground/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of a glob of the data folder under ${HOME}",
    "sed -i '' 's/a/rm ${HOME}\\/.play*/' .git/hooks/pre-commit",
  ],
  [
    "an in-place sed whose s/// writes a brace part that spells the rest of the root after the home",
    String.raw`sed -i '' 's/a/rm ~\/{.playground\/extensions,x}/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes the data folder in a nested brace list",
    String.raw`sed -i '' 's/a/rm ~\/{x,{y,.playground}}/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a ** glob of the home in a brace list read by ls",
    String.raw`sed -i '' 's/a/ls ~\/{**,x}/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a ** glob of the home in a brace list read by rm",
    String.raw`sed -i '' 's/a/rm ~\/{**,x}/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a brace list of more words than the hook reads",
    String.raw`sed -i '' 's/a/ls ~\/{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the home after a pipe with no space",
    String.raw`sed -i '' 's/a/true|rm ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the home after an or-list with no space",
    String.raw`sed -i '' 's/a/true||rm ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the home as a brace-list command",
    String.raw`sed -i '' 's/a/{rm,~}/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the data folder's bare name after a pipe with no space",
    String.raw`sed -i '' 's/a/true|rm .playground/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the filesystem's root after a pipe with no space",
    String.raw`sed -i '' 's/a/true|rm \//' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// writes a remover of the home after a pipe with no space",
    String.raw`perl -pi -e 's/a/true|rm ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the home by ${HOME:?}",
    "sed -i '' 's/a/rm ${HOME:?}/' .git/hooks/pre-commit",
  ],
  [
    "an in-place sed whose s/// writes a remover of the home by ${HOME:-x}",
    "sed -i '' 's/a/rm ${HOME:-x}/' .git/hooks/pre-commit",
  ],
  [
    "an in-place sed whose s/// writes a remover of the home by a substitution that prints it",
    String.raw`sed -i '' 's/a/rm $(echo ~)/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the home by a backtick substitution that prints it",
    "sed -i '' 's/a/rm `echo ~`/' .git/hooks/pre-commit",
  ],
  [
    "an in-place sed whose s/// writes a remover of the home by a variable the text sets to it",
    String.raw`sed -i '' 's/a/X=~; rm $X/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a code comment naming find",
    String.raw`sed -i '' 's/old/\/\/ find the first match/' src/a.ts`,
  ],
  [
    "an in-place sed whose s/// writes a code comment naming mv and rm",
    String.raw`sed -i '' 's/x/\/\/ mv the file, then rm the copy/' src/a.ts`,
  ],
  [
    "an in-place perl whose s/// writes a block comment naming find",
    String.raw`perl -pi -e 's/foo/\/* find the user *\/ foo/' src/a.ts`,
  ],
  [
    "an in-place sed whose s/// writes a block comment naming rm",
    String.raw`sed -i '' 's/x/\/* rm *\//' src/a.ts`,
  ],
  [
    "an in-place sed whose s/// writes a change into the home after a remover's own command",
    String.raw`sed -i '' 's/X/rm -f build.log; cd ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes an echo of $HOME after a find's own command",
    String.raw`sed -i '' 's/X/find . -name x; echo $HOME/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of a path under a variable",
    String.raw`sed -i '' 's/a/rm -rf $TMPDIR\/x/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the files a substitution lists",
    String.raw`sed -i '' 's/a/rm -f $(git ls-files -d)/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a change into the home into a git hook",
    String.raw`sed -i '' 's/a/cd ~/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a read of a file of the home into a git hook",
    String.raw`sed -i '' 's/a/cat ~\/.zshrc/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of a folder of the home outside the data folder",
    String.raw`sed -i '' 's/a/rm ~\/.config\/x/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of a * glob of the home",
    String.raw`sed -i '' 's/a/rm ~\/*.log/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of a path under /tmp",
    String.raw`sed -i '' 's/a/rm -rf \/tmp\/x/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of node_modules",
    String.raw`sed -i '' 's/a/rm -rf node_modules/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a find that deletes logs below the folder it runs in",
    String.raw`sed -i '' 's/a/find . -name "*.log" -delete/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of the folder it runs in",
    String.raw`sed -i '' 's/a/rm -rf ./' .git/hooks/pre-commit`,
  ],
]
// a repo's own extensions folder, which from the data folder itself is the root, so these rows run from every other folder
const away = (): Row[] => [
  [
    "an in-place sed whose s/// writes a remover of a repo's own extensions folder",
    String.raw`sed -i '' 's/a/rm -rf extensions/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place sed whose s/// writes a remover of a build folder in a repo's own extensions folder",
    String.raw`sed -i '' 's/a/rm -rf .\/extensions\/dist/' .git/hooks/pre-commit`,
  ],
]
const whole = (of: () => Row[]) => () =>
  of().map(([what, call, folder]): Row => [`${what}${WHOLE}`, `sleep 1; ${call}`, folder])

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
  {
    folders: ["data folder", "home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: whole(rows),
  },
  { folders: ["home", "process worktree"], guards: ["no-extensions-write"], rows: away },
  { folders: ["home", "process worktree"], guards: ["no-extensions-write"], rows: whole(away) },
]

const allowedCalls = [
  "an in-place sed whose s/// writes a change into the home into a git hook",
  "an in-place sed whose s/// writes a read of a file of the home into a git hook",
  "an in-place sed whose s/// writes a remover of a folder of the home outside the data folder",
  "an in-place sed whose s/// writes a remover of a * glob of the home",
  "an in-place sed whose s/// writes a remover of a path under /tmp",
  "an in-place sed whose s/// writes a remover of node_modules",
  "an in-place sed whose s/// writes a find that deletes logs below the folder it runs in",
  "an in-place sed whose s/// writes a remover of the folder it runs in",
  "an in-place sed whose s/// writes a code comment naming find",
  "an in-place sed whose s/// writes a code comment naming mv and rm",
  "an in-place perl whose s/// writes a block comment naming find",
  "an in-place sed whose s/// writes a block comment naming rm",
  "an in-place sed whose s/// writes a change into the home after a remover's own command",
  "an in-place sed whose s/// writes an echo of $HOME after a find's own command",
  "an in-place sed whose s/// writes a remover of a path under a variable",
  "an in-place sed whose s/// writes a remover of the files a substitution lists",
  "an in-place sed whose s/// writes a remover of a repo's own extensions folder",
  "an in-place sed whose s/// writes a remover of a build folder in a repo's own extensions folder",
]
export const allowed: string[] = allowedCalls.flatMap((what) => [what, `${what}${WHOLE}`])
