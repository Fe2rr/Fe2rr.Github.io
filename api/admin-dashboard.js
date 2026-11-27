import worker from "../cloudflare/napl-admin-worker.js";
import { db } from "./_lib/db.js";
import { cors, method } from "./_lib/http.js";

function workerEnv() {
  return {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    CATALOG_DATA_GITHUB_TOKEN: process.env.CATALOG_DATA_GITHUB_TOKEN,
    ADMIN_ORIGIN: process.env.ALLOWED_ORIGINS || "https://napl-admin.pages.dev",
    AUTO_PUBLISH_CRON: "",
    CRON_BATCH_SIZE: "10",
  };
}

async function verifyAdminSession(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return false;
  const upstream = await worker.fetch(new Request("https://napl-internal/api/verify-session", {
    method: "GET",
    headers: {
      Origin: String(req.headers.origin || "https://napl-admin.pages.dev"),
      Authorization: auth,
    },
  }), workerEnv());
  return upstream.ok;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!method(req, res, ["GET"])) return;

  try {
    if (!(await verifyAdminSession(req))) {
      return res.status(401).json({ success: false, error: "admin_session_invalid" });
    }

    const p = db();
    const [link, compatibility, ratings, popularity, totals] = await Promise.all([
      p.query("select id,port_id,reason,note,url,created_at,updated_at from link_reports order by created_at desc limit 100"),
      p.query("select id,port_id,device_id,device_name,works,status,updated_at from compatibility_reports order by updated_at desc limit 100"),
      p.query("select id,port_id,stars,created_at,updated_at from rating_votes order by created_at desc limit 100"),
      p.query("select game_key,all_time_visits,week_visits,month_visits,week_start,month_start,updated_at from game_popularity order by all_time_visits desc limit 1000"),
      p.query(`select
        (select count(*)::int from link_reports) as "linkReports",
        (select count(*)::int from compatibility_reports) as "compatibilityReports",
        (select count(*)::int from rating_votes) as "ratingVotes",
        (select count(*)::int from game_popularity) as "gamesTracked",
        (select coalesce(sum(all_time_visits),0)::bigint from game_popularity) as "allTimeVisits",
        (select coalesce(sum(week_visits),0)::bigint from game_popularity) as "weekVisits",
        (select coalesce(sum(month_visits),0)::bigint from game_popularity) as "monthVisits"`),
    ]);

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: true,
      totals: totals.rows[0] || {},
      reports: link.rows,
      compatibility: compatibility.rows,
      ratings: ratings.rows,
      popularity: popularity.rows,
    });
  } catch (error) {
    console.error("NAPL admin dashboard:", error);
    return res.status(500).json({ success: false, error: "community_data_unavailable" });
  }
}
