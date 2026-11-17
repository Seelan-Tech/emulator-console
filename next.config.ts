import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

// The version the build was cut from, for the Help button (it opens the guide of this release).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const config: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    // Set by the image build: the commit, and whether this build is the tagged release.
    NEXT_PUBLIC_APP_REVISION: process.env.GIT_SHA ?? "",
    NEXT_PUBLIC_APP_RELEASE: process.env.RELEASE_BUILD ?? "",
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The embedded service console is same-origin; nothing else may frame the app.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
