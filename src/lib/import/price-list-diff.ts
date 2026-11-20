import type { ImportDesignDiff } from "@/db/schema/catalog";
import { dec } from "@/lib/money";
import { nameKey, type PriceRow } from "./price-list-rules";

// Diff semantics of contracts/price-list-import.md: the new rows are compared with the brand's current published
// list, matched by (size, finish, design). Pure functions over plain data; the database layer loads the current list.

/** One group of the brand's current published price list with its design names. */
export interface CurrentGroup {
  sizeLabel: string;
  finish: string;
  piecesPerBox: number;
  sqftPerBox: string;
  ratePerBox: string;
  ratePerSqft: string;
  designs: string[];
}

export interface RowDiff {
  /** `changed` if any design changed, else `new` if any design is new, else `unchanged`. */
  kind: "new" | "changed" | "unchanged";
  designs: ImportDesignDiff[];
}

/** Designs of one old group that the new list no longer has: left to the owner to keep or discontinue. */
export interface RemovedGroup {
  sizeLabel: string;
  finish: string;
  piecesPerBox: number;
  sqftPerBox: string;
  ratePerBox: string;
  ratePerSqft: string;
  designs: string[];
}

const designKey = (size: string, finish: string, design: string) => `${nameKey(size)}|${nameKey(finish)}|${nameKey(design)}`;

function sameTerms(a: ComparableGroup, b: CurrentGroup): boolean {
  return dec(a.ratePerBox).eq(b.ratePerBox) && dec(a.ratePerSqft).eq(b.ratePerSqft) && a.piecesPerBox === b.piecesPerBox && dec(a.sqftPerBox).eq(b.sqftPerBox);
}

/** What the comparison needs from a new row; a stored price group with its design names fits as well as a parsed row. */
export type ComparableGroup = Pick<PriceRow, "size" | "finish" | "piecesPerBox" | "sqftPerBox" | "ratePerBox" | "ratePerSqft" | "designs">;

export function diffAgainstCurrent(
  current: readonly CurrentGroup[],
  incoming: readonly ComparableGroup[],
  options: { unreadableDesigns?: readonly string[] } = {},
): { rows: RowDiff[]; removed: RemovedGroup[] } {
  const oldByKey = new Map<string, CurrentGroup>();
  for (const group of current) {
    for (const design of group.designs) oldByKey.set(designKey(group.sizeLabel, group.finish, design), group);
  }

  const seen = new Set<string>();
  const rows = incoming.map((row): RowDiff => {
    const designs = row.designs.map((name): ImportDesignDiff => {
      const key = designKey(row.size, row.finish, name);
      seen.add(key);
      const old = oldByKey.get(key);
      if (!old) return { name, kind: "new" };
      if (sameTerms(row, old)) return { name, kind: "unchanged" };
      return { name, kind: "changed", previousRatePerBox: old.ratePerBox };
    });
    const kind = designs.some((d) => d.kind === "changed") ? "changed" : designs.some((d) => d.kind === "new") ? "new" : "unchanged";
    return { kind, designs };
  });

  const unreadable = new Set((options.unreadableDesigns ?? []).map(nameKey));
  const removed: RemovedGroup[] = [];
  for (const group of current) {
    const gone = group.designs.filter((d) => !seen.has(designKey(group.sizeLabel, group.finish, d)) && !unreadable.has(nameKey(d)));
    if (gone.length > 0) {
      removed.push({
        sizeLabel: group.sizeLabel,
        finish: group.finish,
        piecesPerBox: group.piecesPerBox,
        sqftPerBox: group.sqftPerBox,
        ratePerBox: group.ratePerBox,
        ratePerSqft: group.ratePerSqft,
        designs: gone,
      });
    }
  }
  return { rows, removed };
}
