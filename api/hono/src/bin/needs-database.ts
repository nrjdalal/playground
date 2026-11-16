import "@packages/env/load-dotenv"

// A bin that reads the Dashboard's database imports this before @packages/env/db, whose check throws on an empty POSTGRES_URL with its schema's words; during first-run setup there is no database yet, so this says so in one line and exits 1. Under a skip flag @packages/env fills a dummy URL in its place (lib/polyfill.ts), so this stands aside as well.
const skipped = [process.env.SKIP_ENV_VALIDATION, process.env.SKIP_ENV_VALIDATION_SERVER].includes(
  "true",
)
if (!skipped && !process.env.POSTGRES_URL?.trim()) {
  console.error(
    "there is no database yet: finish first-run setup on the Dashboard, then run this again",
  )
  process.exit(1)
}
