import pg from "pg";
const {Pool}=pg;
let pool;
export function db(){
 if(!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL is not configured");
 if(!pool) pool=new Pool({connectionString:process.env.NEON_DATABASE_URL,ssl:{rejectUnauthorized:true},max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:8000});
 return pool;
}
