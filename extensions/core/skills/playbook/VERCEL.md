# Deploying through the Vercel CLI

Three traps one CLI deploy met (measured, 1 Nov), each a step at the command it follows.

1. **Drop the pulled env.**
   Run `rm -f .env.local` right after `vercel link` or `vercel integration add`, in the folder you ran it from, since both pull the project's development env into `.env.local` there, and one deploy found a client secret in a scratch folder that way.
   Done when `ls .env.local` finds no file.
2. **Read `vercel api` through its JSON alone.**
   Pipe it as `vercel api --raw <path> | grep -o '{.*' | jq`, since the CLI can print a warning line before its JSON, and a bare `| jq` stops on that line with "Invalid numeric literal".
   Done when jq prints the object.
3. **Probe a function that answers nothing.**
   Read an empty `vercel logs` as unknown: it returned 0 records for a function that hung while its module loaded, so it shows neither a request nor its absence.
   Deploy a minimal Hono probe, one route that returns a word, to a preview, then move it toward the real handler one import a preview, about 2 minutes each, since that found the hang's cause faster than the logs did.
   Done when the first preview that hangs names the import that breaks.
