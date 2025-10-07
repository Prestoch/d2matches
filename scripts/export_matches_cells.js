"use strict";

const fs = require("fs");
const path = require("path");

function main() {
  const inPath = path.resolve(__dirname, "../out/matches.csv");
  const outPath = path.resolve(__dirname, "../out/matches_cells.md");

  if (!fs.existsSync(inPath)) {
    console.error("matches.csv not found. Run the parser first.");
    process.exit(1);
  }

  const lines = fs.readFileSync(inPath, "utf8").trim().split(/\r?\n/);
  if (lines.length === 0) {
    fs.writeFileSync(outPath, "", "utf8");
    console.log(`Wrote ${outPath}`);
    return;
  }

  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));

  // Build Markdown table with header separator
  const md = [];
  md.push(`| ${header.join(" | ")} |`);
  md.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    md.push(`| ${r.join(" | ")} |`);
  }

  fs.writeFileSync(outPath, md.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}

