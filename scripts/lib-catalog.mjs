// The full catalogue for scripts: public/catalog.json plus the datamined clothing, weapons and rings that build-catalog.mjs keeps in
// public/catalog-datamine.json (the app loads that file only in a VITE_DATAMINE=1 build). Lists are merged in id order, as built.
import { readFileSync, existsSync } from 'node:fs';
export function readCatalog() {
  const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8'));
  if (existsSync('public/catalog-datamine.json')) mergeDatamine(catalog, JSON.parse(readFileSync('public/catalog-datamine.json', 'utf8')));
  return catalog;
}
export function mergeDatamine(catalog, extra) {
  for (const [slot, items] of Object.entries(extra.wearables)) {
    const g = (catalog.wearables[slot] ??= { label: slot, items: [] });
    g.items = [...g.items, ...items].sort((a, b) => a.id - b.id);
  }
  return catalog;
}
