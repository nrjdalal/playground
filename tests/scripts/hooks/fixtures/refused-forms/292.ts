import { type Group } from "./_shared"

const MUTATION = `mutation { addComment(input: {subjectId: "I_1", body: "release"}) { clientMutationId } }`

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-release-comment"],
    rows: () => [
      [
        "a GraphQL query held in a variable, whose reason names the query written in the command itself",
        `Q='query { viewer { login } }'; gh api graphql -f query="$Q"`,
      ],
      [
        "a GraphQL mutation held in a variable set earlier in the command",
        `Q='mutation { addComment(input: {subjectId: "I_1", body: "release"}) { clientMutationId } }'; gh api graphql -f query="$Q"`,
      ],
      [
        "a GraphQL query held in a variable set in a subshell",
        `(Q='query { viewer { login } }'); gh api graphql -f query="$Q"`,
      ],
      [
        "a GraphQL query held in a variable set in a pipeline",
        `Q='query { viewer { login } }' | cat; gh api graphql -f query="$Q"`,
      ],
      ...(
        [
          ["print -v", `print -vQ '${MUTATION}'`],
          ["printf -v", `printf -vQ %s '${MUTATION}'`],
          ["zsh's ${Q::=}", `: \${Q::='${MUTATION}'}`],
        ] as const
      ).map(
        ([how, sets]) =>
          [
            `a GraphQL query in a variable that ${how} sets to a mutation after`,
            `Q='query { viewer { login } }'; ${sets}; gh api graphql -f query="$Q"`,
          ] as const,
      ),
      [
        "a GraphQL query in a variable that a name built in typeset sets to a mutation after",
        `A=QU; B=ERY; QUERY='query { viewer { login } }'; typeset -g "$A$B=${MUTATION}"; gh api graphql -f query="$QUERY"`,
      ],
      [
        "a mutation a zsh modifier makes from a variable",
        `Q='mutation { addCXomment(input: {subjectId: "I_1", body: "ship"}) { clientMutationId } }'; gh api graphql -f query="$Q:s/X//"`,
      ],
      [
        "a GraphQL query in a variable read unquoted after IFS is set",
        `IFS=:; Q='query { viewer { login } }:--input:/abs/mutation.json'; gh api graphql -f query=$Q`,
      ],
      [
        "a GraphQL query read in a function body after typeset sets the variable to a mutation",
        `QUERY='query { viewer { login } }'; function f { gh api graphql -f query="$QUERY"; }; typeset QU""ERY='${MUTATION}'; f`,
      ],
      [
        "a GraphQL query read in a while condition whose body sets the variable to a mutation",
        `QUERY='query { viewer { login } }'; while gh api graphql -f query="$QUERY"; do typeset QU""ERY='${MUTATION}'; done`,
      ],
      [
        "a GraphQL query read in an until condition whose body sets the variable to a mutation",
        `QUERY='query { viewer { login } }'; until ! gh api graphql -f query="$QUERY"; do typeset QU""ERY='${MUTATION}'; done`,
      ],
      [
        "a GraphQL query read in a zsh repeat body that sets the variable to a mutation",
        `QUERY='query { viewer { login } }'; repeat 2 { gh api graphql -f query="$QUERY"; typeset QU""ERY='${MUTATION}' }`,
      ],
      [
        "a GraphQL query read in a DEBUG trap that sets the variable to a mutation",
        `trap 'typeset QU""ERY=${MUTATION}' DEBUG; QUERY='query { viewer { login } }'; gh api graphql -f query="$QUERY"`,
      ],
      [
        "a GraphQL query read in an alias that sets the variable to a mutation",
        `alias gh='typeset QU""ERY=${MUTATION}; command gh'
QUERY='query { viewer { login } }'
gh api graphql -f query="$QUERY"`,
      ],
      [
        "a GraphQL query in a variable set in a case branch",
        `case b in a) Q='query { viewer { login } }';; esac; gh api graphql -f query="$Q"`,
      ],
      [
        "a GraphQL query in a variable read unquoted, which bash splits into --input",
        `Q='query { viewer { login } } --input /abs/mutation.json'; gh api graphql -f query=$Q`,
      ],
    ],
  },
]
