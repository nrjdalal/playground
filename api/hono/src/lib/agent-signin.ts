import { isLocal } from "@packages/env"
import { env } from "@packages/env/api-hono"

// Whether the agents router (agents.ts) answers: a local stack with AGENT_SIGNIN_ENABLED on.
export const agentSignInEnabled = (): boolean => isLocal(env.NODE_ENV) && env.AGENT_SIGNIN_ENABLED
