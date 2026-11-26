import pg from "pg";
import fs from "node:fs/promises";
const {Client}=pg;
const url=process.env.NEON_DATABASE_URL;
if(!url) throw new Error("Set NEON_DATABASE_URL.");
const dump=JSON.parse(await fs.readFile(process.argv[2]||"napl-supabase-export.json","utf8"));
if(dump.format!=="napl-supabase-export-v1") throw new Error("Unsupported export format.");
const order=["devices","rating_tokens","rating_token_issues","rating_votes","game_popularity","game_popularity_visit_limits","compatibility_reports","link_reports","link_report_rate_limits"];
const identityTables=new Set(["rating_token_issues","rating_votes","compatibility_reports"]);
const sequenceTables=[...identityTables,"link_reports"];
const c=new Client({connectionString:url,ssl:{rejectUnauthorized:true}});
await c.connect();
try{
 await c.query("BEGIN");
 for(const t of order){
  const rows=dump.tables[t]||[];
  if(!rows.length){console.log(t+": 0");continue}
  const cols=Object.keys(rows[0]);
  for(let i=0;i<rows.length;i+=200){
   const batch=rows.slice(i,i+200),vals=[];
   const tuples=batch.map(r=>"("+cols.map(k=>{vals.push(r[k]);return "$"+vals.length}).join(",")+")").join(",");
   const override=identityTables.has(t)?" OVERRIDING SYSTEM VALUE":"";
   await c.query(`INSERT INTO public."${t}" (${cols.map(x=>'"'+x+'"').join(",")})${override} VALUES ${tuples} ON CONFLICT DO NOTHING`,vals);
  }
  console.log(`${t}: ${rows.length}`);
 }
 for(const t of sequenceTables){
  await c.query(`SELECT setval(pg_get_serial_sequence('public."${t}"','id'),GREATEST(COALESCE((SELECT max(id) FROM public."${t}"),1),1),true)`);
 }
 await c.query("COMMIT");
}catch(e){await c.query("ROLLBACK");throw e}finally{await c.end()}
