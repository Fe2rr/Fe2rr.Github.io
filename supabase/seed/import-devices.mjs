import { readFile } from "node:fs/promises";

const supabaseUrl = (
    process.env.SUPABASE_URL || "https://gsksanvcdbdoevairzpj.supabase.co"
).replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
    throw new Error(
        "Set SUPABASE_SERVICE_ROLE_KEY before running this script."
    );
}

const sourceUrl = new URL("../../public/assets/data/devices.json", import.meta.url);
const devices = JSON.parse(await readFile(sourceUrl, "utf8"));

if (!Array.isArray(devices) || devices.length === 0) {
    throw new Error("The device source file is empty or has an invalid format.");
}

const normalized = devices
    .map((device) => ({
        id: String(device.id || "").trim(),
        name: String(device.name || "").trim(),
        manufacturer: String(device.manufacturer || "").trim(),
        model: String(device.model || "").trim(),
        soc: String(device.soc || "").trim(),
        device_type: String(device.device_type || device.deviceType || "phone").trim() || "phone",
    }))
    .filter((device) => device.id && device.name);

if (normalized.length !== devices.length) {
    throw new Error("Some device entries have a missing ID or name; import aborted.");
}

const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
};

const upsertEndpoint = `${supabaseUrl}/rest/v1/devices?on_conflict=id`;
const batchSize = 500;
let imported = 0;

for (let offset = 0; offset < normalized.length; offset += batchSize) {
    const batch = normalized.slice(offset, offset + batchSize);
    const response = await fetch(upsertEndpoint, {
        method: "POST",
        headers: {
            ...headers,
            Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(batch),
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(
            `Device import failed at row ${offset + 1} (HTTP ${response.status}): ${detail}`
        );
    }

    imported += batch.length;
    console.log(`Upserted ${imported}/${normalized.length} devices`);
}

// Safely remove obsolete legacy device IDs that are NOT referenced by any compatibility_reports
const validIds = new Set(normalized.map((d) => d.id));
const existingIds = [];
const pageSize = 1000;

for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
        `${supabaseUrl}/rest/v1/devices?select=id&order=id.asc&limit=${pageSize}&offset=${offset}`,
        { headers }
    );
    if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Could not list existing device IDs (HTTP ${res.status}): ${detail}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
        if (row?.id) existingIds.push(row.id);
    }
    if (rows.length < pageSize) break;
}

const obsoleteIds = existingIds.filter((id) => !validIds.has(id));
console.log(`Found ${obsoleteIds.length} obsolete/legacy device IDs to prune if unreferenced.`);

// Fetch device_ids currently referenced in compatibility_reports so we skip them cleanly
const referencedIds = new Set();
for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
        `${supabaseUrl}/rest/v1/compatibility_reports?select=device_id&limit=${pageSize}&offset=${offset}`,
        { headers }
    );
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
        if (row?.device_id) referencedIds.add(row.device_id);
    }
    if (rows.length < pageSize) break;
}

const safeToDelete = obsoleteIds.filter((id) => !referencedIds.has(id));
let deleted = 0;
const deleteBatchSize = 100;

for (let offset = 0; offset < safeToDelete.length; offset += deleteBatchSize) {
    const batch = safeToDelete.slice(offset, offset + deleteBatchSize);
    const inFilter = batch.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    const res = await fetch(
        `${supabaseUrl}/rest/v1/devices?id=in.(${encodeURIComponent(inFilter)})`,
        {
            method: "DELETE",
            headers,
        }
    );
    if (res.ok) {
        deleted += batch.length;
    } else {
        console.warn(`Skipped delete batch at ${offset} (HTTP ${res.status})`);
    }
}

console.log(
    `Finished. ${imported} devices synchronized, ${deleted} unreferenced legacy entries removed, ${obsoleteIds.length - safeToDelete.length} referenced legacy entries preserved.`
);
