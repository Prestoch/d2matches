#!/usr/bin/env node
"use strict";

/**
 * Merge browser-fetched Stratz data into main cache
 * 
 * Usage: node merge_stratz_browser_cache.js <browser_cache.json>
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node merge_stratz_browser_cache.js <browser_cache.json>");
  process.exit(1);
}

const browserCacheFile = args[0];
const mainCacheFile = path.join(__dirname, "../out/stratz_positions_cache.json");

console.log("Loading browser cache:", browserCacheFile);
const browserCache = JSON.parse(fs.readFileSync(browserCacheFile, "utf8"));

console.log("Loading main cache:", mainCacheFile);
let mainCache = {};
if (fs.existsSync(mainCacheFile)) {
  mainCache = JSON.parse(fs.readFileSync(mainCacheFile, "utf8"));
}

console.log("\nBefore merge:");
console.log("  Main cache:", Object.keys(mainCache).length, "matches");
console.log("  Browser cache:", Object.keys(browserCache).length, "matches");

let added = 0;
let updated = 0;

for (const matchId in browserCache) {
  if (mainCache[matchId]) {
    updated++;
  } else {
    added++;
  }
  mainCache[matchId] = browserCache[matchId];
}

console.log("\nMerge results:");
console.log("  Added:", added);
console.log("  Updated:", updated);
console.log("  Total after merge:", Object.keys(mainCache).length);

fs.writeFileSync(mainCacheFile, JSON.stringify(mainCache, null, 2));
console.log("\n✅ Saved to:", mainCacheFile);
