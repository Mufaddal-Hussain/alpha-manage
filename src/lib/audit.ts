import type { Database } from "@/db";
import { auditLog } from "@/db/schema";

/** A database client or, normally, the transaction of the change being audited. */
type Executor = Pick<Database, "insert">;

export interface AuditEntry {
  /** Acting user; null for system actions such as the seed. */
  userId: string | null;
  entityType: string;
  entityId: string;
  /** `create`, `status_change`, `override`, ... */
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
}

/**
 * Appends an audit row. Pass the transaction of the change itself so the audit entry
 * commits or rolls back together with it (R9).
 */
export async function recordAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    userId: entry.userId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    note: entry.note ?? null,
  });
}
