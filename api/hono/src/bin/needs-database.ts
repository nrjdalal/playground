import "@packages/env/load-dotenv"

// A bin that reads the Dashboard's database imports this before @packages/env/db, whose check throws on an empty POSTGRES_URL with its schema's words; during first-run setup there is no database yet, so this says so in one line and exits 1.
if (!process.env.POSTGRES_URL?.trim()) {
  console.error(
    "there is no database yet: finish first-run setup on the Dashboard, then run this again",
  )
  process.exit(1)
}
