"use strict";

const fs = require("fs");
const path = require("path");

function chunkMarkdownTable(srcPath, rowsPerFile = 500) {
  if (!fs.existsSync(srcPath)) return [];
  const lines = fs.readFileSync(srcPath, "utf8").trim().split(/\r?\n/);
  if (lines.length < 3) return [];
  const header = lines[0];
  const separator = lines[1];
  const rows = lines.slice(2);

  const chunks = [];
  for (let i = 0; i < rows.length; i += rowsPerFile) {
    const slice = rows.slice(i, i + rowsPerFile);
    chunks.push([header, separator, ...slice].join("\n") + "\n");
  }
  return chunks;
}

function writeChunks(srcPath, chunks, outPrefix) {
  const dir = path.dirname(srcPath);
  const written = [];
  for (let i = 0; i < chunks.length; i++) {
    const idx = String(i + 1).padStart(3, "0");
    const outPath = path.join(dir, `${outPrefix}_p${idx}.md`);
    fs.writeFileSync(outPath, chunks[i], "utf8");
    written.push(outPath);
  }
  return written;
}

function chunkJsonArray(srcPath, itemsPerFile = 2000) {
  if (!fs.existsSync(srcPath)) return [];
  const text = fs.readFileSync(srcPath, "utf8");
  let arr;
  try { arr = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const chunks = [];
  for (let i = 0; i < arr.length; i += itemsPerFile) {
    chunks.push(JSON.stringify(arr.slice(i, i + itemsPerFile)));
  }
  return chunks;
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const targets = [
    { src: path.join(outDir, "matches_cells.md"), prefix: "matches_cells" },
    { src: path.join(outDir, "matches_detailed_cells.md"), prefix: "matches_detailed_cells" },
    { src: path.join(outDir, "matches_detailed_cells_with_adv.md"), prefix: "matches_detailed_cells_with_adv" },
  ];

  for (const t of targets) {
    const chunks = chunkMarkdownTable(t.src, Number(process.env.ROWS_PER_FILE || 500));
    if (chunks.length) {
      writeChunks(t.src, chunks, t.prefix);
      console.log(`Chunked ${t.src} into ${chunks.length} files`);
    }
  }

  const viewJson = path.join(outDir, "matches_view.json");
  const jsonChunks = chunkJsonArray(viewJson, Number(process.env.JSON_ITEMS_PER_FILE || 2000));
  if (jsonChunks.length) {
    for (let i = 0; i < jsonChunks.length; i++) {
      const idx = String(i + 1).padStart(3, "0");
      fs.writeFileSync(path.join(outDir, `matches_view_p${idx}.json`), jsonChunks[i], "utf8");
    }
    console.log(`Chunked ${viewJson} into ${jsonChunks.length} files`);
  }
}

if (require.main === module) {
  main();
}

