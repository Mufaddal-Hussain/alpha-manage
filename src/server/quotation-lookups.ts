"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { findCustomers, getCustomerDetail } from "@/server/customer-queries";
import { getDb } from "@/db";
import { findProducts } from "@/server/product-queries";

// Lookups the quotation editor calls while the person types (customer and product search). Plain serialisable
// data, shaped for the editor rather than for the database; every call authorises first.

export interface CustomerOption {
  id: string;
  displayName: string;
  stateCode: string;
  gstin: string | null;
  phone: string | null;
}

export interface CustomerDetailOption extends CustomerOption {
  billingAddress: string;
  addresses: { id: string; label: string; address: string; stateCode: string; isDefault: boolean }[];
  contacts: { id: string; name: string; phone: string | null }[];
}

export interface ProductOption {
  id: string;
  name: string;
  unit: "box" | "sqft" | "piece";
  piecesPerBox: number | null;
  sqftPerBox: string | null;
  hsnCode: string;
  gstRate: string;
  sellingPrice: string | null;
  sizeLabel: string | null;
  finish: string | null;
  /** Set for products created from a price list. */
  brandName: string | null;
}

const joinLines = (parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(", ");

export async function lookupCustomers(term: string): Promise<CustomerOption[]> {
  await requireUser();
  const rows = await findCustomers(getDb(), String(term).slice(0, 100));
  return rows.slice(0, 20).map((c) => ({ id: c.id, displayName: c.displayName, stateCode: c.stateCode, gstin: c.gstin, phone: c.phone }));
}

export async function lookupCustomerDetail(id: string): Promise<CustomerDetailOption | null> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return null;
  const detail = await getCustomerDetail(id);
  if (!detail) return null;
  const { customer, addresses, contacts } = detail;
  return {
    id: customer.id,
    displayName: customer.displayName,
    stateCode: customer.stateCode,
    gstin: customer.gstin,
    phone: customer.phone,
    billingAddress: joinLines([customer.addressLine1, customer.addressLine2, customer.city, customer.pincode]),
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label,
      address: joinLines([a.addressLine1, a.addressLine2, a.city, a.pincode]),
      stateCode: a.stateCode,
      isDefault: a.isDefaultShipping,
    })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
  };
}

export async function lookupProducts(term: string): Promise<ProductOption[]> {
  await requireUser();
  const rows = await findProducts(getDb(), String(term).slice(0, 100));
  return rows.slice(0, 20).map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    piecesPerBox: p.piecesPerBox,
    sqftPerBox: p.sqftPerBox === null ? null : String(Number(p.sqftPerBox)),
    hsnCode: p.hsnCode,
    gstRate: String(Number(p.gstRate)),
    sellingPrice: p.sellingPricePerUnit,
    sizeLabel: p.sizeLabel,
    finish: p.finish,
    brandName: p.brandName,
  }));
}
