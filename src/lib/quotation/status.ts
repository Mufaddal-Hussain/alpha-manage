import type { QuotationStatus } from "@/db/schema/quotations";

// The quotation status machine (T044; data-model.md "Quotation status machine"). Pure rules, no database.
//
//   draft --issue/send--> sent --approve--> approved (locked)
//                           |---reject----> rejected
//                           |---valid_until passes--> expired (derived, never stored)
//                           '---revise-----> draft (revision n+1, number kept) --issue--> sent
//   rejected / expired --reinstate (note)--> sent
//   rejected / expired --revise--> draft (revision n+1)

/** What a person sees: the stored status, plus "expired" derived from the date. */
export type DisplayStatus = QuotationStatus | "expired";

export type QuotationAction = "issue" | "send" | "approve" | "reject" | "reinstate" | "revise" | "delete";

const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar date (YYYY-MM-DD) of an instant in India time, matching how `valid_until` dates are entered. */
export function istDate(at: Date): string {
  return IST_DATE.format(at);
}

/** Adds days to a YYYY-MM-DD date (calendar arithmetic, no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * A sent quotation is expired the day after its `valid_until` (the last day itself is still valid).
 * Only `sent` expires: drafts are not offers yet, approved quotations are locked, rejected ones are already closed.
 */
export function effectiveStatus(status: QuotationStatus, validUntil: string, now: Date): DisplayStatus {
  if (status === "sent" && validUntil < istDate(now)) return "expired";
  return status;
}

/** Actions that are valid from this status. Used by the server (to reject the rest) and by the UI (to show only these). */
export function allowedActions(view: DisplayStatus, hasNumber: boolean): QuotationAction[] {
  switch (view) {
    case "draft":
      // A draft that already has a number is a revision being edited: it can be issued but not deleted.
      return hasNumber ? ["issue", "send"] : ["issue", "send", "delete"];
    case "sent":
      return ["send", "approve", "reject", "revise"];
    case "expired":
      return ["reinstate", "revise"];
    case "rejected":
      return ["reinstate", "revise"];
    case "approved":
      return [];
  }
}

export function canDo(action: QuotationAction, view: DisplayStatus, hasNumber: boolean): boolean {
  return allowedActions(view, hasNumber).includes(action);
}

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

/** Why an action is refused, in words for the person who clicked it. */
export function refusalMessage(action: QuotationAction, view: DisplayStatus): string {
  const state = STATUS_LABELS[view].toLowerCase();
  if (view === "approved") return `This quotation is approved and locked; it cannot be ${verb(action)}`;
  if (view === "expired" && (action === "approve" || action === "reject")) {
    return "This quotation has expired; reinstate it with a new valid-until date first";
  }
  if (action === "revise" && view === "draft") return "This quotation is already a draft; edit it instead of revising it";
  return `A ${state} quotation cannot be ${verb(action)}`;
}

function verb(action: QuotationAction): string {
  switch (action) {
    case "issue":
      return "issued";
    case "send":
      return "sent";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "reinstate":
      return "reinstated";
    case "revise":
      return "revised";
    case "delete":
      return "deleted";
  }
}
