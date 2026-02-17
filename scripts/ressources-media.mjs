#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INCLUDE = "content/ressources";
const DEFAULT_OUTPUT_DIR = "static/ressources-media";
const USER_AGENT =
  "Mozilla/5.0 (compatible; feroces-dolls-bot/1.0; +https://ferocesdolls.org)";

function parseArgs(argv) {
  const args = {
    include: DEFAULT_INCLUDE,
    outDir: DEFAULT_OUTPUT_DIR,
    write: false,
    force: false,
    timeoutMs: 10000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--include" && argv[i + 1]) {
      args.include = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out-dir" && argv[i + 1]) {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--timeout" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.timeoutMs = parsed;
      }
      i += 1;
    }
  }

  return args;
}

function stripBom(raw) {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function cleanUrlValue(value) {
  return String(value || "")
    .replace(/&#0*38;|&amp;/gi, "&")
    .replace(/&#x26;/gi, "&")
    .trim();
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "resource";
}

function extFromContentType(contentType) {
  const clean = String(contentType || "").split(";")[0].trim().toLowerCase();
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "image/gif": ".gif",
    "image/avif": ".avif",
  };
  return map[clean] || "";
}

function extFromUrl(value) {
  try {
    const parsed = new URL(value);
    const ext = path.extname(parsed.pathname || "").toLowerCase();
    if (ext.length >= 2 && ext.length <= 6) return ext;
  } catch {}
  return "";
}

function pickExt(urlValue, contentType) {
  return extFromContentType(contentType) || extFromUrl(urlValue) || ".img";
}

async function listMarkdownFiles(rootDir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(fullPath);
    }
  }
  return out;
}

function splitFrontmatter(raw) {
  const text = stripBom(raw);
  if (!text.startsWith("+++")) return null;
  const end = text.indexOf("\n+++", 3);
  if (end === -1) return null;

  const fmStart = 4;
  const fmEnd = end;
  const bodyStart = end + 5;

  return {
    frontmatter: text.slice(fmStart, fmEnd),
    body: text.slice(bodyStart),
  };
}

function parseTomlString(frontmatter, key) {
  const re = new RegExp(`^${key}\\s*=\\s*(['"])((?:[^\\\\]|\\\\.)*)\\1\\s*$`, "m");
  const m = frontmatter.match(re);
  if (!m) return null;

  return m[2]
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function escapeTomlSingleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function setTomlString(frontmatter, key, value, { force = false } = {}) {
  const re = new RegExp(`^${key}\\s*=\\s*(['"])(?:[^\\\\]|\\\\.)*\\1\\s*$`, "m");
  if (re.test(frontmatter)) {
    if (!force) return frontmatter;
    return frontmatter.replace(re, `${key} = '${escapeTomlSingleQuoted(value)}'`);
  }

  const draftRe = /^draft\s*=\s*(?:true|false)\s*$/m;
  const line = `${key} = '${escapeTomlSingleQuoted(value)}'`;
  if (draftRe.test(frontmatter)) {
    return frontmatter.replace(draftRe, `${line}\n$&`);
  }

  const suffix = frontmatter.endsWith("\n") ? "" : "\n";
  return `${frontmatter}${suffix}${line}\n`;
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    const key = m[1].toLowerCase();
    const value = (m[3] ?? m[4] ?? m[5] ?? "").trim();
    attrs[key] = value;
  }
  return attrs;
}

function firstMetaContent(html, keys) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = new Set(keys.map((k) => k.toLowerCase()));

  for (const tag of metaTags) {
    const attrs = parseAttrs(tag);
    const id = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (!wanted.has(id)) continue;
    if (attrs.content) return attrs.content;
  }
  return "";
}

function parseSizeScore(sizeValue) {
  if (!sizeValue) return 0;
  if (sizeValue.toLowerCase() === "any") return 512;
  const m = sizeValue.match(/(\d+)\s*x\s*(\d+)/);
  if (!m) return 0;
  return Math.max(Number(m[1]) || 0, Number(m[2]) || 0);
}

function pickBestIcon(html, baseUrl) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  const candidates = [];

  for (const tag of linkTags) {
    const attrs = parseAttrs(tag);
    const rel = (attrs.rel || "").toLowerCase();
    if (!rel.includes("icon")) continue;
    if (!attrs.href) continue;

    let href = "";
    try {
      href = new URL(cleanUrlValue(attrs.href), baseUrl).toString();
    } catch {
      continue;
    }

    const sizeScore = parseSizeScore(attrs.sizes || "");
    let relScore = 0;
    if (rel.includes("apple-touch-icon")) relScore += 30;
    if (rel.includes("shortcut")) relScore += 8;
    if (rel === "icon") relScore += 12;
    const ext = extFromUrl(href);
    if (ext === ".svg") relScore += 5;
    if (ext === ".png") relScore += 3;

    candidates.push({
      href,
      score: relScore + sizeScore / 16,
    });
  }

  if (candidates.length === 0) {
    try {
      return new URL("/favicon.ico", baseUrl).toString();
    } catch {
      return "";
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].href;
}

async function fetchHtml(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    return { html, finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinary(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get("content-type") || "",
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLinkMedia(url, timeoutMs) {
  try {
    const { html, finalUrl } = await fetchHtml(url, timeoutMs);
    const cardCandidate = firstMetaContent(html, [
      "og:image",
      "twitter:image",
      "twitter:image:src",
      "image",
    ]);
    const card = cardCandidate ? new URL(cleanUrlValue(cardCandidate), finalUrl).toString() : "";
    const icon = pickBestIcon(html, finalUrl);
    return { ok: true, icon, card, finalUrl };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function buildSourceUrls(frontmatter) {
  const urls = [];
  const one = parseTomlString(frontmatter, "external_url");
  const two = parseTomlString(frontmatter, "external_url_2");
  if (one) urls.push(one);
  if (two) urls.push(two);
  return urls;
}

function buildPlannedPaths(file, mediaType, mediaUrl, args) {
  const slug = safeSlug(path.basename(file, ".md"));
  const ext = pickExt(mediaUrl, "");
  const absFile = path.resolve(args.outDir, slug, `${mediaType}${ext}`);
  const staticRoot = path.resolve("static");
  const relFromStatic = toPosix(path.relative(staticRoot, absFile));
  const webPath = relFromStatic.startsWith("..")
    ? toPosix(path.join("ressources-media", slug, `${mediaType}${ext}`))
    : relFromStatic;
  return { slug, absFile, webPath };
}

async function downloadToLocal(file, mediaType, mediaUrl, args) {
  const cleanUrl = cleanUrlValue(mediaUrl);
  const planned = buildPlannedPaths(file, mediaType, cleanUrl, args);
  const downloaded = await fetchBinary(cleanUrl, args.timeoutMs);
  const ext = pickExt(downloaded.finalUrl || cleanUrl, downloaded.contentType);
  const absFile = path.resolve(args.outDir, planned.slug, `${mediaType}${ext}`);
  const staticRoot = path.resolve("static");
  const relFromStatic = toPosix(path.relative(staticRoot, absFile));
  const webPath = relFromStatic.startsWith("..")
    ? toPosix(path.join("ressources-media", planned.slug, `${mediaType}${ext}`))
    : relFromStatic;

  await fs.mkdir(path.dirname(absFile), { recursive: true });
  await fs.writeFile(absFile, downloaded.buffer);
  return { absFile, webPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = (await listMarkdownFiles(args.include))
    .filter((file) => path.basename(file).toLowerCase() !== "_index.md")
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log("Aucun fichier ressource trouve.");
    return;
  }

  let updatedCount = 0;
  let scannedCount = 0;
  let downloadedCount = 0;

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parts = splitFrontmatter(raw);
    if (!parts) continue;

    const urls = buildSourceUrls(parts.frontmatter);
    if (urls.length === 0) continue;
    scannedCount += 1;

    let picked = null;
    for (const url of urls) {
      const result = await fetchLinkMedia(url, args.timeoutMs);
      if (!result.ok) continue;
      if (result.icon || result.card) {
        picked = result;
        break;
      }
    }

    if (!picked) {
      console.log(`[skip] ${toPosix(file)} -> pas de media detecte`);
      continue;
    }

    let iconPath = "";
    let cardPath = "";
    if (picked.icon) {
      if (args.write) {
        try {
          const saved = await downloadToLocal(file, "icon", picked.icon, args);
          iconPath = saved.webPath;
          downloadedCount += 1;
        } catch (error) {
          console.log(`[warn] ${toPosix(file)} -> echec telechargement icon: ${String(error?.message || error)}`);
        }
      } else {
        iconPath = buildPlannedPaths(file, "icon", picked.icon, args).webPath;
      }
    }
    if (picked.card) {
      if (args.write) {
        try {
          const saved = await downloadToLocal(file, "card", picked.card, args);
          cardPath = saved.webPath;
          downloadedCount += 1;
        } catch (error) {
          console.log(`[warn] ${toPosix(file)} -> echec telechargement card: ${String(error?.message || error)}`);
        }
      } else {
        cardPath = buildPlannedPaths(file, "card", picked.card, args).webPath;
      }
    }

    let nextFm = parts.frontmatter;
    if (iconPath) {
      nextFm = setTomlString(nextFm, "external_icon", iconPath, { force: args.force });
    }
    if (cardPath) {
      nextFm = setTomlString(nextFm, "external_card", cardPath, { force: args.force });
    }

    const changed = nextFm !== parts.frontmatter;
    const relFile = toPosix(file);
    console.log(
      `[${changed ? "update" : "keep"}] ${relFile}\n  icon: ${picked.icon || "-"}\n  -> ${iconPath || "-"}\n  card: ${picked.card || "-"}\n  -> ${cardPath || "-"}`,
    );

    if (args.write && changed) {
      const out = `+++\n${nextFm}\n+++\n${parts.body.replace(/^\n?/, "\n")}`;
      await fs.writeFile(file, out, "utf8");
      updatedCount += 1;
    }
  }

  console.log(
    `\nScan termine: ${scannedCount} fichier(s) analyse(s), ${downloadedCount} media telecharge(s), ${args.write ? `${updatedCount} fichier(s) mis a jour.` : "aucune ecriture (dry-run)."}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
