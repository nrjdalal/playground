import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // a script's output piped into a command that can run its input as code, whatever its arguments say, each one a script the hook cannot read
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a script's output sourced from /dev/fd/0", "bun run ask list | . /dev/fd/0"],
      ["a script's output sourced from /proc/self/fd/0", "bun run ask list | . /proc/self/fd/0"],
      ["a script's output sourced from -", "bun run ask list | . -"],
      ["a script's output evaluated through a substitution", 'bun run ask list | eval "$(cat)"'],
      [
        "a script's output read by sh -c from a quoted substitution",
        "bun run ask list | sh -c '$(cat)'",
      ],
      ["a script's output read by sh -", "bun run ask list | sh -"],
      ["a script's output read by sh /dev/stdin", "bun run ask list | sh /dev/stdin"],
      [
        "a script's output read by bash from a process substitution",
        "bun run ask list | bash <(cat)",
      ],
      [
        "a script's output evaluated line by line in a loop",
        "bun run ask list | while read l; do eval $l; done",
      ],
      ["a script's output sourced by sh -c", "bun run ask list | sh -c '. /dev/stdin'"],
      ["a script's output piped on by sh -c into a shell", "bun run ask list | sh -c 'cat | sh'"],
      ["a script's output handed by xargs to $SHELL", "bun run ask list | xargs -I{} $SHELL -c {}"],
      ["a script's output piped into node", "bun run ask list | node"],
      ["a script's output piped into python3", "bun run ask list | python3"],
      ["a script's output piped into perl", "bun run ask list | perl"],
      ["a script's output piped into ruby", "bun run ask list | ruby"],
      ["a script's output piped into osascript", "bun run ask list | osascript"],
      ["a script's output piped into bun -", "bun run ask list | bun -"],
      ["a script's output handed by xargs to python3", "bun run ask list | xargs python3"],
      ["a script's output handed by xargs to node -e", "bun run ask list | xargs -I{} node -e {}"],
    ],
  },
  // stdin's other names fed text the hook reads, which it judges as the script, as it judges /dev/stdin's
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a commit sourced from /dev/fd/0", "echo 'git commit -m x' | . /dev/fd/0"],
      ["a commit sourced from /proc/self/fd/0", "echo 'git commit -m x' | . /proc/self/fd/0"],
      ["a commit sourced from -", "echo 'git commit -m x' | . -"],
    ],
  },
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      ["a write into the root sourced from /dev/fd/0", `echo 'touch ${ROOT}/a' | . /dev/fd/0`],
      [
        "a write into the root sourced from /proc/self/fd/0",
        `echo 'touch ${ROOT}/a' | . /proc/self/fd/0`,
      ],
      ["a write into the root sourced from -", `echo 'touch ${ROOT}/a' | . -`],
    ],
  },
  // a script's output piped into a named interpreter or shell, whatever its options or inline program say, its name read through a version suffix
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "a script's output piped into python3 with a warning option's value before stdin's name",
        "bun run ask list | python3 -W ignore -",
      ],
      [
        "a script's output piped into python3 with a warning option's value and no script",
        "bun run ask list | python3 -W ignore",
      ],
      [
        "a script's output piped into python3 with an -X option's value before stdin's name",
        "bun run ask list | python3 -X dev -",
      ],
      [
        "a script's output piped into node with a preload and no script",
        "bun run ask list | node -r fs",
      ],
      [
        "a script's output piped into node with a long preload and no script",
        "bun run ask list | node --require fs",
      ],
      [
        "a script's output piped into node with an import and no script",
        "bun run ask list | node --import fs",
      ],
      [
        "a script's output piped into node with a valued option before stdin's name",
        "bun run ask list | node --max-old-space-size 100 -",
      ],
      [
        "a script's output piped into ruby with a library and no script",
        "bun run ask list | ruby -r json",
      ],
      [
        "a script's output piped into ruby with a load path before stdin's name",
        "bun run ask list | ruby -I lib -",
      ],
      [
        "a script's output piped into perl with a load path before stdin's name",
        "bun run ask list | perl -I lib -",
      ],
      [
        "a script's output piped into osascript with a language before stdin's name",
        "bun run ask list | osascript -l JavaScript -",
      ],
      [
        "a script's output piped into bun with a preload before stdin's name",
        "bun run ask list | bun -r ./x -",
      ],
      [
        "a script's output piped into bun with a long preload before stdin's name",
        "bun run ask list | bun --preload ./x -",
      ],
      [
        "a script's output piped into bun with a folder before stdin's name",
        "bun run ask list | bun --cwd . -",
      ],
      [
        "a script's output piped into python3 with a flag that is no inline program",
        "bun run ask list | python3 -E",
      ],
      [
        "a script's output piped into python3 with that flag before stdin's name",
        "bun run ask list | python3 -E -",
      ],
      [
        "a script's output piped into perl looping over its input with no program",
        "bun run ask list | perl -p",
      ],
      [
        "a script's output piped into python3 running a program filled from stdin",
        'bun run ask list | python3 -c "$(cat)"',
      ],
      [
        "a script's output piped into node running a program filled from stdin",
        'bun run ask list | node -e "$(cat)"',
      ],
      [
        "a script's output piped into node's long eval of a program filled from stdin",
        'bun run ask list | node --eval "$(cat)"',
      ],
      [
        "a script's output piped into perl running a program filled from stdin",
        'bun run ask list | perl -e "$(cat)"',
      ],
      [
        "a script's output piped into bun running a program filled from stdin",
        'bun run ask list | bun -e "$(cat)"',
      ],
      [
        "a script's output piped into php running a program filled from stdin",
        'bun run ask list | php -r "$(cat)"',
      ],
      [
        "a script's output piped into deno evaluating a program filled from stdin",
        'bun run ask list | deno eval "$(cat)"',
      ],
      [
        "a script's output piped into a loop handing each line to python3 -c",
        'bun run ask list | while read l; do python3 -c "$l"; done',
      ],
      [
        "a script's output piped into python3 running an inline program of its own",
        "bun run ask list | python3 -c 'import sys'",
      ],
      [
        "a script's output piped into python3 running an attached inline program",
        "bun run ask list | python3 -c'x'",
      ],
      [
        "a script's output piped into node running an inline program of its own",
        "bun run ask list | node -e '1'",
      ],
      [
        "a script's output piped into node running an attached long inline program",
        "bun run ask list | node --eval='1'",
      ],
      [
        "a script's output piped into a versioned python3 reading stdin's name",
        "bun run ask list | python3.12 -",
      ],
      [
        "a script's output piped into a versioned python3 with no script",
        "bun run ask list | python3.9",
      ],
      ["a script's output piped into python2 with no script", "bun run ask list | python2"],
      ["a script's output piped into a versioned node with no script", "bun run ask list | node18"],
      ["a script's output piped into nodejs with no script", "bun run ask list | nodejs"],
      ["a script's output piped into a versioned lua with no script", "bun run ask list | lua5.4"],
      ["a script's output piped into luajit with no script", "bun run ask list | luajit"],
      ["a script's output piped into csh with no script", "bun run ask list | csh"],
      ["a script's output piped into tcsh with no script", "bun run ask list | tcsh"],
      ["a script's output piped into fish with no script", "bun run ask list | fish"],
      ["a script's output piped into busybox's sh with no script", "bun run ask list | busybox sh"],
      [
        "a script's output piped into node with an unlisted option's value and no script",
        "bun run ask list | node --disable-warning X",
      ],
      [
        "a script's output piped into node with another unlisted option's value",
        "bun run ask list | node --unhandled-rejections strict",
      ],
      [
        "a script's output piped into node with a warnings file and no script",
        "bun run ask list | node --redirect-warnings f",
      ],
      [
        "a script's output piped into node with a DNS order and no script",
        "bun run ask list | node --dns-result-order ipv4first",
      ],
      [
        "a script's output piped into ruby with a feature turned off and no script",
        "bun run ask list | ruby --disable gems",
      ],
      [
        "a script's output piped into ruby with a feature turned on and no script",
        "bun run ask list | ruby --enable frozen-string-literal",
      ],
      [
        "a script's output piped into ruby with an encoding and no script",
        "bun run ask list | ruby --encoding utf-8",
      ],
      [
        "a script's output piped into ruby with an empty field separator before stdin's name",
        "bun run ask list | ruby -F - x.rb",
      ],
      [
        "a script's output piped into bun with a define before stdin's name",
        "bun run ask list | bun -d FOO:1 -",
      ],
      [
        "a script's output piped into php running an inline program of its own",
        "bun run ask list | php -r 'x'",
      ],
      [
        "a script's output piped into php with no ini file running an inline program",
        "bun run ask list | php -n -r 'x'",
      ],
      ["a script's output piped into bun's repl", "bun run ask list | bun repl"],
      ["a script's output piped into deno's repl", "bun run ask list | deno repl"],
      ["a script's output piped into bun's exec", "bun run ask list | bun exec x"],
      [
        "a script's output piped into deno run with a log level before stdin's name",
        "bun run ask list | deno run -L info -",
      ],
      [
        "a script's output piped into deno run with a certificate before stdin's name",
        "bun run ask list | deno run --cert x.pem -",
      ],
      [
        "a script's output piped into luajit with a JIT option before stdin's name",
        "bun run ask list | luajit -j off -",
      ],
      [
        "a script's output piped into perl with a spaced module before stdin's name",
        "bun run ask list | perl -M - x.pl",
      ],
      [
        "a script's output piped into bun with a spaced config before a script",
        "bun run ask list | bun --config - x.js",
      ],
      [
        "a script's output piped into bun with stdin's name as a spaced config",
        "bun run ask list | bun --config /dev/stdin x.js",
      ],
      ["a script's output piped into bun running sh off PATH", "bun run ask list | bun run sh"],
      [
        "a script's output piped into bun running python3 off PATH",
        "bun run ask list | bun run python3",
      ],
      [
        "a script's output piped into bun running a versioned python off PATH",
        "bun run ask list | bun run python3.12",
      ],
      ["a script's output piped into bun x running sh", "bun run ask list | bun x sh"],
      ["a script's output piped into deno serving stdin", "bun run ask list | deno serve -"],
      ["a script's output piped into a deno task", "bun run ask list | deno task x"],
      [
        "a script's output piped into bun running a bare name after --",
        "bun run ask list | bun run -- sh",
      ],
    ],
  },
  // a reader of the root piped into a loop whose body runs each line as code, which runs whatever the reader prints
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      [
        "a read of the root piped into a loop that evals each line",
        `cat ${ROOT}/a | while read l; do eval "$l"; done`,
      ],
    ],
  },
]
