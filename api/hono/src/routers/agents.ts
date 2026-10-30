import { auth } from "@packages/auth"
import { site } from "@packages/config/site"
import { db, recordActivity, roleChangeSummary, user as userTable } from "@packages/db"
import { env } from "@packages/env/api-hono"
import { eq } from "drizzle-orm"
import { Hono } from "hono"

import { agentSignInEnabled } from "@/lib/agent-signin"
import { ApiError } from "@/lib/error"
import { signInAs } from "@/lib/sign-in"

const AGENT_EMAIL = site.agent.email
const AGENT_NAME = site.agent.name

export const agentsRouter = new Hono()
  .use(async (c, next) => (agentSignInEnabled() ? next() : c.notFound()))
  .post("/sign-in-as", async (c) => {
    const fail = (message: string): never => {
      throw new ApiError(500, "AGENT_LOGIN_FAILED", message)
    }

    const origin = c.req.header("origin")
    if (!origin) return fail("missing Origin header")
    if (!env.HONO_TRUSTED_ORIGINS.includes(origin)) return fail("untrusted Origin")
    const dashboardUrl = `${origin}/dashboard`

    const ctx = await auth.$context
    const existing = await ctx.internalAdapter.findUserByEmail(AGENT_EMAIL)

    let created = false
    let user
    if (existing) {
      user = await ctx.internalAdapter.updateUserByEmail(AGENT_EMAIL, {
        name: AGENT_NAME,
        emailVerified: true,
      })
      if (!user) return fail("user update failed")
    } else {
      try {
        user = await ctx.internalAdapter.createUser(
          {
            email: AGENT_EMAIL,
            name: AGENT_NAME,
            emailVerified: true,
          },
          { method: "agent" },
        )
        created = true
      } catch (err) {
        console.error("POST /api/agents/sign-in-as createUser failed:", err)
        const raced = await ctx.internalAdapter.findUserByEmail(AGENT_EMAIL)
        if (!raced) return fail("user creation failed")
        user = raced.user
      }
    }

    // Owner only on the sign-in that creates the account, so demoting the agent by hand to test a lower rung is not undone the next time you sign in. `console:roles grant agent@local.host owner` puts it back.
    if (created) {
      await db.transaction(async (tx) => {
        await tx
          .update(userTable)
          .set({ role: "owner", roleSetAt: new Date() })
          .where(eq(userTable.id, user.id))
        await recordActivity(tx, {
          action: "role.change",
          actor: { label: "Agent sign-in" },
          summary: roleChangeSummary(AGENT_EMAIL, null, "owner"),
        })
      })
    }

    await signInAs(c, user.id)
    return c.redirect(dashboardUrl, 302)
  })
