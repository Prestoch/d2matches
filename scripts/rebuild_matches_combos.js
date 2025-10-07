"use strict";

const fs = require("fs");
const path = require("path");
const { loadCounterData, computeHeroAdvantageAgainstTeam } = require("./model");

function readCsv(fp){
  const text = fs.readFileSync(fp, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map(l=>l.split(","));
  return { header, rows };
}

function buildNameToIndex(heroes){
  const m = new Map();
  heroes.forEach((n,i)=>m.set(String(n), i));
  return m;
}

function toIdxList(namesStr, nameToIndex){
  const names = (namesStr||"").split("|").map(s=>s.trim()).filter(Boolean);
  const ids = names.map(n=>nameToIndex.get(n)).filter(x=>x!==undefined);
  return ids;
}

function main(){
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(detailedPath)){
    console.error("matches_detailed.csv not found");
    process.exit(1);
  }

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const nameToIndex = buildNameToIndex(data.heroes);
  const { header, rows } = readCsv(detailedPath);
  const col = new Map(header.map((h,i)=>[h,i]));

  const outLines = ["match_id,r_pos,r_neg,d_pos,d_neg,radiant_win"]; 
  for (const r of rows){
    const matchId = r[col.get("match_id")];
    const dHeroes = r[col.get("dire_heroes")] || "";
    const rHeroes = r[col.get("radiant_heroes")] || "";
    const dIdx = toIdxList(dHeroes, nameToIndex);
    const rIdx = toIdxList(rHeroes, nameToIndex);
    if (dIdx.length!==5 || rIdx.length!==5) continue;

    const rAdv = rIdx.map(idx => computeHeroAdvantageAgainstTeam(idx, dIdx, data));
    const dAdv = dIdx.map(idx => computeHeroAdvantageAgainstTeam(idx, rIdx, data));
    const rPos = rAdv.filter(x=>x>0).length;
    const dPos = dAdv.filter(x=>x>0).length;
    const rNeg = 5 - rPos;
    const dNeg = 5 - dPos;
    const radiantWin = Number(r[col.get("radiant_win")]) === 1 ? 1 : 0;
    outLines.push([matchId, rPos, rNeg, dPos, dNeg, radiantWin].join(","));
  }

  fs.writeFileSync(path.join(outDir, "matches_combos.csv"), outLines.join("\n")+"\n", "utf8");
  console.log("Wrote matches_combos.csv");
}

if (require.main===module){
  main();
}

