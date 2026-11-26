import pg from "pg";
const {Client}=pg; const url=process.env.NEON_DATABASE_URL; if(!url) throw new Error("Set NEON_DATABASE_URL");
const expected={devices:18394,game_popularity:996,game_popularity_visit_limits:28853,rating_votes:446,rating_tokens:763,rating_token_issues:59,compatibility_reports:1061,link_reports:71,link_report_rate_limits:63};
const c=new Client({connectionString:url,ssl:{rejectUnauthorized:false}}); await c.connect();
try { let mismatch=false; for(const [table,count] of Object.entries(expected)){ const r=await c.query('select count(*)::int n from public."'+table+'"'); const actual=r.rows[0].n; const ok=actual===count; if(!ok)mismatch=true; console.log(table+": "+actual+" / expected "+count+" "+(ok?"OK":"MISMATCH")); } if(mismatch)process.exitCode=1; else console.log("All imported table counts match the source snapshot."); } finally { await c.end(); }
