import { describe, expect, test } from "bun:test"

import { lex } from "../../../scripts/hooks/shell"

// The last word of the last command, as the hooks read it.
const last = (src: string, known: Record<string, string> = {}) =>
  lex(src, known, true).commands.at(-1)?.words.at(-1)

describe("lex reads a single-quoted literal that the very next command reads as a whole quoted variable", () => {
  test.each([
    [
      "after a semicolon",
      `Q='query { viewer { login } }'; echo "$Q"`,
      "query { viewer { login } }",
    ],
    ["before &&", `Q='x' && echo "$Q"`, "x"],
    ["on its own line", `Q='x'\necho "$Q"`, "x"],
    ["read twice", `Q='x'; echo "$Q" "$Q"`, "x"],
    ["as a flag's value", `Q='x'; echo -f query="$Q"`, "query=x"],
    ["in a command that pipes on", `Q='x'; echo "$Q" | cat`, "x"],
  ])("%s", (_, src, value) => {
    const word = lex(src, {}, true)
      .commands.find((c) => c.words[0]?.value === "echo")
      ?.words.at(-1)
    expect(word?.unknown).toBeUndefined()
    expect(word?.value).toBe(value)
  })

  test.each([
    ["in a subshell", `(Q='x'); echo "$Q"`],
    ["in a pipeline", `Q='x' | cat; echo "$Q"`],
    ["in the background", `Q='x' & echo "$Q"`],
    ["after &&", `true && Q='x'; echo "$Q"`],
    ["after ||", `false || Q='x'; echo "$Q"`],
    ["inside an if", `if true; then Q='x'; fi; echo "$Q"`],
    ["inside a brace group on its own lines", `{\nQ='x'\n}\necho "$Q"`],
    ["in a case branch", `case b in a) Q='x';; esac; echo "$Q"`],
    ["in a zsh short for loop", `for i (); Q='x'; echo "$Q"`],
    ["in a zsh foreach loop", `foreach i (); Q='x'; end; echo "$Q"`],
    ["assigned twice", `Q='x'; Q='y'; echo "$Q"`],
    ["appended to", `Q='x'; Q+='y'; echo "$Q"`],
    ["set by read", `Q='x'; read -r Q; echo "$Q"`],
    ["set again by print -v", `Q='x'; print -vQ y; echo "$Q"`],
    ["set again by printf -v", `Q='x'; printf -vQ %s y; echo "$Q"`],
    ["set again by zsh's ${Q::=}", `Q='x'; : \${Q::=y}; echo "$Q"`],
    ["set by a built name", `A='QU'; B='ERY'; QUERY='x'; typeset -g "$A$B=y"; echo "$QUERY"`],
    ["after an eval", `Q='x'; eval "$S"; echo "$Q"`],
    ["after a source", `Q='x'; source ./env.sh; echo "$Q"`],
    ["read in the second command after it", `Q='x'; true; echo "$Q"`],
    ["double-quoted", `Q="x"; echo "$Q"`],
    ["unquoted", `Q=x; echo "$Q"`],
    ["empty", `Q=''; echo "$Q"`],
    ["beside another assignment", `A='1' Q='x'; echo "$Q"`],
    ["with a quoted name", `'Q=x'; echo "$Q"`],
    ["named inside another name", `MYQ='y'; Q='x'; echo "$Q"`],
    ["read unquoted", `Q='x'; echo $Q`],
    ["read unquoted beside an escaped quote", `Q='x'; echo \\"$Q""`],
    ["read in braces", `Q='x'; echo "\${Q}"`],
    ["read with more text", `Q='x'; echo "$Q-y"`],
    ["changed by a zsh modifier", `Q='aXb'; echo "$Q:s/X//"`],
    ["changed by a zsh subscript", `Q='abc'; echo "$Q[1]"`],
    ["in a call with another expansion", `Q='x'; echo "$HOME" "$Q"`],
    ["in a call with an arithmetic expansion", `Q='x'; echo "$((1))" "$Q"`],
    ["in a call with a substitution", "Q='x'; echo `date` \"$Q\""],
    ["in a call that sets IFS", `IFS=:; Q='x'; echo "$Q"`],
  ])("leaves a variable %s unknown", (_, src) => {
    expect(last(src)?.unknown).toBe("a shell variable")
  })

  test.each([
    ["the keyword defines", `Q='x'; function f { echo "$Q"; }; f`],
    ["the parentheses define", `Q='x'; f() { echo "$Q"; }; f`],
  ])("leaves a variable read in a function %s unknown, since the body runs later", (_, src) => {
    const body = lex(src, {}, true).commands.find((c) => c.words.some((w) => w.value === "echo"))
    expect(body?.words.at(-1)?.unknown).toBe("a shell variable")
  })

  test("learns nothing unless the hook asks it to", () => {
    expect(lex(`Q='x'; echo "$Q"`).commands.at(-1)?.words.at(-1)?.unknown).toBe("a shell variable")
  })

  test("leaves the caller's known variables as they were", () => {
    const known = { HOME: "/home" }
    lex(`Q='x'; echo "$Q"`, known, true)
    expect(known).toEqual({ HOME: "/home" })
  })
})
