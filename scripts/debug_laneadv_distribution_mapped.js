"use strict";
const fs = require("fs");
const path = require("path");
const { loadCounterData } = require("./model");

function readCsv(filePath){
  const text = fs.readFileSync(filePath,"utf8").trim();
  const lines = text.split(/\r?\n/); const header = lines.shift().split(",");
  const rows = lines.map(l=>l.split(",")); return {header,rows};
}

const ROLE_KEYS=["carry","mid","offlane","softsupport","hardsupport"];

function buildNameToIndex(heroes){ const m=new Map(); heroes.forEach((n,i)=>m.set(String(n),i)); return m; }
function coerceNumber(x,fallback=0){ const n=Number(x); return Number.isFinite(n)?n:fallback; }

function pickMostPopularRoleByD2pt(heroIndex, data){
  let bestRole="carry"; let bestVal=-Infinity;
  for (const role of ROLE_KEYS){
    const arr=data.rolesD2pt && data.rolesD2pt[role];
    const v = arr && Array.isArray(arr) ? coerceNumber(arr[heroIndex], -Infinity) : -Infinity;
    if (v>bestVal){ bestVal=v; bestRole=role; }
  }
  if (bestVal>-Infinity) return bestRole;
  // fallback to NW20
  bestVal=-Infinity;
  for (const role of ROLE_KEYS){
    const arr=data.roles && data.roles[role] && data.roles[role].nw20;
    const v=arr && Array.isArray(arr) ? coerceNumber(arr[heroIndex], -Infinity) : -Infinity;
    if (v>bestVal){ bestVal=v; bestRole=role; }
  }
  if (bestVal>-Infinity) return bestRole;
  // fallback to NW10
  bestVal=-Infinity;
  for (const role of ROLE_KEYS){
    const arr=data.roles && data.roles[role] && data.roles[role].nw10;
    const v=arr && Array.isArray(arr) ? coerceNumber(arr[heroIndex], -Infinity) : -Infinity;
    if (v>bestVal){ bestVal=v; bestRole=role; }
  }
  if (bestVal>-Infinity) return bestRole;
  // fallback to LaneAdv
  bestVal=-Infinity;
  for (const role of ROLE_KEYS){
    const arr=data.roles && data.roles[role] && data.roles[role].laneadv;
    const v=arr && Array.isArray(arr) ? coerceNumber(arr[heroIndex], -Infinity) : -Infinity;
    if (v>bestVal){ bestVal=v; bestRole=role; }
  }
  return bestRole;
}

function getLaneAdvFor(heroIndex, role, data){
  const arr=data.roles && data.roles[role] && data.roles[role].laneadv;
  const byRole = arr && Array.isArray(arr) ? Number(arr[heroIndex]) : NaN;
  if (Number.isFinite(byRole)) return byRole;
  const flat = data.heroesLaneAdv && data.heroesLaneAdv[heroIndex];
  return coerceNumber(flat,0);
}

function main(){
  const outDir=path.resolve(__dirname,"../out");
  const detailedPath=path.join(outDir,"matches_detailed.csv");
  const data=loadCounterData();
  const nameToIndex=buildNameToIndex(data.heroes);
  const {header, rows}=readCsv(detailedPath);
  const col=new Map(header.map((h,i)=>[h,i]));
  const heroRole=new Map();
  for (let i=0;i<data.heroes.length;i++) heroRole.set(i, pickMostPopularRoleByD2pt(i,data));

  const deltas=[];
  for (const r of rows){
    const dHeroes=(r[col.get("dire_heroes")]||"").split("|").filter(Boolean);
    const rHeroes=(r[col.get("radiant_heroes")]||"").split("|").filter(Boolean);
    const dIdx=dHeroes.map(h=>nameToIndex.get(h)).filter(x=>x!==undefined);
    const rIdx=rHeroes.map(h=>nameToIndex.get(h)).filter(x=>x!==undefined);
    if (dIdx.length!==5||rIdx.length!==5) continue;
    let sumR=0,sumD=0;
    for (const idx of rIdx){ sumR += getLaneAdvFor(idx, heroRole.get(idx)||"carry", data); }
    for (const idx of dIdx){ sumD += getLaneAdvFor(idx, heroRole.get(idx)||"carry", data); }
    deltas.push(sumR - sumD);
  }
  deltas.sort((a,b)=>a-b);
  const n=deltas.length; function q(p){ const i=Math.floor(p*(n-1)); return deltas[i]; }
  const stats={ count:n, min:deltas[0], p10:q(0.10), p25:q(0.25), p50:q(0.50), p75:q(0.75), p90:q(0.90), p95:q(0.95), p99:q(0.99), max:deltas[n-1], abs_ge_10:deltas.filter(x=>Math.abs(x)>=10).length, abs_ge_20:deltas.filter(x=>Math.abs(x)>=20).length };
  console.log(JSON.stringify(stats,null,2));
}

if (require.main===module) main();
