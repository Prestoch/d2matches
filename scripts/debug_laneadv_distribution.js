"use strict";
const fs = require("fs");
const path = require("path");
const { loadCounterData } = require("./model");

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map((l) => l.split(","));
  return { header, rows };
}

const ROLE_KEYS = ["carry","mid","offlane","softsupport","hardsupport"];

function buildNameToIndex(heroes) {
  const m = new Map();
  heroes.forEach((n, i) => m.set(String(n), i));
  return m;
}

function coerceNumber(x, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }

function getRoleFitnessFor(heroIndex, role, data) {
  const d2ptArr = data.rolesD2pt && data.rolesD2pt[role];
  const d2pt = (d2ptArr && Array.isArray(d2ptArr) && d2ptArr[heroIndex] != null) ? Number(d2ptArr[heroIndex]) : NaN;
  if (Number.isFinite(d2pt)) return d2pt;
  const nw20Arr = data.roles && data.roles[role] && data.roles[role].nw20;
  const nw20 = (nw20Arr && Array.isArray(nw20Arr) && nw20Arr[heroIndex] != null) ? Number(nw20Arr[heroIndex]) : NaN;
  if (Number.isFinite(nw20)) return nw20;
  const nw10Arr = data.roles && data.roles[role] && data.roles[role].nw10;
  const nw10 = (nw10Arr && Array.isArray(nw10Arr) && nw10Arr[heroIndex] != null) ? Number(nw10Arr[heroIndex]) : NaN;
  if (Number.isFinite(nw10)) return nw10;
  const laArr = data.roles && data.roles[role] && data.roles[role].laneadv;
  const la = (laArr && Array.isArray(laArr) && laArr[heroIndex] != null) ? Number(laArr[heroIndex]) : NaN;
  return Number.isFinite(la) ? la : -Infinity;
}

function bestRoleAssignment(teamHeroIndices, data) {
  const roles = ROLE_KEYS.slice();
  const heroes = teamHeroIndices.slice();
  const perms = [];
  function permute(arr, l) {
    if (l === arr.length - 1) { perms.push(arr.slice()); return; }
    for (let i = l; i < arr.length; i++) { [arr[l], arr[i]] = [arr[i], arr[l]]; permute(arr, l+1); [arr[l], arr[i]] = [arr[i], arr[l]]; }
  }
  permute(roles, 0);
  let best = null; let bestScore = -Infinity;
  for (const assignment of perms) {
    let score = 0; let valid = true;
    for (let i = 0; i < heroes.length; i++) {
      const fit = getRoleFitnessFor(heroes[i], assignment[i], data);
      if (!Number.isFinite(fit) || fit === -Infinity) { valid = false; break; }
      score += fit;
    }
    if (valid && score > bestScore) { bestScore = score; best = assignment.slice(); }
  }
  const map = new Map();
  if (best) { for (let i = 0; i < heroes.length; i++) map.set(heroes[i], best[i]); }
  else { for (const h of heroes) map.set(h, "carry"); }
  return map;
}

function getLaneAdvFor(heroIndex, role, data) {
  const arrRole = data.roles && data.roles[role] && data.roles[role].laneadv;
  const byRole = (arrRole && arrRole[heroIndex] != null) ? Number(arrRole[heroIndex]) : NaN;
  if (Number.isFinite(byRole)) return byRole;
  const flat = data.heroesLaneAdv && data.heroesLaneAdv[heroIndex];
  return coerceNumber(flat, 0);
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  const data = loadCounterData();
  const nameToIndex = buildNameToIndex(data.heroes);
  const { header, rows } = readCsv(detailedPath);
  const col = new Map(header.map((h,i)=>[h,i]));
  const deltas = [];
  for (const r of rows) {
    const dHeroes = (r[col.get("dire_heroes")]||"").split("|").filter(Boolean);
    const rHeroes = (r[col.get("radiant_heroes")]||"").split("|").filter(Boolean);
    const dIdx = dHeroes.map((h)=>nameToIndex.get(h)).filter((x)=>x!==undefined);
    const rIdx = rHeroes.map((h)=>nameToIndex.get(h)).filter((x)=>x!==undefined);
    if (dIdx.length!==5 || rIdx.length!==5) continue;
    const roleMapR = bestRoleAssignment(rIdx, data);
    const roleMapD = bestRoleAssignment(dIdx, data);
    let sumR=0, sumD=0;
    for (const idx of rIdx) sumR += getLaneAdvFor(idx, roleMapR.get(idx)||"carry", data);
    for (const idx of dIdx) sumD += getLaneAdvFor(idx, roleMapD.get(idx)||"carry", data);
    deltas.push(sumR - sumD);
  }
  deltas.sort((a,b)=>a-b);
  const n = deltas.length;
  function q(p){ const i = Math.floor(p*(n-1)); return deltas[i]; }
  const stats = {
    count: n,
    min: deltas[0],
    p10: q(0.10),
    p25: q(0.25),
    p50: q(0.50),
    p75: q(0.75),
    p90: q(0.90),
    p95: q(0.95),
    p99: q(0.99),
    max: deltas[n-1],
    abs_ge_20: deltas.filter((x)=>Math.abs(x)>=20).length,
  };
  console.log(JSON.stringify(stats, null, 2));
}

if (require.main === module) main();
