import { homedir } from "node:os"
import { join } from "node:path"

import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "awk printing into the root",
        `awk '{print > "${join(homedir(), ".playground", "extensions", "x")}"}' /dev/null`,
      ],
      [
        "awk's system() naming the root",
        `awk 'BEGIN{system("touch ${join(homedir(), ".playground", "extensions", "x")}")}'`,
      ],
      ["touch in the root by ~", "touch ~/.playground/extensions/x"],
      [
        "watch removing a path in the root",
        "watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "watch removing by a glob in the data folder",
        "watch 'rm -rf ~/.playground/ext*/.no-such-folder'",
      ],
      [
        "watch with an unknown word ahead of rm",
        "watch '$3 rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "watch running the home, its substitution removing a path in the root",
        "watch '~ $(rm -rf ~/.playground/extensions/.no-such-folder)'",
      ],
      [
        "a git alias removing a path in the root",
        "git -c alias.x='!rm -rf ~/.playground/extensions/.no-such-folder' x",
      ],
      ["a git alias running its argument on the home", "git -c alias.x='!$1 ~' x rm"],
      [
        "git config setting an alias that removes a path in the root",
        "git config alias.x '!rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "ssh's ProxyCommand touching the root",
        "ssh -o ProxyCommand='touch ~/.playground/extensions/x' h",
      ],
      [
        "tmux's command removing a path in the root",
        "tmux new-session 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "rsync's -e removing a path in the root",
        "rsync -e 'rm -rf ~/.playground/extensions/.no-such-folder' a b",
      ],
      [
        "find's -exec removing a path in the root",
        "find . -exec sh -c 'rm -rf ~/.playground/extensions/.no-such-folder' \\;",
      ],
      [
        "GIT_SSH_COMMAND removing a path in the root",
        "GIT_SSH_COMMAND='rm -rf ~/.playground/extensions/.no-such-folder' git fetch",
      ],
      [
        "a git alias evaluating the word after -m",
        `git -c alias.x='!eval "$2"' x -m 'rm -rf ~/.playground/extensions/.no-such-folder'`,
      ],
      [
        "a git alias's sh -c running the word after -m",
        `git -c alias.x='!sh -c "$2"' x -m 'rm -rf ~/.playground/extensions/.no-such-folder'`,
      ],
      [
        "a git alias from the environment running the word after -m behind --attr-source commit",
        `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x GIT_CONFIG_VALUE_0='!eval "$2"' git --attr-source commit x -m 'rm -rf ~/.playground/extensions/.no-such-folder'`,
      ],
      [
        "a commit message under a call that sets config",
        "git -c x.y=z commit -m 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "screen's shell removing a path in the root",
        "screen -dm sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "flock's shell removing a path in the root",
        "flock /tmp/l sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell held in a variable",
        "S=sh; $S -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      ["the user's shell", "$SHELL -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      [
        "ssh held in a variable",
        "x=ssh; $x host 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "watch held in a loop variable",
        "for p in watch; do $p 'rm -rf ~/.playground/extensions/.no-such-folder'; done",
      ],
      ["a shell in capitals", "SH -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      ["watch with a capital", "Watch 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      [
        "git in capitals running an alias",
        "GIT -c alias.x='!rm -rf ~/.playground/extensions/.no-such-folder' x",
      ],
      [
        "taskpolicy's shell",
        "taskpolicy -b sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      ["lockf's shell", "lockf -t0 /tmp/l sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      ["watch through bun x", "bun x watch 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      [
        "a shell through pnpm exec",
        "pnpm exec sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      ["eval through setsid", "setsid eval 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      [
        "ssh through sshpass",
        "sshpass -p x ssh h 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "scp's ProxyCommand removing a path in the root",
        "scp -o ProxyCommand='rm -rf ~/.playground/extensions/.no-such-folder' a h:b",
      ],
      ["a shell named by a ? glob", "/bin/s? -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
      [
        "a shell named by a bracket glob",
        "/bin/[s]h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell and its -c from a brace",
        "{sh,-c} 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell from a brace with an empty member",
        "{sh,} -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a globbed shell behind taskpolicy",
        "taskpolicy -b /bin/s? -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a braced shell behind env",
        "env {sh,-c} 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a braced shell in bash -c's script",
        `bash -c "{sh,-c} 'rm -rf ~/.playground/extensions/.no-such-folder'"`,
      ],
      [
        "a shell named by a POSIX class",
        "/bin/[[:alpha:]]h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell named by a brace range",
        "/bin/{r..t}h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell named by an extglob",
        "/bin/@(sh) -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell named by a leading star",
        "/bin/*h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a shell from a brace inside the name",
        "{s,}h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a copy of a shell named by a glob",
        "./x? -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a star-named shell behind taskpolicy",
        "taskpolicy -b /bin/*h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a function that evals its arguments",
        `f() { eval "$@"; }; f 'rm -rf ~/.playground/extensions/.no-such-folder'`,
      ],
      [
        "a function that runs its argument by sh -c",
        `f() { sh -c "$1"; }; f 'rm -rf ~/.playground/extensions/.no-such-folder'`,
      ],
      [
        "a function by the function keyword",
        `function f { eval "$@"; }; f 'rm -rf ~/.playground/extensions/.no-such-folder'`,
      ],
      ["a gated message under git in capitals", "GIT commit -m 'docs: playground ext sync'"],
      ["a gated message under Git", "Git commit -m 'docs: playground ext sync'"],
      [
        "a payload set as an argument, then evaluated",
        `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; eval "$1"`,
      ],
      [
        "a payload set as an argument, then run by bash -c",
        `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; bash -c "$1"`,
      ],
      [
        "a payload set as an argument, then run by ssh",
        `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; ssh h "$1"`,
      ],
      [
        "a payload set as an argument, then run by watch",
        `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; watch "$1"`,
      ],
      [
        "a payload set as an argument, then run by the user's shell",
        `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; "$SHELL" -c "$1"`,
      ],
      [
        "a payload held in the last argument",
        `true 'rm -rf ~/.playground/extensions/.no-such-folder'; eval "$_"`,
      ],
      [
        "a payload held by getopts",
        `getopts x o 'rm -rf ~/.playground/extensions/.no-such-folder'; eval "$o"`,
      ],
      [
        "a payload set in bash -c's script, then evaluated",
        `bash -c 'set -- "rm -rf ~/.playground/extensions/.no-such-folder"; eval "$1"'`,
      ],
      [
        "a commit message run by eval through $_",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; eval \"$_\"",
      ],
      [
        "a commit message run by eval through git log",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder' && eval \"$(git log -1 --format=%s)\"",
      ],
      [
        "a commit message run by sh -c through git log",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; sh -c \"$(git log -1 --format=%s)\"",
      ],
      [
        "a tag message run by eval through git tag",
        "git tag -m 'rm -rf ~/.playground/extensions/.no-such-folder' v1; eval \"$(git tag -l --format='%(contents)' v1)\"",
      ],
      [
        "a commit message piped into sh",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | sh",
      ],
      [
        "a commit message run through xargs and sh -c",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | xargs -I{} sh -c '{}'",
      ],
      [
        "a payload held in an array",
        `args=('rm -rf ~/.playground/extensions/.no-such-folder'); sh -c "\${args[0]}"`,
      ],
      [
        "a commit message sourced through process substitution",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; source <(git log -1 --format=%s)",
      ],
      [
        "a commit message fed to sh as a here-string",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; sh <<< \"$(git log -1 --format=%s)\"",
      ],
      [
        "a commit message sourced from stdin",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; . /dev/stdin <<< \"$(git log -1 --format=%s)\"",
      ],
      [
        "a commit message written to a script sh runs",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s > f.sh; sh f.sh",
      ],
      [
        "a commit message run as a substitution",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; $(git log -1 --format=%s)",
      ],
      [
        "a commit message run through a variable",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; x=$(git log -1 --format=%s); $x",
      ],
      [
        "a commit message piped into a glob program",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | /bin/s?",
      ],
      [
        "a commit message piped into ssh",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | ssh h",
      ],
      [
        "a commit message piped into ssh's sh",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | ssh h sh",
      ],
      [
        "a commit message piped into watch's sh",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | watch -x sh",
      ],
      [
        "an argument fed to sh as a here-string through $_",
        "true 'rm -rf ~/.playground/extensions/.no-such-folder'; sh <<< \"$_\"",
      ],
      [
        "an argument sourced through $_",
        "true 'rm -rf ~/.playground/extensions/.no-such-folder'; source <(echo \"$_\")",
      ],
      [
        "a positional fed to sh as a here-string",
        "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; sh <<< \"$1\"",
      ],
      [
        "a positional piped into a glob program",
        "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; echo \"$1\" | /bin/s?",
      ],
      [
        "a positional piped into ssh",
        "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; echo \"$1\" | ssh h",
      ],
      [
        "a positional run as a command",
        "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; $1",
      ],
      [
        "a positional written to a script sh runs",
        "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; echo \"$1\" > f.sh; sh f.sh",
      ],
      [
        "a commit message run by a stored git alias through $_",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git x \"$_\"",
      ],
      [
        "a commit message run by git rebase -x",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git rebase -x \"$_\" HEAD~1",
      ],
      [
        "a commit message run by git rebase --exec",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git rebase --exec \"$_\" HEAD~1",
      ],
      [
        "a commit message run by git bisect run",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git bisect run \"$_\"",
      ],
      [
        "a commit message run by git submodule foreach",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git submodule foreach \"$_\"",
      ],
      [
        "a commit message run by git filter-branch",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git filter-branch -f --tree-filter \"$_\" HEAD",
      ],
      [
        "a commit message run by git difftool -x",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git difftool -y -x \"$_\" HEAD~1",
      ],
      [
        "a positional run by git rebase -x",
        "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; git rebase -x \"$1\" HEAD~1",
      ],
      [
        "an argument run by git submodule foreach",
        "true 'rm -rf ~/.playground/extensions/.no-such-folder'; git submodule foreach \"$_\"",
      ],
      [
        "a commit message run by a stored git alias with no argument",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git x",
      ],
      [
        "a commit message xargs hands git rebase -x",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | xargs -I{} git rebase -x {} HEAD~1",
      ],
      [
        "a commit message xargs hands git submodule foreach",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | xargs git submodule foreach",
      ],
      [
        "a commit message written to a script git rebase -x runs",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s > .git/x.sh; git rebase -x 'sh .git/x.sh' HEAD~1",
      ],
      [
        "a commit message written to a script git submodule foreach runs",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s > f.sh; git submodule foreach 'sh f.sh'",
      ],
      [
        "a commit message piped into git submodule foreach's sh",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | git submodule foreach sh",
      ],
      [
        "a commit message piped into git submodule foreach's sh -s",
        "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | git submodule foreach 'sh -s'",
      ],
      [
        "awk's system() removing a path in the root",
        "awk 'BEGIN{system(\"rm -rf ~/.playground/extensions/.no-such-folder\")}'",
      ],
      [
        "awk printing into a command removing a path in the root",
        'awk \'BEGIN{print "x" | "rm -rf ~/.playground/extensions/.no-such-folder"}\'',
      ],
      [
        "awk reading a command removing a path in the root",
        "awk 'BEGIN{\"rm -rf ~/.playground/extensions/.no-such-folder\" | getline}'",
      ],
      [
        "awk writing a removal into a git hook",
        'awk \'BEGIN{print "rm -rf ~/.playground/extensions/.no-such-folder" > ".git/hooks/pre-commit"}\'',
      ],
      [
        "awk's system() of a -v value removing a path in the root",
        "awk -v c='rm -rf ~/.playground/extensions/.no-such-folder' 'BEGIN{system(c)}'",
      ],
      [
        "gawk's system() removing a path in the root",
        "gawk 'BEGIN{system(\"rm -rf ~/.playground/extensions/.no-such-folder\")}'",
      ],
      [
        "nawk's system() removing a path in the root",
        "nawk 'BEGIN{system(\"rm -rf ~/.playground/extensions/.no-such-folder\")}'",
      ],
      [
        "sed's e command removing a path in the root",
        "sed 'e rm -rf ~/.playground/extensions/.no-such-folder' /dev/null",
      ],
      [
        "sed's addressed e command removing a path in the root",
        "sed '1e rm -rf ~/.playground/extensions/.no-such-folder' /dev/null",
      ],
      [
        "gsed's e command removing a path in the root",
        "gsed '1e rm -rf ~/.playground/extensions/.no-such-folder' /dev/null",
      ],
      [
        "sed -i '' inserting a removal into a git hook",
        "sed -i '' '1i\\\nrm -rf ~/.playground/extensions/.no-such-folder' .git/hooks/pre-commit",
      ],
      [
        "sed -i '' appending a removal to a git hook",
        "sed -i '' '$a\\\nrm -rf ~/.playground/extensions/.no-such-folder' .git/hooks/pre-commit",
      ],
      [
        "sed -i '' prefixing a removal in a git hook",
        "sed -i '' 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "sed -i prefixing a removal in a git hook",
        "sed -i 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "sed -i.bak prefixing a removal in a git hook",
        "sed -i.bak 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "sed --in-place prefixing a removal in a git hook",
        "sed --in-place 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "sed --in-place= with a suffix prefixing a removal in a git hook",
        "sed --in-place=.bak 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "sed -ni prefixing a removal in a git hook",
        "sed -ni 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |p' .git/hooks/pre-commit",
      ],
      [
        "sed -Ei prefixing a removal in a git hook",
        "sed -Ei 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "sed with a trailing -i prefixing a removal in a git hook",
        "sed 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit -i",
      ],
      [
        "gsed -i prefixing a removal in a git hook",
        "gsed -i 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "/usr/bin/sed -i prefixing a removal in a git hook",
        "/usr/bin/sed -i '' 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
      ],
      [
        "awk named as /usr/bin/time -o's output file, running watch",
        "/usr/bin/time -o awk watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "awk named as sudo --prompt's value, running watch",
        "sudo --prompt awk watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "cut under time, given watch and a removal",
        "time cut watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "sort under nohup, given watch and a removal",
        "nohup sort watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "uniq under exec, given watch and a removal",
        "exec uniq watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
    ],
  },
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["a glob of the data folder", "rm -rf .pl*", "home"],
      ["a brace of the data folder", "rm -rf {.playground,x}", "home"],
      ["a zsh group of the data folder", "rm -rf (.playground|x)", "home"],
      ["a zsh qualifier on every folder", "rm -rf *(/)", "home"],
      ["a glob through a link to the data folder", "rm -rf p*/extensions/x", "home"],
      ["bash's extglob @() of the data folder", "shopt -s extglob; rm -rf @(.playground)", "home"],
      ["bash's extglob +() of the data folder", "shopt -s extglob; rm -rf +(.playground)", "home"],
      ["bash's extglob ?() of the data folder", "shopt -s extglob; rm -rf ?(.playground)", "home"],
      ["bash's extglob !() of every other name", "shopt -s extglob; rm -rf !(x)", "home"],
      ["rm of a glob through a link to the root", "rm -rf s*/", "data folder"],
      ["a redirect through a glob of a link to the root", "echo x > s*/policy.json", "data folder"],
      ["a glob climbing back out to the data folder", "rm -rf w*/../.p*", "home"],
      [
        "a redirect climbing back out into the root",
        "echo x > w*/../.playground/extension?/policy.json",
        "home",
      ],
      ["a glob in the data folder climbing to the root", "rm -rf .playground/h*/../e*", "home"],
      ["a glob climbing to the root from the data folder", "rm -rf h*/../e*", "data folder"],
      ["a glob climbing out to any other folder", "rm -rf w*/../Documents/x", "home"],
      ["a glob past a link and its `..`", "rm -rf store/../e*", "home"],
      ["a redirect to a glob no entry matches", "echo x > q*", "data folder"],
      ["rm of a glob no entry matches", "rm -rf q*", "home"],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["git -C behind --attr-source's value", `git --attr-source HEAD -C ${MAIN} commit -m x`],
    ],
  },
]

// #1455: a quiet commit's message is text git never runs, so one naming a gated call runs
export const allowed: string[] = [
  "a gated message under git in capitals",
  "a gated message under Git",
]
