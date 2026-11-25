import { type Group } from "./_shared"

// The forms #3066 names, a roster path built at run time from output the guard never sees; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "a listing of the data folder into an xargs -I string that removes each name in it",
        "ls ~/.playground | xargs -I{} rm ~/.playground/{}",
      ],
      [
        "a listing of the data folder into an xargs -I string that copies onto each name in it",
        "ls ~/.playground | xargs -I{} cp /tmp/x ~/.playground/{}",
      ],
      [
        "a listing of the data folder into a while read loop that removes each name in it",
        "ls ~/.playground | while read f; do rm ~/.playground/$f; done",
      ],
      [
        "a listing of the data folder into a while read -r loop that removes each quoted name in it",
        'ls ~/.playground | while read -r f; do rm ~/.playground/"$f"; done',
      ],
      [
        "a find of the data folder into a while read loop that removes each path",
        'find ~/.playground -maxdepth 1 | while read f; do rm "$f"; done',
      ],
      ["a listing of the roster into xargs gzip", "ls ~/.playground/roster.json | xargs gzip"],
      [
        "a listing of the roster into xargs chmod",
        "ls ~/.playground/roster.json | xargs chmod 000",
      ],
      [
        "a listing of the roster into an xargs -I string that sorts onto it",
        "ls ~/.playground/roster.json | xargs -I{} sort -o {} /dev/null",
      ],
      [
        "100 other paths and the roster, one a line, into an xargs -I string that sorts onto each",
        `printf '%s\\n' ${Array.from({ length: 100 }, (_, i) => `~/.playground/scratch/a${i}`).join(" ")} ~/.playground/roster.json | xargs -I{} sort -o {} /dev/null`,
      ],
    ],
  },
]
