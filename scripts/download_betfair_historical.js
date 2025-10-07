"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function readLines(file){
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
}

function parseArgs(){
  const args = process.argv.slice(2);
  const opts = { urls: "betfair_urls.txt", out: path.resolve(__dirname, "../out/betfair"), concurrency: 4, retries: 3, cookie: process.env.BETFAIR_COOKIE || process.env.COOKIE || "" };
  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === "--urls" && args[i+1]) { opts.urls = args[++i]; continue; }
    if (a === "--out" && args[i+1]) { opts.out = args[++i]; continue; }
    if (a === "--concurrency" && args[i+1]) { opts.concurrency = Number(args[++i]); continue; }
    if (a === "--retries" && args[i+1]) { opts.retries = Number(args[++i]); continue; }
    if (a === "--cookie" && args[i+1]) { opts.cookie = String(args[++i]); continue; }
  }
  const cookieFile = path.resolve(process.cwd(), ".betfair_cookie.txt");
  if (!opts.cookie && fs.existsSync(cookieFile)) {
    opts.cookie = fs.readFileSync(cookieFile, "utf8").trim();
  }
  return opts;
}

function ensureDir(d){ fs.mkdirSync(d, { recursive: true }); }

function sanitizeFilename(name){
  return name.replace(/\?.*$/, "").replace(/[#:\\/?*"<>|]/g, "_");
}

function pickFilenameFromUrl(u){
  try {
    const x = new URL(u);
    const base = path.basename(x.pathname);
    return sanitizeFilename(base || `betfair_${Date.now()}.csv`);
  } catch {
    return sanitizeFilename(String(u).split("/").pop() || `betfair_${Date.now()}.csv`);
  }
}

function fetchToFile(u, outFile, headers, retries){
  return new Promise(async (resolve)=>{
    for (let attempt=0; attempt<=retries; attempt++){
      try {
        await new Promise((res, rej)=>{
          const url = new URL(u);
          const mod = url.protocol === "http:" ? http : https;
          const req = mod.request(url, { method: "GET", headers: headers, timeout: 30000 }, (resStream)=>{
            if (resStream.statusCode >= 300 && resStream.statusCode < 400 && resStream.headers.location){
              // follow redirect
              const loc = resStream.headers.location.startsWith("http") ? resStream.headers.location : (url.origin + resStream.headers.location);
              resStream.resume();
              // replace URL and retry by recursion
              fetchToFile(loc, outFile, headers, retries - attempt).then(resolve).catch(()=>resolve(false));
              return;
            }
            if (resStream.statusCode !== 200){
              rej(new Error(`HTTP ${resStream.statusCode}`));
              return;
            }
            const tmp = outFile + ".part";
            const ws = fs.createWriteStream(tmp);
            resStream.pipe(ws);
            ws.on("finish", ()=>{
              ws.close(()=>{
                try { fs.renameSync(tmp, outFile); } catch(_){}
                res(true);
              });
            });
            ws.on("error", rej);
          });
          req.on("timeout", ()=>{ req.destroy(new Error("timeout")); });
          req.on("error", rej);
          req.end();
        });
        return resolve(true);
      } catch(e){
        if (attempt === retries){ return resolve(false); }
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    resolve(false);
  });
}

async function main(){
  const opts = parseArgs();
  ensureDir(opts.out);
  const urlList = readLines(path.resolve(process.cwd(), opts.urls));
  if (!urlList.length){
    console.error(`No URLs found. Create ${opts.urls} with one URL per line (from historicdata.betfair.com downloads).`);
    process.exit(1);
  }
  const headers = { "User-Agent": "betfair-downloader/1.0", Accept: "*/*" };
  if (opts.cookie){ headers["Cookie"] = opts.cookie; }

  let index = 0; let ok = 0; let fail = 0;
  async function worker(){
    while(true){
      const i = index++; if (i >= urlList.length) break;
      const u = urlList[i];
      const fname = pickFilenameFromUrl(u);
      const outFile = path.join(opts.out, fname);
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0){
        console.log(`[skip] ${fname}`); continue;
      }
      console.log(`[get] ${u} -> ${fname}`);
      const okDl = await fetchToFile(u, outFile, headers, opts.retries);
      if (okDl) { ok++; console.log(`[done] ${fname}`); } else { fail++; console.log(`[fail] ${fname}`); }
    }
  }

  const workers = []; const conc = Math.max(1, Number(opts.concurrency)||1);
  for (let w=0; w<conc; w++) workers.push(worker());
  await Promise.all(workers);
  console.log(`Completed. success=${ok} fail=${fail}`);
}

if (require.main === module){
  main().catch(e=>{ console.error(e); process.exit(1); });
}

