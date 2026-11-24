import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home"],
    guards: ["no-roster-write"],
    rows: () => [
      ["a move of a roster.json into the data folder", "mv /tmp/roster.json ~/.playground/"],
      [
        "a move of a roster.json into the data folder named with no slash",
        "mv /tmp/roster.json ~/.playground",
      ],
      [
        "a move of a roster.json into the data folder named by -t",
        "mv -t ~/.playground /tmp/roster.json",
      ],
      ["a link of a roster.json into the data folder", "ln -sf /tmp/roster.json ~/.playground/"],
      [
        "a hard link of a roster.json into the data folder named with no slash",
        "ln /tmp/roster.json ~/.playground",
      ],
      [
        "an install of a roster.json into the data folder",
        "install /tmp/roster.json ~/.playground/",
      ],
      ["a ditto of a roster.json into the data folder", "ditto /tmp/roster.json ~/.playground/"],
      ["an rsync onto the roster past its -t", "rsync -t /tmp/x ~/.playground/roster.json"],
      [
        "a tee onto the roster through an unread variable",
        "F=$(echo ~/.playground/roster.json); jq . /tmp/x | tee $F",
      ],
      [
        "an in-place sed of the roster through an unread variable",
        `F=$(echo ~/.playground/roster.json); sed -i '' s/a/b/ "$F"`,
      ],
      [
        "a move onto the roster through an unread variable",
        `F=$(echo ~/.playground/roster.json); mv /tmp/x "$F"`,
      ],
      [
        "a removal of the roster through an unread variable",
        `F=$(echo ~/.playground/roster.json); rm "$F"`,
      ],
      [
        "a truncate of the roster through an unread variable",
        `F=$(echo ~/.playground/roster.json); truncate -s0 "$F"`,
      ],
      [
        "a sed script's own w command onto the roster",
        `sed -n "w $HOME/.playground/roster.json" /tmp/new.json`,
      ],
    ],
  },
]
