import { encrypt } from "@/lib/crypto";
import { firstRow, query } from "@/lib/db";

export async function seedTarget(name = "emu", opts: { filesDir?: string } = {}) {
  const files = opts.filesDir !== undefined;
  const rows = await query<{ id: string }>(
    `insert into targets(name, endpoint_url, region, auth_mode, access_key_id, secret_key_enc, files_dir)
     values ($1, 'https://emulator:9297', 'us-east-1', $2, $3, $4, $5) returning id`,
    [name, files ? "files" : "static", files ? null : "AKIA", files ? null : encrypt("secret"), opts.filesDir ?? null],
  );
  return firstRow(rows).id;
}

export async function seedFixture(name = "seed") {
  const rows = await query<{ id: string }>("insert into fixtures(name, steps) values ($1, '[]') returning id", [name]);
  return firstRow(rows).id;
}
