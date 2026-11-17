// The shell block that points the AWS CLI at a local emulator: the same variables the docs use, built from the target.
// The port is the emulator's, as in its credentials folder (~/.aws/emulator/<port>/).
export function cliExports(o: { port: string; region: string }): string {
  const dir = `~/.aws/emulator/${o.port}`;
  return [
    "unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN",
    `export AWS_ENDPOINT_URL=https://127.0.0.1:${o.port} \\`,
    `  AWS_SHARED_CREDENTIALS_FILE=${dir}/emulator_credentials \\`,
    `  AWS_CONFIG_FILE=${dir}/config \\`,
    `  AWS_CA_BUNDLE=${dir}/ca.pem \\`,
    "  AWS_EC2_METADATA_DISABLED=true AWS_DISABLE_HOST_PREFIX_INJECTION=true \\",
    `  AWS_REGION=${o.region} AWS_DEFAULT_REGION=${o.region}`,
  ].join("\n");
}

// The emulator's port: the credentials folder is named after it; otherwise the port of the target's endpoint URL.
export function emulatorPort(filesDir: string | null | undefined, endpointUrl: string): string | null {
  if (filesDir && /^\d+$/.test(filesDir)) return filesDir;
  try {
    return new URL(endpointUrl).port || null;
  } catch {
    return null;
  }
}
