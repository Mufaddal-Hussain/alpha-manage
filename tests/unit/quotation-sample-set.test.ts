import { describe, expect, it } from "vitest";
import { computeQuotation } from "@/lib/quotation/calc";

// SC-002: totals, GST split, round-off and the total in words agree with an independent hand calculation on a sample set
// of at least 20 quotations: same-state, inter-state, discounted, paise rates, fractional sq.ft quantities, mixed GST rates,
// zero-rated lines, negative round-off, lakh and crore totals.
//
// The expected values were produced by a separate implementation (exact fractions, half-up rounding of each line's taxable
// value and each side of the tax, then round-off to the rupee, then Indian-numbering words), not by the code under test.
// The first five cases are the ones worked by hand in quotation-calc.test.ts and gave the same figures.
const CASES: Array<{
  name: string;
  mode: "intra" | "inter";
  lines: Array<{ quantity: string; rate: string; discountPercent: string; gstRate: string }>;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  grandTotal: string;
  words: string;
}> = [
  {
    "name": "Radius 9, intra",
    "mode": "intra",
    "lines": [
      {
        "quantity": "4",
        "rate": "580.00",
        "discountPercent": "0",
        "gstRate": "18"
      },
      {
        "quantity": "1",
        "rate": "550.00",
        "discountPercent": "0",
        "gstRate": "18"
      }
    ],
    "taxable": "2870.00",
    "cgst": "258.30",
    "sgst": "258.30",
    "igst": "0.00",
    "roundOff": "0.40",
    "grandTotal": "3387.00",
    "words": "INR Three Thousand Three Hundred Eighty Seven Only"
  },
  {
    "name": "Radius 9, inter",
    "mode": "inter",
    "lines": [
      {
        "quantity": "4",
        "rate": "580.00",
        "discountPercent": "0",
        "gstRate": "18"
      },
      {
        "quantity": "1",
        "rate": "550.00",
        "discountPercent": "0",
        "gstRate": "18"
      }
    ],
    "taxable": "2870.00",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "516.60",
    "roundOff": "0.40",
    "grandTotal": "3387.00",
    "words": "INR Three Thousand Three Hundred Eighty Seven Only"
  },
  {
    "name": "discount 10%, intra",
    "mode": "intra",
    "lines": [
      {
        "quantity": "10",
        "rate": "883.50",
        "discountPercent": "10",
        "gstRate": "18"
      }
    ],
    "taxable": "7951.50",
    "cgst": "715.64",
    "sgst": "715.64",
    "igst": "0.00",
    "roundOff": "0.22",
    "grandTotal": "9383.00",
    "words": "INR Nine Thousand Three Hundred Eighty Three Only"
  },
  {
    "name": "paise rate, half-up tax",
    "mode": "intra",
    "lines": [
      {
        "quantity": "3",
        "rate": "1007.50",
        "discountPercent": "0",
        "gstRate": "18"
      }
    ],
    "taxable": "3022.50",
    "cgst": "272.03",
    "sgst": "272.03",
    "igst": "0.00",
    "roundOff": "0.44",
    "grandTotal": "3567.00",
    "words": "INR Three Thousand Five Hundred Sixty Seven Only"
  },
  {
    "name": "negative round-off",
    "mode": "intra",
    "lines": [
      {
        "quantity": "1",
        "rate": "100.30",
        "discountPercent": "0",
        "gstRate": "18"
      }
    ],
    "taxable": "100.30",
    "cgst": "9.03",
    "sgst": "9.03",
    "igst": "0.00",
    "roundOff": "-0.36",
    "grandTotal": "118.00",
    "words": "INR One Hundred Eighteen Only"
  },
  {
    "name": "mixed 18% and 5% charge",
    "mode": "intra",
    "lines": [
      {
        "quantity": "1",
        "rate": "1000.00",
        "discountPercent": "0",
        "gstRate": "18"
      },
      {
        "quantity": "1",
        "rate": "500.00",
        "discountPercent": "0",
        "gstRate": "5"
      }
    ],
    "taxable": "1500.00",
    "cgst": "102.50",
    "sgst": "102.50",
    "igst": "0.00",
    "roundOff": "0.00",
    "grandTotal": "1705.00",
    "words": "INR One Thousand Seven Hundred Five Only"
  },
  {
    "name": "0% GST line",
    "mode": "inter",
    "lines": [
      {
        "quantity": "7",
        "rate": "123.45",
        "discountPercent": "0",
        "gstRate": "0"
      }
    ],
    "taxable": "864.15",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "0.00",
    "roundOff": "-0.15",
    "grandTotal": "864.00",
    "words": "INR Eight Hundred Sixty Four Only"
  },
  {
    "name": "50% discount",
    "mode": "intra",
    "lines": [
      {
        "quantity": "5",
        "rate": "999.99",
        "discountPercent": "50",
        "gstRate": "18"
      }
    ],
    "taxable": "2499.98",
    "cgst": "225.00",
    "sgst": "225.00",
    "igst": "0.00",
    "roundOff": "0.02",
    "grandTotal": "2950.00",
    "words": "INR Two Thousand Nine Hundred Fifty Only"
  },
  {
    "name": "fractional sq.ft quantity",
    "mode": "intra",
    "lines": [
      {
        "quantity": "37.5",
        "rate": "61.29",
        "discountPercent": "0",
        "gstRate": "18"
      }
    ],
    "taxable": "2298.38",
    "cgst": "206.85",
    "sgst": "206.85",
    "igst": "0.00",
    "roundOff": "-0.08",
    "grandTotal": "2712.00",
    "words": "INR Two Thousand Seven Hundred Twelve Only"
  },
  {
    "name": "lakh-sized order",
    "mode": "inter",
    "lines": [
      {
        "quantity": "1250",
        "rate": "412.75",
        "discountPercent": "5",
        "gstRate": "18"
      }
    ],
    "taxable": "490140.63",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "88225.31",
    "roundOff": "0.06",
    "grandTotal": "578366.00",
    "words": "INR Five Lakh Seventy Eight Thousand Three Hundred Sixty Six Only"
  },
  {
    "name": "crore-sized order",
    "mode": "intra",
    "lines": [
      {
        "quantity": "40000",
        "rate": "305.50",
        "discountPercent": "2.5",
        "gstRate": "28"
      }
    ],
    "taxable": "11914500.00",
    "cgst": "1668030.00",
    "sgst": "1668030.00",
    "igst": "0.00",
    "roundOff": "0.00",
    "grandTotal": "15250560.00",
    "words": "INR One Crore Fifty Two Lakh Fifty Thousand Five Hundred Sixty Only"
  },
  {
    "name": "tiny order",
    "mode": "intra",
    "lines": [
      {
        "quantity": "1",
        "rate": "0.99",
        "discountPercent": "0",
        "gstRate": "12"
      }
    ],
    "taxable": "0.99",
    "cgst": "0.06",
    "sgst": "0.06",
    "igst": "0.00",
    "roundOff": "-0.11",
    "grandTotal": "1.00",
    "words": "INR One Only"
  },
  {
    "name": "random sample 1",
    "mode": "intra",
    "lines": [
      {
        "quantity": "3",
        "rate": "1637.83",
        "discountPercent": "0",
        "gstRate": "5"
      },
      {
        "quantity": "8",
        "rate": "405.46",
        "discountPercent": "0",
        "gstRate": "18"
      },
      {
        "quantity": "4.5",
        "rate": "173.11",
        "discountPercent": "12.5",
        "gstRate": "18"
      }
    ],
    "taxable": "8838.79",
    "cgst": "476.12",
    "sgst": "476.12",
    "igst": "0.00",
    "roundOff": "-0.03",
    "grandTotal": "9791.00",
    "words": "INR Nine Thousand Seven Hundred Ninety One Only"
  },
  {
    "name": "random sample 2",
    "mode": "inter",
    "lines": [
      {
        "quantity": "2",
        "rate": "2277.54",
        "discountPercent": "0",
        "gstRate": "18"
      },
      {
        "quantity": "2",
        "rate": "934.80",
        "discountPercent": "0",
        "gstRate": "18"
      }
    ],
    "taxable": "6424.68",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "1156.44",
    "roundOff": "-0.12",
    "grandTotal": "7581.00",
    "words": "INR Seven Thousand Five Hundred Eighty One Only"
  },
  {
    "name": "random sample 3",
    "mode": "inter",
    "lines": [
      {
        "quantity": "4.5",
        "rate": "210.71",
        "discountPercent": "2.5",
        "gstRate": "18"
      }
    ],
    "taxable": "924.49",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "166.41",
    "roundOff": "0.10",
    "grandTotal": "1091.00",
    "words": "INR One Thousand Ninety One Only"
  },
  {
    "name": "random sample 4",
    "mode": "intra",
    "lines": [
      {
        "quantity": "8",
        "rate": "502.73",
        "discountPercent": "7.5",
        "gstRate": "18"
      },
      {
        "quantity": "3",
        "rate": "442.74",
        "discountPercent": "5",
        "gstRate": "18"
      }
    ],
    "taxable": "4982.01",
    "cgst": "448.38",
    "sgst": "448.38",
    "igst": "0.00",
    "roundOff": "0.23",
    "grandTotal": "5879.00",
    "words": "INR Five Thousand Eight Hundred Seventy Nine Only"
  },
  {
    "name": "random sample 5",
    "mode": "intra",
    "lines": [
      {
        "quantity": "2",
        "rate": "2331.07",
        "discountPercent": "5",
        "gstRate": "18"
      },
      {
        "quantity": "8",
        "rate": "1771.99",
        "discountPercent": "10",
        "gstRate": "18"
      },
      {
        "quantity": "250.25",
        "rate": "1501.38",
        "discountPercent": "5",
        "gstRate": "12"
      },
      {
        "quantity": "4.5",
        "rate": "355.73",
        "discountPercent": "7.5",
        "gstRate": "18"
      },
      {
        "quantity": "250.25",
        "rate": "1426.93",
        "discountPercent": "15",
        "gstRate": "18"
      }
    ],
    "taxable": "679128.27",
    "cgst": "50413.52",
    "sgst": "50413.52",
    "igst": "0.00",
    "roundOff": "-0.31",
    "grandTotal": "779955.00",
    "words": "INR Seven Lakh Seventy Nine Thousand Nine Hundred Fifty Five Only"
  },
  {
    "name": "random sample 6",
    "mode": "inter",
    "lines": [
      {
        "quantity": "8",
        "rate": "1732.21",
        "discountPercent": "10",
        "gstRate": "12"
      }
    ],
    "taxable": "12471.91",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "1496.63",
    "roundOff": "0.46",
    "grandTotal": "13969.00",
    "words": "INR Thirteen Thousand Nine Hundred Sixty Nine Only"
  },
  {
    "name": "random sample 7",
    "mode": "inter",
    "lines": [
      {
        "quantity": "1",
        "rate": "337.97",
        "discountPercent": "10",
        "gstRate": "18"
      },
      {
        "quantity": "37.5",
        "rate": "2454.63",
        "discountPercent": "15",
        "gstRate": "5"
      },
      {
        "quantity": "2",
        "rate": "1125.60",
        "discountPercent": "0",
        "gstRate": "5"
      },
      {
        "quantity": "12",
        "rate": "2387.87",
        "discountPercent": "15",
        "gstRate": "18"
      }
    ],
    "taxable": "105152.97",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "8463.51",
    "roundOff": "-0.48",
    "grandTotal": "113616.00",
    "words": "INR One Lakh Thirteen Thousand Six Hundred Sixteen Only"
  },
  {
    "name": "random sample 8",
    "mode": "intra",
    "lines": [
      {
        "quantity": "1",
        "rate": "1911.45",
        "discountPercent": "2.5",
        "gstRate": "18"
      },
      {
        "quantity": "2",
        "rate": "2042.07",
        "discountPercent": "5",
        "gstRate": "18"
      },
      {
        "quantity": "3",
        "rate": "1034.50",
        "discountPercent": "12.5",
        "gstRate": "18"
      }
    ],
    "taxable": "8459.15",
    "cgst": "761.32",
    "sgst": "761.32",
    "igst": "0.00",
    "roundOff": "0.21",
    "grandTotal": "9982.00",
    "words": "INR Nine Thousand Nine Hundred Eighty Two Only"
  },
  {
    "name": "random sample 9",
    "mode": "inter",
    "lines": [
      {
        "quantity": "250.25",
        "rate": "1665.70",
        "discountPercent": "7.5",
        "gstRate": "12"
      },
      {
        "quantity": "100",
        "rate": "2273.35",
        "discountPercent": "12.5",
        "gstRate": "18"
      }
    ],
    "taxable": "584496.45",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "82074.66",
    "roundOff": "-0.11",
    "grandTotal": "666571.00",
    "words": "INR Six Lakh Sixty Six Thousand Five Hundred Seventy One Only"
  },
  {
    "name": "random sample 10",
    "mode": "inter",
    "lines": [
      {
        "quantity": "3",
        "rate": "359.22",
        "discountPercent": "2.5",
        "gstRate": "12"
      },
      {
        "quantity": "4.5",
        "rate": "69.62",
        "discountPercent": "2.5",
        "gstRate": "18"
      }
    ],
    "taxable": "1356.18",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "181.07",
    "roundOff": "-0.25",
    "grandTotal": "1537.00",
    "words": "INR One Thousand Five Hundred Thirty Seven Only"
  },
  {
    "name": "random sample 11",
    "mode": "inter",
    "lines": [
      {
        "quantity": "3",
        "rate": "1736.68",
        "discountPercent": "10",
        "gstRate": "18"
      }
    ],
    "taxable": "4689.04",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "844.03",
    "roundOff": "-0.07",
    "grandTotal": "5533.00",
    "words": "INR Five Thousand Five Hundred Thirty Three Only"
  },
  {
    "name": "random sample 12",
    "mode": "inter",
    "lines": [
      {
        "quantity": "8",
        "rate": "241.58",
        "discountPercent": "12.5",
        "gstRate": "18"
      },
      {
        "quantity": "100",
        "rate": "1634.13",
        "discountPercent": "15",
        "gstRate": "28"
      }
    ],
    "taxable": "140592.11",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "39196.68",
    "roundOff": "0.21",
    "grandTotal": "179789.00",
    "words": "INR One Lakh Seventy Nine Thousand Seven Hundred Eighty Nine Only"
  },
  {
    "name": "random sample 13",
    "mode": "intra",
    "lines": [
      {
        "quantity": "4.5",
        "rate": "295.26",
        "discountPercent": "15",
        "gstRate": "12"
      }
    ],
    "taxable": "1129.37",
    "cgst": "67.76",
    "sgst": "67.76",
    "igst": "0.00",
    "roundOff": "0.11",
    "grandTotal": "1265.00",
    "words": "INR One Thousand Two Hundred Sixty Five Only"
  },
  {
    "name": "random sample 14",
    "mode": "inter",
    "lines": [
      {
        "quantity": "1",
        "rate": "439.00",
        "discountPercent": "2.5",
        "gstRate": "18"
      },
      {
        "quantity": "2",
        "rate": "1509.78",
        "discountPercent": "0",
        "gstRate": "5"
      },
      {
        "quantity": "4.5",
        "rate": "1561.19",
        "discountPercent": "7.5",
        "gstRate": "18"
      }
    ],
    "taxable": "9946.04",
    "cgst": "0.00",
    "sgst": "0.00",
    "igst": "1397.75",
    "roundOff": "0.21",
    "grandTotal": "11344.00",
    "words": "INR Eleven Thousand Three Hundred Forty Four Only"
  }
];

describe("SC-002: independent hand-calculation sample set", () => {
  it("has at least 20 quotations, covering both tax modes", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(CASES.some((c) => c.mode === "intra")).toBe(true);
    expect(CASES.some((c) => c.mode === "inter")).toBe(true);
  });

  it.each(CASES)("$name ($mode)", (c) => {
    const q = computeQuotation(
      c.lines.map((l) => ({ kind: "product" as const, quantity: l.quantity, rate: l.rate, discountPercent: l.discountPercent, gstRate: l.gstRate, hsnCode: "6907" })),
      c.mode,
    );
    expect(q.taxableTotal.toFixed(2)).toBe(c.taxable);
    expect(q.cgstTotal.toFixed(2)).toBe(c.cgst);
    expect(q.sgstTotal.toFixed(2)).toBe(c.sgst);
    expect(q.igstTotal.toFixed(2)).toBe(c.igst);
    expect(q.roundOff.toFixed(2)).toBe(c.roundOff);
    expect(q.grandTotal.toFixed(2)).toBe(c.grandTotal);
    expect(q.totalInWords).toBe(c.words);
  });
});
