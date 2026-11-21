import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "alpha-Manage",
  description: "Business management for tile businesses: price lists, quotations, deliveries, invoices and receipts.",
  applicationName: "alpha-Manage",
  // Saved to the iPhone home screen the app opens standalone (no Safari bars) under this name and icon. "default" keeps
  // the status bar solid with dark text over the light page; "black-translucent" would put white clock and battery on
  // the near-white page background.
  appleWebApp: { capable: true, title: "alpha-Manage", statusBarStyle: "default" },
  // Stops Safari turning order numbers and phone numbers into links of its own.
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// viewport-fit=cover lets the page use the whole screen on an iPhone (notch and home bar included); the shell pads
// itself with env(safe-area-inset-*). Zoom stays allowed, which accessibility needs.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
