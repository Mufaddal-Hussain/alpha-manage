# PDF fonts

`Geist-Regular.ttf` is the Geist typeface by Vercel (SIL Open Font License 1.1, https://github.com/vercel/geist-font).
It is bundled because the PDF standard fonts have no rupee sign (₹); Geist does (U+20B9) and covers the Latin text used
on quotations. It was copied from the copy shipped inside `next` (`next/dist/compiled/@vercel/og`).

Only the regular weight is bundled. Headings and labels use the built-in Helvetica-Bold, which is fine for text with
no ₹ in it. To use a real bold weight with ₹ later, drop its `.ttf` here and register it in `../fonts.ts`.
