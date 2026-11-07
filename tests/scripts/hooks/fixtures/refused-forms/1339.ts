import { type Group } from "./_shared"

// A GLM session's read of a guarded org's checkout (the made-up acme-blue's, beside its own) by each read tool and by the shell, and its database client aimed at a host off this machine.
export const groups: Group[] = [
  {
    folders: ["glm repo"],
    guards: ["no-glm-heavy-path"],
    rows: () => [
      [
        "a Read of a file in an org's checkout",
        { input: { file_path: "../glm-org-repo/README.md" }, tool: "Read" },
      ],
      [
        "a Grep of an org's checkout",
        { input: { path: "../glm-org-repo", pattern: "token" }, tool: "Grep" },
      ],
      [
        "a Glob in an org's checkout",
        { input: { path: "../glm-org-repo/src", pattern: "**/*.ts" }, tool: "Glob" },
      ],
      [
        "a Grep with no path in an org's checkout",
        { input: { pattern: "token" }, tool: "Grep" },
        "glm org repo",
      ],
      ["cat of a file in an org's checkout", "cat ../glm-org-repo/README.md"],
      ["sed of a file in an org's checkout", "sed -n 1,5p ../glm-org-repo/README.md"],
      ["rg in an org's checkout", "rg token ../glm-org-repo"],
      ["ls after cd into an org's checkout", "cd ../glm-org-repo && ls"],
      [
        "cat after cd into an org's checkout by its name alone",
        "cd .. && cd glm-org-repo && cat README.md",
      ],
      ["head in an org's checkout", "head README.md", "glm org repo"],
      ["psql to a remote host", "psql -h db.example.com -U app app"],
      ["psql of a remote database URL", "psql postgres://app@db.example.com:5432/app"],
      ["psql of a remote conninfo", `psql "host=db.example.com dbname=app"`],
      ["psql through PGHOST", "PGHOST=db.example.com psql app"],
      ["psql of a URL the hook cannot read", "psql $DATABASE_URL"],
      ["pg_dump of a remote host", "pg_dump --host=db.example.com app"],
      ["mysql to a remote host", "mysql -h db.example.com app"],
      ["mongosh of a remote cluster", "mongosh mongodb+srv://app@cluster.example.net/app"],
      ["redis-cli to a remote host", "redis-cli -h cache.example.com"],
      ["a script given a remote database URL", "bun run seed.ts postgres://app@db.example.com/app"],
    ],
  },
]
