import type { Group, Row } from "./_shared"

// #2236: an in-place sed's or perl's replacement that writes into a hook a remover of the home or of a folder that holds the root, the data folder by its bare name, or a brace list whose alternative spells the root after a prefix, each judged the same from every working folder; rows are data, as refused-forms.ts says.
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
  "an in-place sed whose s/// writes a remover of a repo's own extensions folder",
  "an in-place sed whose s/// writes a remover of a build folder in a repo's own extensions folder",
]
export const allowed: string[] = allowedCalls.flatMap((what) => [what, `${what}${WHOLE}`])
