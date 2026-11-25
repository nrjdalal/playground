import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "a find exec removing the roster from a start away from it",
        "find /tmp -maxdepth 0 -exec rm ~/.playground/roster.json \\;",
      ],
      [
        "a find exec copying onto the roster",
        "find /tmp -maxdepth 0 -exec cp /tmp/x ~/.playground/roster.json \\;",
      ],
      [
        "a find exec truncating the roster",
        "find /tmp -maxdepth 0 -exec truncate -s0 ~/.playground/roster.json \\;",
      ],
      [
        "a find execdir shell script removing the roster",
        "find /tmp -maxdepth 0 -execdir sh -c 'rm ~/.playground/roster.json' \\;",
      ],
      [
        "a find of the roster past BSD's -x deleting it",
        "find -x ~/.playground/roster.json -delete",
      ],
      ["a find of the roster past -- deleting it", "find -- ~/.playground/roster.json -delete"],
      [
        "a find of the roster past -x removing it by exec",
        "find -x ~/.playground/roster.json -exec rm {} \\;",
      ],
      ["a find past -x deleting the roster", "find -x ~/.playground -name roster.json -delete"],
      ["a find past -s deleting the roster", "find -s ~/.playground -name roster.json -delete"],
      ["a find past -E deleting the roster", "find -E ~/.playground -name roster.json -delete"],
      ["a find past -O3 deleting the roster", "find -O3 ~/.playground -name roster.json -delete"],
      [
        "a gfind past -D stat deleting the roster",
        "gfind -D stat ~/.playground -name roster.json -delete",
      ],
      [
        "a find past -x removing the roster by exec",
        "find -x ~/.playground -name roster.json -exec rm {} \\;",
      ],
      ["a find past -x feeding xargs rm", "find -x ~/.playground -name roster.json | xargs rm"],
      ["a find past -- deleting the roster", "find -- ~/.playground -name roster.json -delete"],
      [
        "a find from a start with .. deleting the roster",
        "find ~/.playground/../.playground -name roster.json -delete",
      ],
      ["a find from a glob start deleting the roster", "find ~/.play* -name roster.json -delete"],
      [
        "a find from a glob start with its full name deleting the roster",
        "find ~/.playground* -name roster.json -delete",
      ],
      ["a gfind whose , runs -delete on every path", "gfind ~/.playground -name x.json , -delete"],
      ["a find whose , runs -delete on every path", "find ~/.playground -name x.json , -delete"],
      [
        "a find whose -name is a substitution",
        'find ~/.playground -name "$(echo roster.json)" -delete',
      ],
      [
        "a find whose -name is a variable the line sets",
        'N=roster.json; find ~/.playground -name "$N" -delete',
      ],
      ["a find whose -name is an unknown variable", 'find ~/.playground -name "$NAME" -delete'],
      [
        "a find whose -name holds a backslash escape",
        "find ~/.playground -name '\\roster.json' -delete",
      ],
      [
        "a find through head into xargs rm",
        "find ~/.playground -name roster.json | head -1 | xargs rm",
      ],
      [
        "a find through grep into xargs rm",
        "find ~/.playground -name roster.json | grep roster | xargs rm",
      ],
      [
        "a find through sort into xargs rm",
        "find ~/.playground -name roster.json | sort | xargs rm",
      ],
      [
        "a find through tee into xargs rm",
        "find ~/.playground -name roster.json | tee /tmp/l | xargs rm",
      ],
      [
        "a find in a brace group into xargs rm",
        "{ find ~/.playground -name roster.json; } | xargs rm",
      ],
      ["a find in a subshell into xargs rm", "(find ~/.playground -name roster.json) | xargs rm"],
      [
        "a relative name fed to xargs rm in the data folder",
        "cd ~/.playground && echo roster.json | xargs rm",
      ],
      [
        "an -I string building the roster's path from its folder",
        "echo ~/.playground | xargs -I{} rm {}/roster.json",
      ],
      [
        "an -I string building the roster's path from its name",
        "echo roster.json | xargs -I{} rm ~/.playground/{}",
      ],
      ["a glob fed to xargs rm", "echo ~/.playground/r*.json | xargs rm"],
      ["a listing of a glob into xargs rm", "ls ~/.playground/r*.json | xargs rm"],
      [
        "a listing in the data folder of a glob into xargs rm",
        "cd ~/.playground && ls roster* | xargs rm",
      ],
      ["a listing of the data folder into xargs rm", "cd ~/.playground && ls | xargs rm"],
      ["a listing of the data folder's glob into xargs rm", "ls -d ~/.playground/* | xargs rm"],
      ["the roster fed to gxargs rm", "echo ~/.playground/roster.json | gxargs rm"],
      ["a find feeding gxargs rm", "find ~/.playground -name roster.json | gxargs rm"],
      [
        "a find feeding an xargs shell script that removes $0",
        "find ~/.playground -name roster.json | xargs sh -c 'rm \"$0\"'",
      ],
      [
        "a find feeding an xargs shell script that removes $@",
        "find ~/.playground -name roster.json -print0 | xargs -0 sh -c 'rm \"$@\"' _",
      ],
      [
        "a find exec shell script that removes its {} as $0",
        "find ~/.playground -name roster.json -exec sh -c 'rm \"$0\"' {} \\;",
      ],
      [
        "a find exec shell script that removes its {} as $1",
        "find ~/.playground -name roster.json -exec sh -c 'rm \"$1\"' _ {} \\;",
      ],
      [
        "a find exec bash script that removes its {} batch as $@",
        "find ~/.playground -name roster.json -exec bash -c 'rm \"$@\"' _ {} +",
      ],
      [
        "fed text past the items the hook reads, ending in the roster, into xargs rm",
        `echo ${Array.from({ length: 101 }, (_, i) => `/tmp/x${i}`).join(" ")} ~/.playground/roster.json | xargs rm`,
      ],
    ],
  },
]
