import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/amount-in-words";

describe("amountInWords", () => {
  it("matches the Radius 9 sample exactly", () => {
    expect(amountInWords("3387.00")).toBe("INR Three Thousand Three Hundred Eighty Seven Only");
  });

  it("accepts numbers and decimals", () => {
    expect(amountInWords(3387)).toBe("INR Three Thousand Three Hundred Eighty Seven Only");
  });

  it("writes zero", () => {
    expect(amountInWords("0")).toBe("INR Zero Only");
  });

  it("writes numbers below twenty and round tens", () => {
    expect(amountInWords("13")).toBe("INR Thirteen Only");
    expect(amountInWords("40")).toBe("INR Forty Only");
    expect(amountInWords("100")).toBe("INR One Hundred Only");
  });

  it("uses Indian numbering: thousand, lakh, crore", () => {
    expect(amountInWords("100000")).toBe("INR One Lakh Only");
    expect(amountInWords("1234567")).toBe("INR Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only");
    expect(amountInWords("10000000")).toBe("INR One Crore Only");
    expect(amountInWords("123456789")).toBe(
      "INR Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only",
    );
  });

  it("skips empty groups", () => {
    expect(amountInWords("100005")).toBe("INR One Lakh Five Only");
    expect(amountInWords("10000100")).toBe("INR One Crore One Hundred Only");
  });

  it("writes paise after the rupees", () => {
    expect(amountInWords("1234.56")).toBe("INR One Thousand Two Hundred Thirty Four and Fifty Six Paise Only");
    expect(amountInWords("1.05")).toBe("INR One and Five Paise Only");
  });

  it("writes paise only when there are no rupees", () => {
    expect(amountInWords("0.50")).toBe("INR Fifty Paise Only");
  });

  it("rounds to paise half-up before writing", () => {
    expect(amountInWords("1.005")).toBe("INR One and One Paise Only");
    expect(amountInWords("0.999")).toBe("INR One Only");
  });

  it("rejects negative amounts", () => {
    expect(() => amountInWords("-1")).toThrow();
  });
});
