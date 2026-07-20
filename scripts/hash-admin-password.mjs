// Operator helper for admin auth (BE-ADMIN-AUTH). Never commits a secret.
//
//   bun scripts/hash-admin-password.mjs 'your-password'   → prints ADMIN_PASSWORD_HASH
//   bun scripts/hash-admin-password.mjs                   → also prints a fresh
//                                                           ADMIN_SESSION_SECRET
//
// The bcrypt hash and the session secret are meant to be pasted into the server
// environment (Railway → Variables). Nothing here writes to disk or logs.

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const password = process.argv[2];
const rounds = Number(process.argv[3]) || 12;

console.log('# Admin auth env values — paste into your server environment (never commit).');
console.log('#');

if (password) {
  const hash = bcrypt.hashSync(String(password), rounds);
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
} else {
  console.log('# (no password argument given — run with:  bun scripts/hash-admin-password.mjs \'your-password\')');
}

console.log(`ADMIN_SESSION_SECRET='${crypto.randomBytes(32).toString('base64url')}'`);
console.log('#');
console.log('# Then set ADMIN_EMAIL, hit POST /admin/auth/enroll to get ADMIN_TOTP_SECRET,');
console.log('# and (optionally) ADMIN_SESSION_TTL_HOURS. See docs/ADMIN_AUTH_CONTRACT.md.');
