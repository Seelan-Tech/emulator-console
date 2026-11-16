// npm run env:example: rewrites .env.example and docs/configuration.md from the documented configuration in src/lib/env.ts.
import { writeFileSync } from "node:fs";

import { renderConfigDoc, renderEnvExample } from "../src/lib/env";

writeFileSync(new URL("../.env.example", import.meta.url), renderEnvExample());
writeFileSync(new URL("../docs/configuration.md", import.meta.url), renderConfigDoc());
console.log("wrote .env.example and docs/configuration.md");
