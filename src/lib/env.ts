import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// connection string"),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    STORAGE_DRIVER: z.enum(["vercel-blob", "local"]).default("local"),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    /** Directory for STORAGE_DRIVER=local (relative to the project root unless absolute). */
    STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  })
  .refine((env) => env.STORAGE_DRIVER !== "vercel-blob" || !!env.BLOB_READ_WRITE_TOKEN, {
    path: ["BLOB_READ_WRITE_TOKEN"],
    message: "BLOB_READ_WRITE_TOKEN is required when STORAGE_DRIVER=vercel-blob",
  });

export type Env = z.infer<typeof envSchema>;

/** Validates a raw environment object. Treats empty strings (blank lines in .env files) as unset. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Validated environment, read lazily so `next build` works without secrets.
 * Server-only: never import this from client components.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
