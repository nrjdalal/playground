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
      // round 1: the paths a shell call opens past its argument words, and the hosts a client reads past its first
      ["a redirect from a file in an org's checkout", "cat < ../glm-org-repo/README.md"],
      [
        "a loop fed a file in an org's checkout",
        'while read l; do echo "$l"; done < ../glm-org-repo/README.md',
      ],
      [
        "a substitution reading a file in an org's checkout",
        'echo "$(< ../glm-org-repo/README.md)"',
      ],
      [
        "a path in an org's checkout printed into xargs",
        "echo ../glm-org-repo/README.md | xargs cat",
      ],
      ["a glob naming an org's checkout", "cat ../glm-org-rep*/README.md"],
      ["a path through ~+ into an org's checkout", "ls ~+/../glm-org-repo"],
      ["a symlink in its own checkout to a file in an org's checkout", "cat org-link.md"],
      ["psql through PGHOSTADDR", "PGHOSTADDR=10.0.0.5 psql app"],
      ["psql of a remote hostaddr", `psql "hostaddr=10.0.0.5 dbname=app"`],
      [
        "psql of a conninfo whose second host is remote",
        `psql "host=127.0.0.1 dbname=app host=db.example.com"`,
      ],
      [
        "psql of a URL whose second host is remote",
        "psql postgresql://app@127.0.0.1:1,db.example.com/app",
      ],
      [
        "psql of a URL naming its host as a parameter",
        `psql "postgresql:///app?host=db.example.com"`,
      ],
      ["psql of a service name", "psql service=prod"],
      ["psql through PGSERVICE", "PGSERVICE=prod psql"],
      ["mysql through MYSQL_HOST", "MYSQL_HOST=db.example.com mysql app"],
      ["mongosh of a positional remote host", "mongosh db.example.com:27017/app"],
      ["a pg_ program to a remote host", "pg_basebackup -h db.example.com -D out"],
      ["pgcli to a remote host", "pgcli -h db.example.com app"],
      ["psql to a remote host inside docker exec", "docker exec x psql -h db.example.com app"],
      [
        "psql to a remote host inside docker run",
        "docker run --rm postgres psql -h db.example.com",
      ],
    ],
  },
]
