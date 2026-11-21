import type { MetadataRoute } from "next";

// Web app manifest: what "Add to Home Screen" uses. Served at /manifest.webmanifest (public, see src/proxy.ts).
// The colours match --background and the brand accent in globals.css; the icons are placeholders until the owner
// supplies a logo (scripts/generate-icons.mjs).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "alpha-Manage",
    short_name: "alpha-Manage",
    description: "Quotations, purchase orders and delivery challans for Alpha Tiles.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fafaf9",
    theme_color: "#fafaf9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
