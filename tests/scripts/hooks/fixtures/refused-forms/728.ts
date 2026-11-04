import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "rm of a variable print's v option sets by a built name",
        "XY=/tmp/a; N=X; print -v ${N}Y ''; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable print's v option sets from inside a flag cluster",
        "XY=/tmp/a; N=X; print -rv ${N}Y ''; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable zsh's P flag assigns through a name",
        "XY=/tmp/a; N=X; N+=Y; : ${(P)N::=}; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable bash's indirect expansion assigns through a name",
        "XY=; N=X; N+=Y; : ${!N:=.playground/./exten}; rm -rf ${XY}sions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a scalar its tied zsh array empties",
        "CDPATH=/tmp/a; cdpath=(); rm -rf ${CDPATH}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a prompt variable its zsh alias empties",
        "PS1=/tmp/a; PROMPT=; rm -rf ${PS1}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable bash's subscripted indirect expansion assigns through a name",
        "XY=; N=X; N+=Y; : ${!N[0]:=.playground/./exten}; rm -rf ${XY}sions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable bash's starred indirect expansion assigns through a name",
        "XY=; N=X; N+=Y; : ${!N[*]:=.playground/./exten}; rm -rf ${XY}sions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a bash nameref declared on a built name sets",
        "XY=; N=X; declare -n R=${N}Y; R=.playground/./exten; rm -rf ${XY}sions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a bash nameref pointed at a built name sets",
        "XY=; N=X; declare -n R; R=${N}Y; R=.playground/./exten; rm -rf ${XY}sions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a bash nameref typeset declares on a built name sets",
        "XY=; N=X; typeset -n R=${N}Y; R=.playground/./exten; rm -rf ${XY}sions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a scalar zsh/watch's tied array empties",
        "WATCH=/tmp/a; watch=(); rm -rf ${WATCH}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a second v cluster of print sets by a built name",
        "XY=/tmp/a; N=X; print -v A -v ${N}Y ''; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a second v cluster of printf sets by a built name",
        "XY=/tmp/a; N=X; printf -v A -v ${N}Y ''; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable zsh's e flag assigns from a value the line never sets",
        "XY=/tmp/a; : ${(e)V}; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable zsh's %% flag assigns under promptsubst from a value the line never sets",
        "XY=/tmp/a; setopt promptsubst; : ${(%%)V}; rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable zsh's print -P assigns under promptsubst from a value the line never sets",
        'XY=/tmp/a; setopt promptsubst; print -P "$V"; rm -rf ${XY}.playground/./extensions/.no-such-folder',
        "process home",
      ],
      [
        "rm of a variable a zsh glob qualifier's code sets from a value the line never sets",
        "XY=/tmp/a; : /tmp/*(e:$V:); rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable bash's prompt transformation assigns from a value the line never sets",
        'XY=; : "${V@P}"; rm -rf ${XY}sions/.no-such-folder',
        "process home",
      ],
      [
        "rm of a variable arithmetic sets from a variable's built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; (( V )); rm -rf $D$XY/../.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable an integer attribute's assignment sets from a built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; declare -i Z; Z=V; rm -rf $D$XY/../.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable zsh's unbraced subscript sets from a built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; : $a[V]; rm -rf $D$XY/../.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable read's subscripted name sets from a built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; read 'a[V]' <<< 1; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable unset's subscripted name sets from a built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; unset 'a[V]'; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable printf -v's subscripted name sets from a built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; printf -v 'a[V]' x; rm -rf $D$XY/../.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a [[ -v ]] test's subscript sets from a built value",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; [[ -v a[V] ]]; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable a zsh glob qualifier's comma-held code sets",
        "XY=/tmp/a; : /tmp/*(e,$V,); rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a zsh glob qualifier's brace-held code sets",
        "XY=/tmp/a; : /tmp/*(.e{$V}); rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable a zsh glob qualifier after a quoted word sets",
        "XY=/tmp/a; : '/tmp'/*(e,$V,); rm -rf ${XY}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable read's subscripted name sets, its [ set off by a backslash",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; read a\\[V\\] <<< 1; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable read's subscripted name sets, its [ set off by a double quote",
        'D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; read a"[V]" <<< 1; rm -rf $D$XY/../.no-such-folder',
        "process tmp",
      ],
      [
        "rm of a variable read's subscripted name sets, its [ set off by a single quote",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; read a'[V]' <<< 1; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable unset's subscripted name sets, its [ set off by a backslash",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; unset a\\[V\\]; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable unset's subscripted name sets, its [ set off by a double quote",
        'D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; unset a"[V]"; rm -rf $D$XY/../.no-such-folder',
        "process tmp",
      ],
      [
        "rm of a variable unset's subscripted name sets, its [ set off by a single quote",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; unset a'[V]'; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable printf -v's subscripted name sets, its [ set off by a backslash",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; printf -v a\\[V\\] x; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable printf -v's subscripted name sets, its [ set off by a double quote",
        'D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; printf -v a"[V]" x; rm -rf $D$XY/../.no-such-folder',
        "process tmp",
      ],
      [
        "rm of a variable printf -v's subscripted name sets, its [ set off by a single quote",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; printf -v a'[V]' x; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable read's subscripted name sets, its [ spelt as an ANSI-C escape",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; read a$'\\x5b'V] <<< 1; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable unset's subscripted name sets, its [ spelt as an ANSI-C escape",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; unset a$'\\x5b'V]; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
      [
        "rm of a variable printf -v's subscripted name sets, its [ spelt as an ANSI-C escape",
        "D=~/.playground/./extensions/x; XY=/../../y; V=X; V+=Y=0; printf -v a$'\\x5b'V] x; rm -rf $D$XY/../.no-such-folder",
        "process tmp",
      ],
    ],
  },
]
