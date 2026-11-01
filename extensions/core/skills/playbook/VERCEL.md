# Deploying through the Vercel CLI

Three traps one CLI deploy met (measured, 1 Nov), each a step at the command it follows.

1. **Keep the development env off disk.**
   Run `vercel integration add <name> --no-env-pull`, since without the flag it pulls the project's development env, a client secret among it, into `.env.local` (`--no-env-pull` skips that pull, by `vercel integration add --help` on vercel 65.8.0).
   Run `rm -f .env.local` right after `vercel link`, in the folder you ran it from, since link pulls the same env there and takes no such flag (its `--help` on 65.8.0), and one deploy found a client secret in a scratch folder that way.
   Done when `ls .env.local` finds no file.
2. **Read `vercel api` through its JSON alone.**
   Pipe it as `vercel api --raw <path> | grep -o '{.*' | jq`, since the CLI can print a warning line before its JSON, and a bare `| jq` stops on that line with "Invalid numeric literal".
   Done when jq prints the object.
3. **Probe a function that answers nothing.**
   Read an empty `vercel logs` as unknown: it returned 0 records for a function that hung about 60 s at its default export, a Node server that had already called `listen()`, so it shows neither a request nor its absence.
   Deploy a minimal Hono probe, one route that returns a word, to a preview, then move it toward the real handler one difference a preview (an import, the export's shape, a runtime setting), about 2 minutes each, since that found the hang's cause faster than the logs did.
   For a Node server export, export it unlistened: `createAdaptorServer` from `@hono/node-server`, never `serve()`, which calls `listen()` and hangs on Vercel (an unlistened `http.createServer()` and `createAdaptorServer()` each answered 200 in 1.2 s, and the same server after `listen(3000)` hung 62 s, measured).
   Done when the first preview that hangs names that difference.
