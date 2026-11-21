import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { auditLog, user } from "@/db/schema";
import { requireRole } from "@/lib/auth/session";
import { addDays } from "@/lib/quotation/status";

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  entityType?: string;
  action?: string;
  /** Inclusive date range in India time, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Matches the entity id exactly (a quotation, PO or challan id copied from its page address). */
  entityId?: string;
  /** 1-based page. */
  page?: number;
}

/** Audit entries, newest first, with the name of whoever acted (null for system actions). One extra row tells whether a next page exists. */
export async function findAuditEntries(db: Database, filters: AuditFilters) {
  const conditions: SQL[] = [];
  if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.entityId) conditions.push(eq(auditLog.entityId, filters.entityId));
  // Dates are calendar days in India time, like every other date the app shows.
  if (filters.from) conditions.push(gte(auditLog.createdAt, sql`(${filters.from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`));
  if (filters.to) conditions.push(lt(auditLog.createdAt, sql`(${addDays(filters.to, 1)}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`));
  const page = Math.max(1, Math.floor(filters.page ?? 1));

  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      action: auditLog.action,
      fromStatus: auditLog.fromStatus,
      toStatus: auditLog.toStatus,
      note: auditLog.note,
      userName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE + 1)
    .offset((page - 1) * AUDIT_PAGE_SIZE);
  return { page, hasNext: rows.length > AUDIT_PAGE_SIZE, rows: rows.slice(0, AUDIT_PAGE_SIZE) };
}

/** The entity types and actions present in the log, for the filter menus. */
export async function auditFilterOptions(db: Database) {
  const [types, actions] = await Promise.all([
    db.selectDistinct({ value: auditLog.entityType }).from(auditLog).orderBy(auditLog.entityType),
    db.selectDistinct({ value: auditLog.action }).from(auditLog).orderBy(auditLog.action),
  ]);
  return { entityTypes: types.map((t) => t.value), actions: actions.map((a) => a.value) };
}

// Wrappers for the page: owner only (contracts/ui-routes.md), then read.

export async function listAuditEntries(filters: AuditFilters) {
  await requireRole("owner");
  return findAuditEntries(getDb(), filters);
}

export async function getAuditFilterOptions() {
  await requireRole("owner");
  return auditFilterOptions(getDb());
}
