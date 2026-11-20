import path from "node:path";
import { Font } from "@react-pdf/renderer";

let registered = false;

/** Family with the ₹ glyph for all text that can contain amounts. */
export const FONT = "Geist";
/** Built-in bold for labels and headings (no ₹ needed there). */
export const FONT_BOLD = "Helvetica-Bold";

/** Registers the bundled font once per process. Safe to call on every render. */
export function ensureFonts(): void {
  if (registered) return;
  const file = path.join(process.cwd(), "src/lib/pdf/fonts/Geist-Regular.ttf");
  Font.register({ family: FONT, fonts: [{ src: file, fontWeight: "normal" }] });
  // Quotations have no hyphenation-worthy text (names and codes); keep words whole.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
