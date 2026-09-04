#!/usr/bin/env node
// Zero-dependency image generation for ZCode (Node 18+).
// txt2img: POST {base}/images/generations (JSON)
// img2img: POST {base}/images/edits (multipart) — OpenAI gpt-image-1 only;
//          xAI has no public image-edit endpoint, so grok is txt2img-only.
// Keys: real env vars first, then ~/.zcode/skills/image-gen/.env (KEY=VALUE lines).

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const SKILL_DIR = path.join(os.homedir(), '.zcode', 'skills', 'image-gen');

async function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const text = await readFile(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
await loadDotEnv(path.join(SKILL_DIR, '.env'));

const PROVIDERS = {
  grok: {
    model: 'grok-imagine-image',
    modelEnv: 'XAI_IMAGE_MODEL',
    keyEnv: 'XAI_API_KEY',
    baseEnv: 'XAI_BASE_URL',
    defaultBase: 'https://api.x.ai/v1',
    sizeQuality: false,
    edits: false,
  },
  openai: {
    model: 'gpt-image-1',
    modelEnv: 'OPENAI_IMAGE_MODEL',
    keyEnv: 'OPENAI_API_KEY',
    baseEnv: 'OPENAI_BASE_URL',
    defaultBase: 'https://api.openai.com/v1',
    sizeQuality: true,
    edits: true,
  },
};

function usage() {
  console.log(`Usage:
  node generate-image.mjs "PROMPT" [--provider grok|openai] [--model ID] [--out file.png]
                       [--edit input.png] [--size 1024x1024|1536x1024|1024x1536]
                       [--quality low|medium|high] [--base URL] [--key KEY] [--dry-run]

Providers:
  grok    grok-imagine-image via XAI_API_KEY    (txt2img only; --size/--quality ignored)
  openai  gpt-image-1         via OPENAI_API_KEY  (txt2img + img2img via --edit)

Model selection (highest priority first):
  --model ID  >  XAI_IMAGE_MODEL / OPENAI_IMAGE_MODEL  >  built-in default

Keys: env vars (XAI_API_KEY / OPENAI_API_KEY) or .env file in the skill dir.
Output: prints {"ok": true, "path": "..."} or {"ok": false, "error": "..."} as JSON.`);
}

function parseArgs(argv) {
  const args = { provider: process.env.IMAGE_GEN_PROVIDER || 'grok' };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--provider') args.provider = val();
    else if (a === '--model') args.model = val();
    else if (a === '--out') args.out = val();
    else if (a === '--edit') args.edit = val();
    else if (a === '--size') args.size = val();
    else if (a === '--quality') args.quality = val();
    else if (a === '--base') args.base = val();
    else if (a === '--key') args.key = val();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option: ${a}`);
    else words.push(a);
  }
  args.prompt = words.join(' ').trim();
  return args;
}

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');

function defaultOutPath(prompt) {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-')
      .slice(0, 60) || 'image';
  const d = new Date();
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return path.join('generated-images', `${ts}-${slug}.png`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage();
  process.exit(0);
}
if (!PROVIDERS[args.provider]) fail(`unknown provider "${args.provider}" (expected grok or openai)`);
const p = PROVIDERS[args.provider];

if (args.edit && !p.edits) {
  fail(`provider "${args.provider}" has no public image-edit (img2img) endpoint — use --provider openai for img2img`);
}
if (!args.dryRun && !args.prompt) fail('prompt is required (pass it as the first quoted argument)');

const base = (args.base || process.env[p.baseEnv] || p.defaultBase).replace(/\/+$/, '');
const model = args.model || process.env[p.modelEnv] || process.env.IMAGE_GEN_MODEL || p.model;
const endpoint = args.edit ? `${base}/images/edits` : `${base}/images/generations`;

if (args.dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, url: endpoint, model, edit: args.edit || null }, null, 2));
  process.exit(0);
}

const key = args.key || process.env[p.keyEnv];
if (!key) fail(`missing API key: set ${p.keyEnv} or put "${p.keyEnv}=..." in ${path.join(SKILL_DIR, '.env')}`);

try {
  let res;
  if (args.edit) {
    const imageBytes = await readFile(args.edit);
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', args.prompt);
    form.append('image', new Blob([imageBytes], { type: 'image/png' }), path.basename(args.edit));
    if (p.sizeQuality) {
      if (args.size) form.append('size', args.size);
      if (args.quality) form.append('quality', args.quality);
    }
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(180000),
    });
  } else {
    const body = { model, prompt: args.prompt, n: 1 };
    if (p.sizeQuality) {
      if (args.size) body.size = args.size;
      if (args.quality) body.quality = args.quality;
    } else if (args.size || args.quality) {
      console.error(`note: provider "${args.provider}" ignores --size/--quality`);
    }
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || JSON.stringify(errJson).slice(0, 500);
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 500);
    }
    fail(`HTTP ${res.status} ${res.statusText}: ${detail}`);
  }
  const json = await res.json();
  const item = json?.data?.[0];
  if (!item) fail(`unexpected response shape: ${JSON.stringify(json).slice(0, 300)}`);

  let bytes;
  if (item.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(120000) });
    if (!img.ok) fail(`failed to download generated image: HTTP ${img.status}`);
    bytes = Buffer.from(await img.arrayBuffer());
  } else {
    fail('response contains neither b64_json nor url');
  }

  const out = path.resolve(args.out || defaultOutPath(args.prompt));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, bytes);
  const result = { ok: true, provider: args.provider, model, path: out, bytes: bytes.length };
  if (item.revised_prompt) result.revised_prompt = item.revised_prompt;
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  fail(err?.name === 'TimeoutError' ? 'request timed out after 180s' : err?.message || String(err));
}
