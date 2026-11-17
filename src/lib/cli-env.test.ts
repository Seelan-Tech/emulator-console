import assert from "node:assert/strict";

import { test } from "vitest";

import { cliExports, emulatorPort } from "./cli-env";

test("the CLI block points every variable at the emulator's folder and the chosen region", () => {
  const b = cliExports({ port: "9297", region: "us-west-2" });
  assert.match(b, /^unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN\n/);
  assert.match(b, /AWS_ENDPOINT_URL=https:\/\/127\.0\.0\.1:9297/);
  assert.match(b, /AWS_SHARED_CREDENTIALS_FILE=~\/\.aws\/emulator\/9297\/emulator_credentials/);
  assert.match(b, /AWS_CA_BUNDLE=~\/\.aws\/emulator\/9297\/ca\.pem/);
  assert.match(b, /AWS_REGION=us-west-2 AWS_DEFAULT_REGION=us-west-2$/);
});

test("the port comes from the credentials folder, else from the endpoint URL", () => {
  assert.equal(emulatorPort("9297", "https://emulator:1"), "9297");
  assert.equal(emulatorPort("custom", "https://emulator:9400"), "9400");
  assert.equal(emulatorPort(null, "https://emulator"), null);
  assert.equal(emulatorPort(null, "not a url"), null);
});
