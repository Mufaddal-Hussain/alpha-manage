"use client";

import { createAuthClient } from "better-auth/react";

// Browser-side client for the sign-in form and sign-out button (talks to /api/auth/*).
export const authClient = createAuthClient();
