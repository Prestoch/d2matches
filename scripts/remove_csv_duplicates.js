#!/usr/bin/env node
"use strict";

/**
 * Remove duplicate matches from CSV
 * Keeps first occurrence of each match ID
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || path.join(__dirname, '../out/matches_detailed.csv');
const outputFile = process.argv[3] || inputFile.replace('.csv', '_unique.csv');

console.log('📥 Reading CSV:', inputFile);

const csvContent = fs.readFileSync(inputFile, 'utf8');
const lines = csvContent.split('\n');

const header = lines[0];
const dataLines = lines.slice(1).filter(line => line.trim());

console.log('📊 Original rows:', dataLines.length);

// Track seen match IDs
const seen = new Set();
const uniqueLines = [];

for (const line of dataLines) {
  const matchId = line.split(',')[0];
  
  if (!seen.has(matchId)) {
    seen.add(matchId);
    uniqueLines.push(line);
  }
}

console.log('✅ Unique rows:', uniqueLines.length);
console.log('❌ Duplicates removed:', dataLines.length - uniqueLines.length);

// Write cleaned CSV
const cleaned = [header, ...uniqueLines].join('\n');
fs.writeFileSync(outputFile, cleaned);

console.log('💾 Saved to:', outputFile);
