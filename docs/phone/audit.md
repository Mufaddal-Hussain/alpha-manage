# Phone audit (T087)

Run with `PHONE_AUDIT=1 npx playwright test --project=iphone-390 mobile-audit` (also 375 and 430). It signs in as the owner, visits every screen (27 routes plus the open menu) and measures: sideways overflow, touch targets under 44 px, field text under 16 px. Engines: Chromium with iPhone emulation (touch, 3x pixels, iPhone user agent) and, with `PHONE_BROWSER=webkit`, WebKit. Without `PHONE_AUDIT` the same spec fails on any finding, so it is the regression check.

## Before the fixes (identical at 375, 390 and 430)

6 overflow findings, 307 touch targets under 44 px, 163 fields under 16 px, on nearly every screen:

- **Quotations list**: page 505 px wide in a 390 px viewport (the filter row did not wrap).
- **Every form field, select and textarea**: 38 px high with 14 px text (iOS would zoom on focus).
- **Buttons and links styled as buttons**: 32–36 px high (including Menu, Search, Save, Issue, Duplicate, View/Download PDF).
- **Tables** (lists, line items, import review, PO and challan forms): only a sideways scroll inside the card, no stacked layout.
- Links in list rows 18 px high, `summary` toggles (Fix values, Reset password) 20–40 px, "Cancel" and "Download the template" links 18–20 px, move/remove line buttons 37 px wide.
- No manifest, icons or iOS metadata; no safe-area handling; the menu was a slide-down panel.

## After

0 findings at all three widths. What changed: phone rules in `globals.css` (44 px targets, 16 px fields, tables as cards via `table.stack` + `data-label`, sticky `.action-bar`), a drawer menu with safe-area padding, wrapping filter rows, `viewport-fit=cover` and theme colours, `manifest.ts` with icons in `public/icons/`, `appleWebApp` metadata, separate View and Download PDF actions. Desktop (md and up) styles are untouched; the desktop e2e specs all pass.

## WebKit run
After installing WebKit (`npx playwright install webkit`), `PHONE_BROWSER=webkit npx playwright test --project=iphone-375 --project=iphone-390 --project=iphone-430` passes: the audit at all three widths and the main-flow spec at 390 px. The first WebKit run found something Chromium hid: native `<select>` elements were drawn 26 px high whatever `min-height` said. On phones selects are now drawn by the page (`appearance: none`, own arrow, 44 px high); the picker that opens is still the native one. The flow spec also retypes in the customer and product searches, because WebKit can lose text typed before the page has hydrated.

## Not covered by the audit
Inline links inside a sentence are exempt from the 44 px rule (they follow the text). Real iPhone Safari and standalone behaviour were not tested (WebKit here is the desktop build with iPhone emulation): see the T093 note below.

## T093: iPhone simulator
**Not run.** The iOS Simulator tool refused to attach: only the Xcode command-line tools are installed, not full Xcode (`/Library/Developer/CoreSimulator` does not exist). To enable it: install Xcode from the Mac App Store, then run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. Instead, the screenshots in this folder were taken by `PHONE_SHOTS=1 npx playwright test --project=iphone-390 mobile.spec` in **Chromium with iPhone 14 emulation (390 × 844)**, not Safari, so they show layout but not WebKit rendering, safe-area insets (always 0 here), "Add to Home Screen" or standalone mode. The WebKit run above is the next best check; the screenshots themselves are from Chromium.
