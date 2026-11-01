import { describe, expect, test } from "bun:test"

import { lex } from "../../../scripts/hooks/shell"

// The last word of the last command, as the hooks read it.
const last = (src: string, known: Record<string, string> = {}) =>
  lex(src, known, true).commands.at(-1)?.words.at(-1)

describe("lex reads a literal assignment made earlier in the same command", () => {
  test.each([
    [
      "after a semicolon",
      `Q='query { viewer { login } }'; echo "$Q"`,
      "query { viewer { login } }",
    ],
    ["before &&", `Q=x && echo "$Q"`, "x"],
    ["on its own line", "Q=x\necho $Q", "x"],
    ["in braces", `Q=x; echo "\${Q}"`, "x"],
    ["two in one command", `A=1 B=2; echo "$A$B"`, "12"],
    ["from a known variable", `Q="$HOME/q"; echo "$Q"`, "/home/q"],
  ])("%s", (_, src, value) => {
    const word = last(src, { HOME: "/home" })
    expect(word?.unknown).toBeUndefined()
    expect(word?.value).toBe(value)
  })

  test.each([
    ["in a subshell", `(Q=x); echo "$Q"`],
    ["in a pipeline", `Q=x | cat; echo "$Q"`],
    ["in the background", `Q=x & echo "$Q"`],
    ["after &&", `true && Q=x; echo "$Q"`],
    ["after ||", `false || Q=x; echo "$Q"`],
    ["inside an if", `if true; then Q=x; fi; echo "$Q"`],
    ["inside a brace group on its own lines", `{\nQ=x\n}\necho "$Q"`],
    ["assigned twice", `Q=x; Q="$(cat f)"; echo "$Q"`],
    ["appended to", `Q=x; Q+=y; echo "$Q"`],
    ["read into", `Q=x; read -r Q; echo "$Q"`],
    ["a loop variable", `Q=x; for Q in a b; do :; done; echo "$Q"`],
    ["after an eval", `Q=x; eval "$S"; echo "$Q"`],
    ["after a source", `Q=x; source ./env.sh; echo "$Q"`],
    ["from a function that sources", `f() { . ./env.sh; }; Q=x; f; echo "$Q"`],
    ["from an unknown value", `Q="$Z"; echo "$Q"`],
    ["empty", `Q=; echo "$Q"`],
    ["with a quoted name", `'Q=x'; echo "$Q"`],
    ["with a tilde", `Q=~/x; echo "$Q"`],
    ["set again by print -v", `Q=x; print -vQ y; echo "$Q"`],
    ["set again by printf -v", `Q=x; printf -vQ %s y; echo "$Q"`],
    ["set again by zsh's ${Q::=}", `Q=x; : \${Q::=y}; echo "$Q"`],
    ["in a case branch", `case b in a) Q=x;; esac; echo "$Q"`],
    ["in a zsh short for loop", `for i (); Q=x; echo "$Q"`],
    ["in a zsh foreach loop", `foreach i (); Q=x; end; echo "$Q"`],
    ["set by a built name in typeset", `A=QU; B=ERY; QUERY=x; typeset -g "$A$B=y"; echo "$QUERY"`],
    [
      "set by a built name in printf -v",
      `A=QU; B=ERY; QUERY=x; printf -v "$A$B" %s y; echo "$QUERY"`,
    ],
    ["read in the second command after it", `Q=x; true; echo "$Q"`],
    ["read after an expansion it cannot follow", `Q=x; echo "\${X:-y}" "$Q"`],
    ["read after an arithmetic expansion", `Q=x; echo "$((1))" "$Q"`],
    ["read unquoted, where bash splits it", `Q='a --input f'; echo $Q`],
    ["read unquoted, where bash globs it", `Q='*'; echo $Q`],
    ["named inside another name", `MYQ=y; Q=x; echo "$Q"`],
  ])("leaves a variable %s unknown", (_, src) => {
    expect(last(src)?.unknown).toBe("a shell variable")
  })

  test("learns nothing unless the hook asks it to", () => {
    expect(lex(`Q=x; echo "$Q"`).commands.at(-1)?.words.at(-1)?.unknown).toBe("a shell variable")
  })

  test("leaves the caller's known variables as they were", () => {
    const known = { HOME: "/home" }
    lex(`Q=x; echo "$Q"`, known, true)
    expect(known).toEqual({ HOME: "/home" })
  })
})
