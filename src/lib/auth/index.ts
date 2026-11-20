import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getEnv } from "@/lib/env";

/**
 * Better Auth 1.7: email + password, database sessions, no self-registration.
 * Staff accounts are created by the owner (or the seed) through `createStaffUser`.
 *
 * Built lazily so `next build` does not need DATABASE_URL / AUTH_SECRET.
 */
function createAuth() {
  const env = getEnv();
  return betterAuth({
    secret: env.AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
    },
    user: {
      additionalFields: {
        // input: false so a client can never set these through an auth endpoint.
        role: { type: "string", required: true, defaultValue: "sales", input: false },
        active: { type: "boolean", required: true, defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      // Our tables use uuid primary keys (data-model.md).
      database: { generateId: "uuid" },
    },
    databaseHooks: {
      session: {
        create: {
          // Deactivated staff cannot start a session (requireUser re-checks on every request).
          before: async (session) => {
            const [row] = await getDb()
              .select({ active: schema.user.active })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);
            return row?.active ? undefined : false;
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __alphaAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__alphaAuth ??= createAuth();
  return globalForAuth.__alphaAuth;
}
