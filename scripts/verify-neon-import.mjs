import pg from "pg";
import fs from "node:fs/promises";
const {Client}=pg; const url=process.env.NEON_DATABASE_URL; if(!url) throw new Error("Set NEON_DATABASE_URL");
const dump=JSON.parse(await fs.readFile(process.argv[2]||"napl-supabase-export.json","utf8"));
if(dump.format!=="napl-supabase-export-v1") throw new Error("Unsupported export format");
const c=new Client({connectionString:url,ssl:{rejectUnauthorized:false}}); await c.connect();
try { let mismatch=false; for(const [table,rows] of Object.entries(dump.tables)){ const r=await c.query('select count(*)::int n from public."'+table+'"'); const actual=r.rows[0].n; const expected=rows.length; const ok=actual===expected; if(!ok)mismatch=true; console.log(table+": "+actual+" / exported "+expected+" "+(ok?"OK":"MISMATCH")); } if(mismatch)process.exitCode=1; else console.log("All Neon table counts match the exported Supabase snapshot."); } finally { await c.end(); }
