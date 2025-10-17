#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const catalogPath = process.argv[2] || path.join('assets', 'catalogs', 'music_catalog_all.json');
const outputPath = process.argv[3] || path.join('assets', 'catalogs', 'variant_groups.json');

function normalize(str = '') {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(str = '') {
  return normalize(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'group';
}

function extractBaseTitle(title = '') {
  const trimmed = title.trim();
  if (!trimmed) return '';
  // Remove trailing parenthetical descriptors (e.g., "Song (Instrumental)")
  const withoutParentheses = trimmed.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  // Remove trailing dashes or descriptors like " - Live"
  const base = withoutParentheses.replace(/\s*[-–—:]\s*([^\s].*)$/, (_, suffix) => {
    return suffix && suffix.toLowerCase().includes('version') ? withoutParentheses : trimmed;
  });
  return base || trimmed;
}

function extractVariantLabel(title = '', baseTitle = '') {
  const parenthetical = title.match(/\(([^)]+)\)\s*$/);
  if (parenthetical) {
    return parenthetical[1].trim();
  }
  if (baseTitle && title.startsWith(baseTitle)) {
    const suffix = title.slice(baseTitle.length).trim();
    if (suffix) {
      return suffix.replace(/^[-–—:\u2013\u2014\u2015]+/, '').trim();
    }
  }
  return 'Original';
}

async function main() {
  try {
    const catalogRaw = await fs.readFile(catalogPath, 'utf8');
    const catalog = JSON.parse(catalogRaw);
    if (!Array.isArray(catalog)) {
      throw new Error('Catalog must be an array of tracks.');
    }

    const groupsByBase = new Map();
    for (const track of catalog) {
      const englishTitle = track?.titles?.en;
      if (!englishTitle || typeof englishTitle !== 'string') continue;
      const baseTitle = extractBaseTitle(englishTitle);
      if (!baseTitle) continue;
      const normalizedKey = normalize(baseTitle).toLowerCase();
      if (!normalizedKey) continue;
      const entry = {
        id: track.id,
        title: englishTitle.trim(),
        baseTitle,
        variantLabel: extractVariantLabel(englishTitle, baseTitle)
      };
      if (!groupsByBase.has(normalizedKey)) {
        groupsByBase.set(normalizedKey, []);
      }
      groupsByBase.get(normalizedKey).push(entry);
    }

    const variantGroups = [];
    const usedGroupIds = new Set();

    for (const [key, tracks] of groupsByBase.entries()) {
      if (!Array.isArray(tracks) || tracks.length < 2) continue;
      const baseTitle = tracks[0].baseTitle;
      let groupIdBase = slugify(baseTitle);
      let groupId = groupIdBase;
      let counter = 1;
      while (usedGroupIds.has(groupId)) {
        groupId = `${groupIdBase}_${++counter}`;
      }
      usedGroupIds.add(groupId);

      const variants = tracks.map(({ id, variantLabel, title }) => ({
        id,
        variantLabel: variantLabel || 'Original',
        title
      }));

      const defaultVariant = variants.find(v => /original/i.test(v.variantLabel)) || variants[0];

      variantGroups.push({
        groupId,
        title: baseTitle.trim(),
        defaultVariantId: defaultVariant?.id,
        variants: variants.map(({ id, variantLabel }) => ({ id, variantLabel }))
      });
    }

    variantGroups.sort((a, b) => a.title.localeCompare(b.title));

    const json = JSON.stringify(variantGroups, null, 2);
    await fs.writeFile(outputPath, `${json}\n`, 'utf8');
    console.log(`Generated ${variantGroups.length} variant groups at ${outputPath}`);
  } catch (err) {
    console.error('Failed to generate variant groups:', err.message);
    process.exitCode = 1;
  }
}

main();
