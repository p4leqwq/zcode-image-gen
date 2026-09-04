---
name: image-gen
description: Generate images with grok-imagine-image (xAI) or gpt-image-1 (OpenAI) through a local zero-dependency Node script. Use when the user asks to generate, create, draw, render, or edit an image, picture, illustration, logo, icon, poster, or photo.
---

# Image generation (grok-imagine-image / gpt-image-1)

ZCode cannot call image models natively (model output types are text-only), so this
skill generates images by running a local script that calls the provider's images
API directly and saves a PNG. `<skill-dir>` below means this skill's own folder
(the one containing this SKILL.md), so the instructions stay portable.

## How to generate

Run with a Bash timeout of at least 120000 ms (image APIs are slow):

```bash
node "<skill-dir>/scripts/generate-image.mjs" "PROMPT" --provider grok
```

Options:
- `--provider grok|openai` — grok = `grok-imagine-image` (default), openai = `gpt-image-1`
- `--model ID` — override the model id. Grok models: `grok-imagine-image`, `grok-imagine-image-quality` (better, slower). Video models (`grok-imagine-video`, `grok-imagine-video-1.5`) are NOT supported by this script. Resolution order: `--model` > `XAI_IMAGE_MODEL` / `OPENAI_IMAGE_MODEL` env > built-in default
- `--out path.png` — explicit output path (default `./generated-images/<timestamp>-<slug>.png` in the current directory)
- `--edit input.png` — img2img (edit an existing image). **OpenAI only** — xAI has no public image-edit endpoint, so grok stays txt2img-only
- `--size 1024x1024|1536x1024|1024x1536` and `--quality low|medium|high` — openai only, silently ignored for grok
- `--dry-run` — print the request that would be sent, without sending it (config debugging)

The script prints exactly one JSON object: `{"ok": true, "path": "...", "bytes": N}` on success or `{"ok": false, "error": "..."}` on failure.

## After generation

1. Show the user the image as a markdown link to the absolute `path` from the JSON.
2. If you need to verify the result yourself (composition, text rendering), Read the PNG file.
3. For multiple variants, run the script again with a rephrased prompt — do not try to pass n>1.

## Provider choice

- If the user names a provider or model ("через gpt-image", "гроком"), use it.
- Otherwise default to `grok`. If the user mentions ChatGPT/OpenAI or needs long legible text inside the image, prefer `openai`.
- "compare both" / "сравни обе" → run the script twice (one per provider) and show both paths.

## API keys (never leak)

Two ways to store keys, checked in this order: real env vars (`XAI_API_KEY`, `OPENAI_API_KEY`), then a `.env` file in `<skill-dir>` with `KEY=VALUE` lines (also accepts `XAI_BASE_URL`, `OPENAI_BASE_URL`, `XAI_IMAGE_MODEL`, `OPENAI_IMAGE_MODEL`). The `.env` file is the recommended path on Windows — no `setx` or ZCode restart needed, the script picks it up on the next run.

- The script never prints key material. Never ask the user to paste a key into chat, never echo a key value into commands or output.
- `.env` holds secrets: never print it, never commit it, never copy its contents into chat or reports — the skill's `.gitignore` already excludes it from version control.
- On `{"ok": false, "error": "missing API key ..."}` → tell the user exactly which env var or `.env` line to add. Do not retry the same call expecting a different result.
