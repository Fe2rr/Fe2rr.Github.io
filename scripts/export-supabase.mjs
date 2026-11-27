import pg from "pg";
import fs from "node:fs/promises";
const {Client}=pg;
const url=process.env.SUPABASE_DB_URL;
if(!url) throw new Error("Set SUPABASE_DB_URL to the Supabase Postgres connection string.");
const tables=["devices","rating_tokens","rating_token_issues","rating_votes","game_popularity","game_popularity_visit_limits","compatibility_reports","link_reports","link_report_rate_limits"];
const client=new Client({connectionString:url,ssl:{rejectUnauthorized:true}});
await client.connect();
try{
 await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
 const dump={format:"napl-supabase-export-v1",exportedAt:new Date().toISOString(),tables:{}};
 for(const table of tables){
  const {rows}=await client.query(`SELECT * FROM public."${table}"`);
  dump.tables[table]=rows;
  console.log(`${table}: ${rows.length}`);
 }
 await fs.writeFile("napl-supabase-export.json",JSON.stringify(dump));
 console.log("Export written to napl-supabase-export.json");
 await client.query("COMMIT");
}catch(error){try{await client.query("ROLLBACK")}catch{};throw error}finally{await client.end()}
