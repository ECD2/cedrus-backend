import zlib from 'node:zlib';

// ─────────────────────────────────────────────────────────────────────────────
// CHAT-EXPORT PARSERS (NF2-IMPORT) — file bytes in, user-authored text out.
//
// Governed by cedrus-parser-discipline.md. The rules this file exists to
// enforce, in its own layer, before any model is involved:
//
//   • The upload is UNTRUSTED BYTES. Nothing here trusts a filename, a
//     content-type header, or any string inside the file. Type is decided by
//     magic bytes; structure is validated in code; every dimension is capped.
//   • Only the two official export formats are accepted: a ChatGPT data
//     export (conversations.json — an array of conversations with `mapping`
//     graphs) and a Claude export (an array of conversations with
//     `chat_messages`). Either as a bare .json file or inside the export .zip.
//   • Executables and every other file type are rejected by magic bytes.
//   • Only USER-AUTHORED messages are extracted. Assistant turns are never a
//     fact source — they are an injection surface (discipline §1, S12).
//   • Nothing is ever written to disk and no entry name is ever used as a
//     path. The zip reader works entirely on the in-memory buffer, reads ONE
//     entry (conversations.json), and inflates with a hard output cap so a
//     zip bomb dies at the cap instead of in the process's memory.
//
// This file is pure: bytes in, plain data out, typed errors thrown. It does
// no I/O, imports no client, and knows nothing about users or jobs.
// ─────────────────────────────────────────────────────────────────────────────

// Caps. Deliberately constants (not env) at this layer: the service layer
// (services/chatImport.js) owns the env-tunable upload cap; these bound the
// parser's own work no matter who calls it.
export const MAX_JSON_BYTES = 100 * 1024 * 1024;  // inflated conversations.json
export const MAX_MESSAGES = 100_000;              // user messages collected
export const MAX_MESSAGE_CHARS = 4_000;           // per-message slice
export const MAX_CONVERSATIONS = 20_000;

export class ImportParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ImportParseError';
    this.code = code; // machine code; the route maps these to 4xx + public copy
  }
}

const fail = (code, message) => { throw new ImportParseError(code, message); };

// ── 1. Magic-byte sniffing — the ONLY type authority ────────────────────────
// Filenames and content-type headers are attacker-chosen; bytes are not.
const EXEC_MAGICS = [
  [0x4d, 0x5a],             // MZ — Windows PE
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 32/64 BE
  [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 32/64 LE
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal / Java class
  [0x23, 0x21],             // "#!" shebang script
];

export function sniffFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) fail('unsupported_type', 'file too small to be an export');
  for (const magic of EXEC_MAGICS) {
    if (magic.every((b, i) => buf[i] === b)) fail('unsupported_type', 'executable content rejected');
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip'; // "PK" (0304/0506/0708 all start PK)
  // Bare JSON: skip UTF-8 BOM + whitespace, expect an array (both official
  // export shapes are arrays) or object (rejected later with a clearer code).
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  if (buf[i] === 0x5b || buf[i] === 0x7b) return 'json'; // "[" or "{"
  return fail('unsupported_type', 'not a zip or JSON export');
}

// ── 2. Minimal, defensive zip reader (dependency-free) ──────────────────────
// Reads exactly one entry by basename from the central directory. Supports
// stored (0) and deflate (8) — what real ChatGPT/Claude exports use. Rejects
// encryption, zip64, and anything that inflates past maxBytes. Never touches
// the filesystem, so entry names can't traverse anything.
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(buf) {
  // EOCD is at the end; comment can be up to 0xFFFF bytes. Scan backwards.
  const start = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return fail('invalid_zip', 'zip end-of-central-directory not found');
}

export function extractZipEntry(buf, basename, { maxBytes = MAX_JSON_BYTES } = {}) {
  const eocd = findEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    fail('invalid_zip', 'zip64 archives are not supported');
  }
  if (cdOffset + cdSize > buf.length) fail('invalid_zip', 'central directory out of bounds');

  // Walk the central directory; collect candidate entries by basename.
  const candidates = [];
  let p = cdOffset;
  for (let n = 0; n < entryCount && p + 46 <= cdOffset + cdSize; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) fail('invalid_zip', 'bad central-directory record');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const base = name.split('/').pop();
    if (base === basename) {
      candidates.push({ name, flags, method, compSize, uncompSize, localOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!candidates.length) return null;

  // Prefer a root-level entry; else the largest match (real exports have one).
  candidates.sort((a, b) =>
    (a.name.includes('/') ? 1 : 0) - (b.name.includes('/') ? 1 : 0) || b.uncompSize - a.uncompSize);
  const e = candidates[0];

  if (e.flags & 0x1) fail('encrypted_zip', 'encrypted zip entries are not supported');
  if (e.uncompSize > maxBytes) fail('file_too_large', `entry inflates past ${maxBytes} bytes`);

  // Local header: its own name/extra lengths can differ from the CD's.
  if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== LOC_SIG) {
    fail('invalid_zip', 'bad local file header');
  }
  const locNameLen = buf.readUInt16LE(e.localOffset + 26);
  const locExtraLen = buf.readUInt16LE(e.localOffset + 28);
  const dataStart = e.localOffset + 30 + locNameLen + locExtraLen;
  if (dataStart + e.compSize > buf.length) fail('invalid_zip', 'entry data out of bounds');
  const data = buf.subarray(dataStart, dataStart + e.compSize);

  if (e.method === 0) {
    if (data.length > maxBytes) fail('file_too_large', 'stored entry exceeds cap');
    return data;
  }
  if (e.method === 8) {
    try {
      // maxOutputLength is the zip-bomb guard: inflation stops AT the cap.
      return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
    } catch (err) {
      if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || /output length/i.test(err.message || ''))) {
        fail('file_too_large', 'entry inflates past the cap');
      }
      fail('invalid_zip', 'corrupt deflate stream');
    }
  }
  return fail('invalid_zip', `unsupported compression method ${e.method}`);
}

// ── 3. Format-specific extraction — USER-AUTHORED TEXT ONLY ─────────────────

// Strip ASCII control characters (except \n and \t) so hidden bytes can't
// smuggle structure into later stages; then trim + cap. Built from char codes
// so this file carries no literal control bytes (same approach as
// services/search.js stripControlChars).
function cleanText(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    const isControl = (code < 0x20 && code !== 0x0a && code !== 0x09) || code === 0x7f;
    out += isControl ? ' ' : ch;
  }
  return out.trim().slice(0, MAX_MESSAGE_CHARS);
}

// ChatGPT data export: conversations.json is an array of conversations, each
// carrying a `mapping` object of message nodes. We take author.role === 'user'
// only; system/assistant/tool nodes are skipped entirely (injection surface).
function extractChatGpt(root, out) {
  let conversations = 0;
  for (const convo of root) {
    if (conversations >= MAX_CONVERSATIONS || out.messages.length >= MAX_MESSAGES) { out.truncated = true; break; }
    if (!convo || typeof convo !== 'object' || !convo.mapping || typeof convo.mapping !== 'object') continue;
    conversations++;
    for (const node of Object.values(convo.mapping)) {
      if (out.messages.length >= MAX_MESSAGES) { out.truncated = true; break; }
      const msg = node && node.message;
      if (!msg || !msg.author || msg.author.role !== 'user') continue;
      const content = msg.content;
      if (!content) continue;
      const parts = [];
      if (Array.isArray(content.parts)) {
        for (const part of content.parts) {
          if (typeof part === 'string') parts.push(part);
          // multimodal parts that aren't plain strings (images, files) are
          // dropped — never transcribed, never described (discipline §5).
        }
      } else if (typeof content.text === 'string') {
        parts.push(content.text);
      }
      const text = cleanText(parts.join('\n'));
      if (text) out.messages.push(text);
    }
  }
  out.conversations += conversations;
}

// Claude export: conversations.json is an array of conversations, each with
// `chat_messages`. We take sender === 'human' only.
function extractClaude(root, out) {
  let conversations = 0;
  for (const convo of root) {
    if (conversations >= MAX_CONVERSATIONS || out.messages.length >= MAX_MESSAGES) { out.truncated = true; break; }
    if (!convo || typeof convo !== 'object' || !Array.isArray(convo.chat_messages)) continue;
    conversations++;
    for (const msg of convo.chat_messages) {
      if (out.messages.length >= MAX_MESSAGES) { out.truncated = true; break; }
      if (!msg || msg.sender !== 'human') continue;
      const parts = [];
      if (typeof msg.text === 'string' && msg.text) parts.push(msg.text);
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
        }
      }
      const text = cleanText(parts.join('\n'));
      if (text) out.messages.push(text);
    }
  }
  out.conversations += conversations;
}

// ── 4. Entry point: buffer → { format, messages, counts } ───────────────────
export function parseChatExport(buf, { maxJsonBytes = MAX_JSON_BYTES } = {}) {
  const kind = sniffFormat(buf);

  let jsonBuf = buf;
  if (kind === 'zip') {
    jsonBuf = extractZipEntry(buf, 'conversations.json', { maxBytes: maxJsonBytes });
    if (!jsonBuf) fail('zip_missing_conversations', 'no conversations.json inside the zip');
  }
  if (jsonBuf.length > maxJsonBytes) fail('file_too_large', 'JSON exceeds the size cap');

  let root;
  try {
    root = JSON.parse(jsonBuf.toString('utf8'));
  } catch {
    fail('invalid_json', 'conversations.json is not valid JSON');
  }
  if (!Array.isArray(root)) fail('unsupported_format', 'export root is not an array of conversations');

  // Detect on the first recognizable conversation object.
  let format = null;
  for (const c of root) {
    if (c && typeof c === 'object') {
      if (c.mapping && typeof c.mapping === 'object') { format = 'chatgpt'; break; }
      if (Array.isArray(c.chat_messages)) { format = 'claude'; break; }
    }
  }
  if (!format) fail('unsupported_format', 'neither a ChatGPT nor a Claude export shape');

  const out = { format, messages: [], conversations: 0, truncated: false };
  if (format === 'chatgpt') extractChatGpt(root, out);
  else extractClaude(root, out);

  if (!out.messages.length) fail('empty_export', 'no user-authored messages found');
  return out;
}
