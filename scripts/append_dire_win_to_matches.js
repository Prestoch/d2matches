"use strict";

const fs = require("fs");
const path = require("path");

function main() {
  const p = path.resolve(__dirname, "../out/matches.csv");
  if (!fs.existsSync(p)) {
    console.error("matches.csv not found");
    process.exit(1);
  }
  const lines = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  if (!lines.length) return;
  const header = lines[0];
  if (header.includes(",dire_win")) {
    console.log("matches.csv already has dire_win");
    return;
  }
  const out = [header + ",dire_win"]; 
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    // header: match_id,delta,max_hero_adv,radiant_win
    const radiantWin = Number(cols[3]) === 1;
    const direWin = radiantWin ? 0 : 1;
    out.push(lines[i] + "," + direWin);
  }
  fs.writeFileSync(p, out.join("\n") + "\n", "utf8");
  console.log("Updated matches.csv with dire_win");
}

if (require.main === module) {
  main();
}

