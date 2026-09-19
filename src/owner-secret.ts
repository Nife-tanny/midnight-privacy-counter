// The counter contract's `secretKey` witness needs a private value supplied
// locally by the caller — it must never be written to the ledger. This
// generates one on first use and persists it so the same wallet can keep
// incrementing the counter it deployed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const SECRET_FILE_NAME = '.counter-owner-secret';

export function getOrCreateOwnerSecret(cwd: string = process.cwd()): Uint8Array {
  const p = path.join(cwd, SECRET_FILE_NAME);
  if (fs.existsSync(p)) {
    const hex = fs.readFileSync(p, 'utf-8').trim();
    return new Uint8Array(Buffer.from(hex, 'hex'));
  }
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(p, `${secret.toString('hex')}\n`, { mode: 0o600 });
  return new Uint8Array(secret);
}
