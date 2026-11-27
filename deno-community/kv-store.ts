export interface DeviceRecord {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  soc: string;
  deviceType: string;
}

export interface PortStats {
  port_id: string;
  votes: number;
  sum: number;
}

export interface RatingsMeta {
  totalVotes: number;
  totalSum: number;
  global_avg: number;
  updatedAt: string;
}

export interface RatingSummaryPort {
  port_id: string;
  votes: number;
  avg: number;
  score: number;
}

export interface PopularityRecord {
  gameKey: string;
  allTimeVisits: number;
  weekVisits: number;
  monthVisits: number;
  weekStart: string;
  monthStart: string;
  updatedAt: string;
}

export interface PopularityBucketEntry {
  a: number;
  w: number;
  m: number;
  ws: string;
  ms: string;
  u: string;
}

export type CompatStatus = "crash" | "low_fps" | "playable_30" | "playable_60";

export interface CompatReportRecord {
  portId: string;
  tokenHash: string;
  deviceId: string;
  deviceName: string;
  deviceSoc?: string;
  deviceType?: string;
  status: CompatStatus;
  works: boolean;
  updatedAt: string;
}

export interface CompatPortSummary {
  yes: number;
  no: number;
  counts: {
    playable_60: number;
    playable_30: number;
    low_fps: number;
    crash: number;
  };
  reports: Array<{
    deviceId: string;
    deviceName: string;
    deviceSoc: string;
    deviceType: string;
    status: CompatStatus;
    works: boolean;
    updatedAt: string;
  }>;
}

export interface LinkReportRecord {
  portId: string;
  reporterHash: string;
  reason: string;
  note: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export const SUMMARY_BUCKETS = 8;

export function bucketForKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % SUMMARY_BUCKETS;
}

export function utcWeekStart(date = new Date()): string {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff),
  );
  return monday.toISOString().slice(0, 10);
}

export function utcMonthStart(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function getRatingsKeys(): Deno.KvKey[] {
  const keys: Deno.KvKey[] = [["summary", "ratings_meta"]];
  for (let i = 0; i < SUMMARY_BUCKETS; i++) {
    keys.push(["summary", "ratings_bucket", i]);
  }
  return keys;
}

export function getPopularityBucketKeys(): Deno.KvKey[] {
  const keys: Deno.KvKey[] = [];
  for (let i = 0; i < SUMMARY_BUCKETS; i++) {
    keys.push(["summary", "popularity_bucket", i]);
  }
  return keys;
}

export async function getManyBatched<T>(
  kv: Deno.Kv,
  keys: Deno.KvKey[],
): Promise<Deno.KvEntryMaybe<T>[]> {
  const results: Deno.KvEntryMaybe<T>[] = [];
  for (let i = 0; i < keys.length; i += 10) {
    const chunk = keys.slice(i, i + 10);
    const part = await kv.getMany<T[]>(chunk as never);
    results.push(...(part as Deno.KvEntryMaybe<T>[]));
  }
  return results;
}

export async function rebuildAllSummaries(kv: Deno.Kv): Promise<void> {
  // 1. Rebuild ratings meta + 8 buckets
  const portAgg = new Map<string, { votes: number; sum: number }>();
  let totalVotes = 0;
  let totalSum = 0;

  for await (const entry of kv.list<{ stars: number; portId?: string }>({
    prefix: ["rating_votes"],
  })) {
    const keyPortId = String(entry.key[1] || "");
    const stars = Number(entry.value?.stars || 0);
    if (!keyPortId || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      continue;
    }
    totalVotes += 1;
    totalSum += stars;
    const prev = portAgg.get(keyPortId) || { votes: 0, sum: 0 };
    prev.votes += 1;
    prev.sum += stars;
    portAgg.set(keyPortId, prev);
  }

  const ratingBuckets: Array<Record<string, PortStats>> = Array.from(
    { length: SUMMARY_BUCKETS },
    () => ({}),
  );

  for (const [portId, agg] of portAgg.entries()) {
    await kv.set(["rating_port_stats", portId], {
      port_id: portId,
      votes: agg.votes,
      sum: agg.sum,
    });
    const b = bucketForKey(portId);
    ratingBuckets[b][portId] = {
      port_id: portId,
      votes: agg.votes,
      sum: agg.sum,
    };
  }

  const globalAvg = totalVotes > 0 ? totalSum / totalVotes : 0;
  await kv.set(["summary", "ratings_meta"], {
    totalVotes,
    totalSum,
    global_avg: Number(globalAvg.toFixed(4)),
    updatedAt: new Date().toISOString(),
  } satisfies RatingsMeta);

  for (let i = 0; i < SUMMARY_BUCKETS; i++) {
    await kv.set(["summary", "ratings_bucket", i], ratingBuckets[i]);
  }

  // 2. Rebuild popularity 8 buckets
  const popBuckets: Array<Record<string, PopularityBucketEntry>> = Array.from(
    { length: SUMMARY_BUCKETS },
    () => ({}),
  );
  for await (const entry of kv.list<PopularityRecord>({
    prefix: ["popularity"],
  })) {
    const rec = entry.value;
    if (!rec?.gameKey) continue;
    const b = bucketForKey(rec.gameKey);
    popBuckets[b][rec.gameKey] = {
      a: Number(rec.allTimeVisits || 0),
      w: Number(rec.weekVisits || 0),
      m: Number(rec.monthVisits || 0),
      ws: String(rec.weekStart || ""),
      ms: String(rec.monthStart || ""),
      u: String(rec.updatedAt || ""),
    };
  }
  for (let i = 0; i < SUMMARY_BUCKETS; i++) {
    await kv.set(["summary", "popularity_bucket", i], popBuckets[i]);
  }

  // 3. Rebuild compatibility summaries per port
  const compatByPort = new Map<string, CompatReportRecord[]>();
  for await (const entry of kv.list<CompatReportRecord>({
    prefix: ["compat_reports"],
  })) {
    const rec = entry.value;
    if (!rec?.portId) continue;
    const arr = compatByPort.get(rec.portId) || [];
    arr.push(rec);
    compatByPort.set(rec.portId, arr);
  }
  for (const [portId, items] of compatByPort.entries()) {
    await kv.set(["compat_summary", portId], buildCompatSummaryFromList(items));
  }

  // 4. Rebuild recent link reports cache (latest 100)
  const linkList: LinkReportRecord[] = [];
  for await (const entry of kv.list<LinkReportRecord>({
    prefix: ["link_reports"],
  })) {
    if (entry.value) linkList.push(entry.value);
  }
  linkList.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  await kv.set(["summary", "recent_link_reports"], linkList.slice(0, 100));
}

export function buildCompatSummaryFromList(
  items: CompatReportRecord[],
  deviceLookup?: Map<string, DeviceRecord>,
): CompatPortSummary {
  const sorted = [...items].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
  let yes = 0;
  let no = 0;
  const counts = {
    playable_60: 0,
    playable_30: 0,
    low_fps: 0,
    crash: 0,
  };
  const reports: CompatPortSummary["reports"] = [];

  for (const r of sorted) {
    if (r.works) yes += 1;
    else no += 1;
    if (r.status in counts) {
      counts[r.status] += 1;
    }
    if (reports.length < 30) {
      const dev = deviceLookup?.get(r.deviceId);
      reports.push({
        deviceId: r.deviceId,
        deviceName: dev?.model || r.deviceName,
        deviceSoc: dev?.soc || r.deviceSoc || "",
        deviceType: dev?.deviceType || r.deviceType || "phone",
        status: r.status,
        works: r.works,
        updatedAt: r.updatedAt,
      });
    }
  }

  return { yes, no, counts, reports };
}
