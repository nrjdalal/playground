// Every key the apps' schemas require, each holding a value that passes, so dev.test.ts and launch.test.ts read one list.
export const REQUIRED: Record<string, string> = {
  BETTER_AUTH_SECRET: "secret",
  HONO_APP_URL: "http://localhost:4000",
  HONO_TRUSTED_ORIGINS: "http://localhost:3000",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NODE_ENV: "local",
}

export const envLines = (keys: Record<string, string>) =>
  Object.entries(keys).map(([key, value]) => `${key}=${value}`)
