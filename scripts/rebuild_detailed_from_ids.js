"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");
const { loadCounterData, computeTeamScore, normalizeHeroName } = require("./model");

const OPEN_DOTA_BASE = process.env.OPEN_DOTA_BASE || "https://api.opendota.com/api";
const OPEN_DOTA_API_KEY = process.env.OPEN_DOTA_API_KEY || process.env.OPENDOTA_API_KEY || "";
const MAX_RPM = Number(process.env.MAX_RPM || 900);
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 24);
const DETAIL_SLEEP_MS = Number(process.env.DETAIL_SLEEP_MS || 60);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1000);
const RETRIES = Number(process.env.RETRIES || 4);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

let tokens = MAX_RPM;
let lastRefill = Date.now();
function refill(){
  const now = Date.now();
  const add = ((now - lastRefill) / 60000) * MAX_RPM;
  if (add > 0){ tokens = Math.min(MAX_RPM, tokens + add); lastRefill = now; }
}
async function takeToken(){
  if (!Number.isFinite(MAX_RPM) || MAX_RPM <= 0) return;
  while(true){
    refill();
    if (tokens >= 1){ tokens -= 1; return; }
    await sleep(Math.max(25, Math.ceil(60000 / MAX_RPM)));
  }
}

function appendApiKey(u){
  if (!OPEN_DOTA_API_KEY) return u;
  try { const url = new URL(u); if (!url.searchParams.has("api_key")) url.searchParams.set("api_key", OPEN_DOTA_API_KEY); return url.toString(); }
  catch { return u + (u.includes("?") ? "&" : "?") + `api_key=${encodeURIComponent(OPEN_DOTA_API_KEY)}`; }
}

function httpGetJsonRaw(u){
  return new Promise((resolve,reject)=>{
    const url = new URL(u);
    const req = https.request(url, { method:"GET", headers:{ "User-Agent":"rebuild-detailed/1.0", Accept:"application/json" } }, (res)=>{
      let data=""; res.on("data", c=>data+=c);
      res.on("end", ()=>{
        if (res.statusCode>=200 && res.statusCode<300){ try { resolve(JSON.parse(data)); } catch(e){ reject(e); } }
        else if (res.statusCode===429){ resolve({ __rate_limited:true }); }
        else { reject(new Error(`HTTP ${res.statusCode}`)); }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, ()=>{ req.destroy(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}

async function getJson(u){
  for (let i=0;i<=RETRIES;i++){
    try { await takeToken(); const r = await httpGetJsonRaw(appendApiKey(u)); if (r && r.__rate_limited){ await sleep(500*Math.pow(2,i)); continue; } return r; }
    catch(e){ if (i===RETRIES) throw e; await sleep(500*Math.pow(2,i)); }
  }
}

function readIds(csv){
  const lines = fs.readFileSync(csv, "utf8").trim().split(/\r?\n/);
  lines.shift();
  return lines.map(l=>String(l.split(",")[0]).trim()).filter(Boolean);
}

function readExistingDetailed(csv){
  const set = new Set();
  if (!fs.existsSync(csv)) return set;
  const lines = fs.readFileSync(csv, "utf8").trim().split(/\r?\n/);
  if (!lines.length) return set;
  lines.shift();
  for (const l of lines){ const id = String(l.split(",")[0]).trim(); if (id) set.add(id); }
  return set;
}

function extractTeams(detail, idToIndex){
  if (Array.isArray(detail.players)){
    const r=[], d=[];
    for (const p of detail.players){
      const hid = Number(p.hero_id||0); if (!hid) continue;
      const idx = idToIndex.get(hid); if (idx===undefined) continue;
      const isRad = (p.isRadiant!==undefined)? !!p.isRadiant : (Number(p.player_slot)<128);
      if (isRad) r.push(idx); else d.push(idx);
    }
    if (r.length===5 && d.length===5) return { radiant:r, dire:d };
  }
  const pb = detail.picks_bans;
  if (Array.isArray(pb)){
    const r=[], d=[];
    for (const x of pb){
      if (!x || x.is_pick!==true) continue;
      const hid = Number(x.hero_id||0); if (!hid) continue;
      const idx = idToIndex.get(hid); if (idx===undefined) continue;
      if (x.team===0 && r.length<5) r.push(idx);
      if (x.team===1 && d.length<5) d.push(idx);
      if (r.length===5 && d.length===5) break;
    }
    if (r.length===5 && d.length===5) return { radiant:r, dire:d };
  }
  return null;
}

async function main(){
  const outDir = path.resolve(__dirname, "../out");
  const matchesCsv = path.join(outDir, "matches.csv");
  const detailedCsv = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(matchesCsv)) throw new Error("out/matches.csv not found");

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  // Build OpenDota hero id to index using constants
  const constants = await getJson(`${OPEN_DOTA_BASE}/constants/heroes`);
  const idToIndex = new Map();
  if (constants && typeof constants === "object" && !Array.isArray(constants)){
    for (const h of Object.values(constants)){
      const cands = [];
      const ln = String(h.localized_name || "");
      const npc = String(h.name || ""); // npc_dota_hero_*
      if (ln) cands.push(normalizeHeroName(ln));
      if (npc && npc.startsWith("npc_dota_hero_")){
        const stripped = npc.replace(/^npc_dota_hero_/, "").replace(/_/g, " ");
        cands.push(normalizeHeroName(stripped));
      }
      let idx = undefined;
      for (const cand of cands){
        idx = data.heroes.findIndex(n => normalizeHeroName(n) === cand);
        if (idx >= 0) break;
      }
      if (idx !== undefined && idx >= 0) idToIndex.set(Number(h.id), idx);
    }
  }

  const ids = readIds(matchesCsv);
  const existing = readExistingDetailed(detailedCsv);
  const missing = ids.filter(id => !existing.has(id));
  console.log(`missing detailed rows: ${missing.length}`);

  const header = [
    "match_id","dire_heroes","dire_base","dire_advantages_sum","dire_score",
    "radiant_heroes","radiant_base","radiant_advantages_sum","radiant_score",
    "delta","radiant_win","dire_win"
  ];
  const needHeader = !fs.existsSync(detailedCsv) || fs.readFileSync(detailedCsv,"utf8").trim().length===0;
  if (needHeader){ fs.writeFileSync(detailedCsv, header.join(",")+"\n", "utf8"); }

  // Stream in batches so we don't lose progress
  for (let offset = 0; offset < missing.length; offset += BATCH_SIZE){
    const slice = missing.slice(offset, offset + BATCH_SIZE);
    let index = 0;
    const results = [];
    async function worker(){
      while(true){
        const i = index++; if (i>=slice.length) break;
        const id = slice[i];
        try {
          const d = await getJson(`${OPEN_DOTA_BASE}/matches/${id}`);
          if (!d || !d.match_id) continue;
          const teams = extractTeams(d, idToIndex);
          if (!teams) continue;
          const { radiant, dire } = teams;
          const rTeam = computeTeamScore(radiant, dire, data);
          const dTeam = computeTeamScore(dire, radiant, data);
          const rBase = radiant.reduce((s, i) => s + Number(data.heroesWr[i] || 0), 0);
          const dBase = dire.reduce((s, i) => s + Number(data.heroesWr[i] || 0), 0);
          const rAdv = rTeam.perHeroAdvantages.reduce((a,b)=>a+b,0);
          const dAdv = dTeam.perHeroAdvantages.reduce((a,b)=>a+b,0);
          const radiantScore = rBase + rAdv;
          const direScore = dBase + dAdv;
          const delta = radiantScore - direScore;
          const radiantWon = d.radiant_win === true;
          const direWin = radiantWon ? 0 : 1;
          const row = [
            d.match_id,
            dire.map(i=>data.heroes[i]).join("|"), dBase.toFixed(2), dAdv.toFixed(2), direScore.toFixed(2),
            radiant.map(i=>data.heroes[i]).join("|"), rBase.toFixed(2), rAdv.toFixed(2), radiantScore.toFixed(2),
            delta.toFixed(2), radiantWon?1:0, direWin
          ].join(",");
          results.push(row);
        } catch(_){}
        if (DETAIL_SLEEP_MS) await sleep(DETAIL_SLEEP_MS);
      }
    }
    const workers = []; const conc = Math.max(1, DETAIL_CONCURRENCY);
    for (let w=0; w<conc; w++) workers.push(worker());
    await Promise.all(workers);
    if (results.length){ fs.appendFileSync(detailedCsv, results.join("\n")+"\n", "utf8"); }
    console.log(`batch offset=${offset} size=${slice.length} appended=${results.length}`);
  }
  console.log(`done streaming append for ${missing.length} missing IDs`);

  // Note: matches_combos.csv and other derived outputs should be regenerated
  // by postprocessing scripts once detailed rows are complete.
}

if (require.main===module){
  main().catch(e=>{ console.error(e); process.exit(1); });
}

