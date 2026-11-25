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
      [
        "a listing after a cd into the data folder into a while read loop that removes each quoted name",
        'cd ~/.playground && ls | while read f; do rm "$f"; done',
      ],
      [
        "a listing after a cd into the data folder into a while read loop that removes each bare name",
        "cd ~/.playground && ls | while read f; do rm $f; done",
      ],
      [
        "a one-a-line listing after a cd into the data folder into a while read loop that removes each name past --",
        'cd ~/.playground && ls -1 | while read f; do rm -- "$f"; done',
      ],
      [
        "a find of the data folder through sort into a while read loop that removes each path",
        'find ~/.playground -maxdepth 1 | sort | while read f; do rm "$f"; done',
      ],
      [
        "a find of the data folder through head into a while read loop that removes each path",
        'find ~/.playground | head -50 | while read f; do rm "$f"; done',
      ],
      [
        "a glob listing of the data folder through grep into a while read loop that removes each path",
        'ls -d ~/.playground/* | grep json | while read f; do rm "$f"; done',
      ],
      [
        "a find of the data folder through xargs echo into a while read loop that removes each path",
        'find ~/.playground | xargs -n1 echo | while read f; do rm "$f"; done',
      ],
      [
        "a while read loop that removes each path a find of the data folder gives through a process substitution",
        'while read f; do rm "$f"; done < <(find ~/.playground)',
      ],
      [
        "a while read loop that removes each path from a file a find of the data folder wrote first",
        'find ~/.playground > /tmp/l; while read f; do rm "$f"; done < /tmp/l',
      ],
      ["a listing of the roster into xargs gzip", "ls ~/.playground/roster.json | xargs gzip"],
      ["a listing of the roster into xargs bzip2", "ls ~/.playground/roster.json | xargs bzip2"],
      ["a listing of the roster into xargs xz", "ls ~/.playground/roster.json | xargs xz"],
      [
        "a listing of the roster into xargs chown",
        "ls ~/.playground/roster.json | xargs chown nobody",
      ],
      [
        "a listing of the roster into xargs chgrp",
        "ls ~/.playground/roster.json | xargs chgrp staff",
      ],
      [
        "a listing of the roster into an xargs -I string that sorts onto it with -o attached",
        "ls ~/.playground/roster.json | xargs -I{} sort -o{} /dev/null",
      ],
      [
        "a listing of the roster into an xargs -I string that sorts onto it with -uo",
        "ls ~/.playground/roster.json | xargs -I{} sort -uo {} /dev/null",
      ],
      [
        "a listing of the roster into an xargs -I string that sorts onto it with -mo",
        "ls ~/.playground/roster.json | xargs -I{} sort -mo {} /dev/null",
      ],
      [
        "a listing of the roster into an xargs -I string that sorts onto it with --output and a space",
        "ls ~/.playground/roster.json | xargs -I{} sort --output {} /dev/null",
      ],
      ["a sort onto the roster with -o attached", "sort -o~/.playground/roster.json /dev/null"],
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
