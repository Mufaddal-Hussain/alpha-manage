import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { businessProfile, file, type QuotationLine, type QuotationRevision } from "@/db/schema";
import { getQuotationDetail } from "@/server/quotation-queries";
import { getStorage } from "@/lib/storage";

// Everything a quotation PDF needs, read once: business details come from `business_profile` (never hard-coded),
// the document figures from the (frozen) revision and its lines.

export interface PdfImage {
  data: Buffer;
  format: "png" | "jpg";
}

export interface QuotationPdfData {
  business: {
    name: string;
    legalName: string;
    addressLines: string[];
    phone: string | null;
    email: string | null;
    gstin: string | null;
    state: string;
    stateCode: string;
    bankName: string | null;
    bankAccountNo: string | null;
    bankIfsc: string | null;
  };
  logo: PdfImage | null;
  brandStrip: PdfImage | null;
  number: string | null;
  customerName: string;
  revision: QuotationRevision;
  lines: QuotationLine[];
  /** True for a revision that has not been issued: rendered with a DRAFT watermark and no number. */
  draft: boolean;
  /** When the business profile (details, logo, strip) last changed; a cached PDF older than this is stale. */
  businessUpdatedAt: Date;
}

async function loadImage(db: Database, fileId: string | null): Promise<PdfImage | null> {
  if (!fileId) return null;
  const [row] = await db.select().from(file).where(eq(file.id, fileId)).limit(1);
  if (!row) return null;
  const format = row.mimeType === "image/png" ? "png" : row.mimeType === "image/jpeg" ? "jpg" : null;
  if (!format) return null; // react-pdf draws PNG and JPEG only
  const stored = await getStorage().get(row.storageKey);
  if (!stored) return null;
  return { data: Buffer.from(await new Response(stored.stream).arrayBuffer()), format };
}

/** The business block, logo and brand strip shared by every PDF; `businessUpdatedAt` tells a cache when it went stale. */
export type PdfBranding = Pick<QuotationPdfData, "business" | "logo" | "brandStrip" | "businessUpdatedAt">;

export async function loadPdfBranding(db: Database): Promise<PdfBranding | null> {
  const [profile] = await db.select().from(businessProfile).limit(1);
  if (!profile) return null;
  const [logo, brandStrip] = await Promise.all([loadImage(db, profile.logoFileId), loadImage(db, profile.brandStripFileId)]);
  const cityLine = [profile.city, profile.pincode].filter(Boolean).join(" - ");
  return {
    business: {
      name: profile.tradeName || profile.legalName,
      legalName: profile.legalName,
      addressLines: [profile.addressLine1, profile.addressLine2, cityLine].filter((l): l is string => Boolean(l && l.trim())),
      phone: profile.phone,
      email: profile.email,
      gstin: profile.gstin,
      state: profile.state,
      stateCode: profile.stateCode,
      bankName: profile.bankName,
      bankAccountNo: profile.bankAccountNo,
      bankIfsc: profile.bankIfsc,
    },
    logo,
    brandStrip,
    businessUpdatedAt: profile.updatedAt,
  };
}

export async function loadQuotationPdfData(db: Database, id: string, revisionNo?: number): Promise<QuotationPdfData | null> {
  const detail = await getQuotationDetail(db, id, revisionNo);
  if (!detail) return null;
  const branding = await loadPdfBranding(db);
  if (!branding) return null;
  return {
    ...branding,
    number: detail.quotation.number,
    customerName: detail.customerName,
    revision: detail.current,
    lines: detail.lines,
    draft: detail.current.issuedAt === null,
  };
}
