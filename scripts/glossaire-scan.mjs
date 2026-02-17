#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INCLUDE = ["content"];
const DEFAULT_EXCLUDE = ["content/glossaire"];

function parseArgs(argv) {
  const include = [];
  const exclude = [];
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--include" && argv[i + 1]) {
      include.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--exclude" && argv[i + 1]) {
      exclude.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
  }

  return {
    include: include.length > 0 ? include : DEFAULT_INCLUDE,
    exclude: exclude.length > 0 ? exclude : DEFAULT_EXCLUDE,
    json,
  };
}

function stripBom(raw) {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapeTomlString(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function getFrontmatter(raw) {
  raw = stripBom(raw);
  if (!raw.startsWith("+++")) return null;
  const end = raw.indexOf("\n+++", 3);
  if (end === -1) return null;
  return raw.slice(4, end);
}

function parseQuotedList(rawList) {
  const items = [];
  const regex = /"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = regex.exec(rawList)) !== null) {
    items.push(unescapeTomlString(match[1]));
  }
  return items;
}

function parseGlossaryEntry(raw) {
  const fm = getFrontmatter(raw);
  if (!fm) return null;

  const titleMatch = fm.match(/^title\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  if (!titleMatch) return null;
  const title = unescapeTomlString(titleMatch[1]).trim();

  const synonymsMatch = fm.match(/^synonyms\s*=\s*\[(.*)\]\s*$/m);
  const synonyms = synonymsMatch ? parseQuotedList(synonymsMatch[1]) : [];

  return { title, synonyms };
}

async function listMarkdownFiles(rootDir) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function isUnderAnyPath(filePath, roots) {
  const normalized = toPosix(path.normalize(filePath));
  return roots.some((root) => {
    const rootNorm = toPosix(path.normalize(root));
    return normalized === rootNorm || normalized.startsWith(`${rootNorm}/`);
  });
}

function findFrontmatterRange(raw) {
  raw = stripBom(raw);
  if (!raw.startsWith("+++")) return null;
  const end = raw.indexOf("\n+++", 3);
  if (end === -1) return null;
  return [0, end + 4];
}

function maskRanges(raw, ranges) {
  const chars = [...raw];
  for (const [start, end] of ranges) {
    for (let i = start; i < end && i < chars.length; i += 1) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    }
  }
  return chars.join("");
}

function collectIgnoreRanges(raw) {
  const ranges = [];

  const fmRange = findFrontmatterRange(raw);
  if (fmRange) ranges.push(fmRange);

  const patterns = [
    /```[\s\S]*?```/g,
    /`[^`\n]+`/g,
    /\{\{[<%][\s\S]*?[>%]\}\}/g,
    /https?:\/\/[^\s)]+/g,
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(raw)) !== null) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  return ranges;
}

function lineColAt(raw, index) {
  const before = raw.slice(0, index);
  const lines = before.split(/\r?\n/);
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

function contextAt(raw, index, length) {
  const left = Math.max(0, index - 42);
  const right = Math.min(raw.length, index + length + 42);
  const around = raw.slice(left, right).replace(/\r?\n/g, " ");
  const needle = raw.slice(index, index + length);
  return around.replace(needle, `[[${needle}]]`);
}

function buildTermRegex(term) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "iu");
}

async function loadGlossaryTerms() {
  const glossaryDir = "content/glossaire";
  const files = await listMarkdownFiles(glossaryDir);
  const terms = [];

  for (const file of files) {
    if (path.basename(file) === "_index.md") continue;
    const raw = stripBom(await fs.readFile(file, "utf8"));
    const parsed = parseGlossaryEntry(raw);
    if (!parsed) continue;

    const slug = path.basename(file, ".md");
    const variants = Array.from(
      new Set([parsed.title, ...(parsed.synonyms || [])].map((v) => v.trim()).filter(Boolean)),
    );

    terms.push({ slug, variants });
  }

  return terms;
}

async function main() {
  const { include, exclude, json } = parseArgs(process.argv.slice(2));
  const terms = await loadGlossaryTerms();

  const allFiles = [];
  for (const root of include) {
    allFiles.push(...(await listMarkdownFiles(root)));
  }

  const files = allFiles
    .filter((f) => !isUnderAnyPath(f, exclude))
    .filter((f) => !toPosix(f).startsWith("content/glossaire/"));

  const results = [];

  for (const file of files) {
    const raw = stripBom(await fs.readFile(file, "utf8"));
    const masked = maskRanges(raw, collectIgnoreRanges(raw));
    const fileHits = [];

    for (const term of terms) {
      let firstMatch = null;
      let matchedVariant = null;

      for (const variant of term.variants) {
        const re = buildTermRegex(variant);
        const m = re.exec(masked);
        if (!m) continue;
        if (!firstMatch || m.index < firstMatch.index) {
          firstMatch = m;
          matchedVariant = variant;
        }
      }

      if (!firstMatch) continue;

      const { line, col } = lineColAt(raw, firstMatch.index);
      fileHits.push({
        slug: term.slug,
        match: matchedVariant,
        line,
        col,
        context: contextAt(raw, firstMatch.index, matchedVariant.length),
        suggestion: `{{< terme "${term.slug}" "${matchedVariant}" >}}`,
      });
    }

    if (fileHits.length > 0) {
      fileHits.sort((a, b) => a.line - b.line || a.col - b.col);
      results.push({
        file: toPosix(file),
        hits: fileHits,
      });
    }
  }

  if (json) {
    console.log(JSON.stringify({ files: results.length, results }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log("Aucune occurrence trouvee.");
    return;
  }

  let total = 0;
  for (const block of results) {
    console.log(`\n${block.file}`);
    for (const hit of block.hits) {
      total += 1;
      console.log(`  L${hit.line}:C${hit.col}  ${hit.slug}  \"${hit.match}\"`);
      console.log(`    ${hit.context}`);
      console.log(`    -> ${hit.suggestion}`);
    }
  }

  console.log(`\n${results.length} fichier(s), ${total} occurrence(s) de premiere mention.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
