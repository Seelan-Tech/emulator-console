import { type NextRequest, NextResponse } from "next/server";

import { hostAllowed } from "@/lib/host";

// The console has no login, so refuse any request whose Host isn't one we expect (DNS-rebinding defence).
export function middleware(req: NextRequest) {
  if (!hostAllowed(req.headers.get("host"))) {
    return new NextResponse("Host not allowed", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
