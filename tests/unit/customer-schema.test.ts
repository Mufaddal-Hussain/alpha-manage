import { describe, expect, it } from "vitest";
import { customerAddressSchema, customerContactSchema, customerSchema } from "@/lib/customer-schema";

const base = {
  type: "company",
  displayName: "Radius 9 Innovations",
  legalName: "",
  gstin: "",
  pan: "",
  stateCode: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  pincode: "",
  phone: "",
  email: "",
  notes: "",
};

function issues(input: Record<string, unknown>) {
  const result = customerSchema.safeParse({ ...base, ...input });
  return result.success ? null : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("customerSchema (quickstart scenario 2)", () => {
  it("accepts Radius 9 Innovations: company, GSTIN 08BOSPP7444G1ZA, Rajasthan", () => {
    const result = customerSchema.safeParse({ ...base, gstin: "08BOSPP7444G1ZA", stateCode: "08" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gstin).toBe("08BOSPP7444G1ZA");
      expect(result.data.stateCode).toBe("08");
    }
  });

  it("derives the state from the GSTIN when none is chosen", () => {
    const result = customerSchema.safeParse({ ...base, gstin: " 08bospp7444g1za " });
    expect(result.success && result.data.stateCode).toBe("08");
    expect(result.success && result.data.gstin).toBe("08BOSPP7444G1ZA");
  });

  it("accepts an individual in Maharashtra without a GSTIN", () => {
    const result = customerSchema.safeParse({ ...base, type: "individual", displayName: "Taher bhai", stateCode: "27" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gstin).toBeNull();
  });

  it("rejects an invalid GSTIN", () => {
    expect(issues({ gstin: "08BOSPP7444G1Z", stateCode: "08" })?.gstin).toMatch(/15 characters/);
    expect(issues({ gstin: "NOTAGSTIN" })?.gstin).toMatch(/15 characters/);
  });

  it("rejects a state that disagrees with the GSTIN", () => {
    expect(issues({ gstin: "08BOSPP7444G1ZA", stateCode: "27" })?.gstin).toMatch(/match the state/);
  });

  it("requires a state when there is no GSTIN, and rejects an unknown state code", () => {
    expect(issues({})?.stateCode).toBe("Choose a state");
    expect(issues({ stateCode: "28" })?.stateCode).toBe("Choose a state");
  });

  it("rejects a GSTIN with an unknown state prefix", () => {
    expect(issues({ gstin: "28BOSPP7444G1ZA" })?.stateCode).toMatch(/unknown state code/);
  });

  it("requires a name and a valid type", () => {
    expect(issues({ displayName: "  ", stateCode: "27" })?.displayName).toBe("Required");
    expect(issues({ type: "other", stateCode: "27" })?.type).toBeDefined();
  });

  it("checks PAN format and agreement with the GSTIN", () => {
    expect(issues({ stateCode: "27", pan: "abc" })?.pan).toMatch(/ABCDE1234F/);
    expect(issues({ gstin: "08BOSPP7444G1ZA", pan: "ABCDE1234F" })?.pan).toMatch(/does not match/);
    expect(issues({ gstin: "08BOSPP7444G1ZA", pan: "bospp7444g" })).toBeNull();
  });

  it("checks email, phone and pincode when given", () => {
    const problems = issues({ stateCode: "27", email: "nope", phone: "abc", pincode: "123" });
    expect(problems?.email).toMatch(/valid email/);
    expect(problems?.phone).toMatch(/valid phone/);
    expect(problems?.pincode).toMatch(/6 digits/);
    expect(issues({ stateCode: "27", email: "a@b.in", phone: "+91 90214 72657", pincode: "411048" })).toBeNull();
  });
});

describe("customerAddressSchema and customerContactSchema", () => {
  it("needs a label, a first address line and a real state", () => {
    const result = customerAddressSchema.safeParse({ id: "", label: "", addressLine1: "", stateCode: "99x" });
    expect(result.success).toBe(false);
    const ok = customerAddressSchema.safeParse({ id: "", label: "Koregaon Park site", addressLine1: "Lane 5", addressLine2: "", city: "Pune", pincode: "411001", stateCode: "27" });
    expect(ok.success).toBe(true);
  });

  it("needs a contact name", () => {
    expect(customerContactSchema.safeParse({ id: "", name: "", phone: "", email: "", role: "" }).success).toBe(false);
    expect(customerContactSchema.safeParse({ id: "", name: "Site engineer", phone: "9021472657", email: "", role: "Site contact" }).success).toBe(true);
  });
});
