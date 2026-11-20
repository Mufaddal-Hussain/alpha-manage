import { unstable_rethrow } from "next/navigation";

/**
 * Domain errors carry a message that is safe to show the user. Anything else that is
 * thrown is logged on the server and shown as a generic message (no internals leak).
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string = "domain_error",
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input failed validation. `fieldErrors` maps field names to messages. */
export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message, "validation");
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super(message, "not_found");
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "conflict");
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Please sign in") {
    super(message, "unauthorized");
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have access to this") {
    super(message, "forbidden");
  }
}

/** Shape returned by server actions to forms (usable with useActionState). */
export type ActionResult<T = void> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const GENERIC_MESSAGE = "Something went wrong. Please try again; if it keeps happening, tell the owner.";

/**
 * Runs a server-action body and converts thrown errors into an `ActionResult`.
 * Domain errors become form messages; unexpected errors are logged and shown generically.
 * Next.js control-flow errors (redirect(), notFound()) are re-thrown untouched.
 */
export async function runAction<T>(body: () => Promise<T | void>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await body();
    return { ok: true, data: (data ?? undefined) as T | undefined, message: successMessage };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ValidationError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof DomainError) return { ok: false, message: error.message };
    console.error("[action] unexpected error", error);
    return { ok: false, message: GENERIC_MESSAGE };
  }
}
