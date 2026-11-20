import { getAuth } from "@/lib/auth";

// Better Auth endpoints (sign-in, sign-out, session). Auth is created lazily per process. Node runtime is the default.
const handler = (request: Request) => getAuth().handler(request);

export { handler as GET, handler as POST };
