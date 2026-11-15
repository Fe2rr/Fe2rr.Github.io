import { readFile } from "node:fs/promises";

const supabaseUrl = (
    process.env.SUPABASE_URL || "https://gsksanvcdbdoevairzpj.supabase.co"
).replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY before running this script.");
}

const sourceUrl = new URL("../../public/assets/data/devices.json", import.meta.url);
const manifest = JSON.parse(await readFile(sourceUrl, "utf8"));

let devices;
if (Array.isArray(manifest)) {
    // Backward compatibility with an unsharded catalog.
    devices = manifest;
} else if (
    manifest?.format === "napl-device-catalog-shards-v1" &&
    Array.isArray(manifest.chunks) &&
    manifest.chunks.length > 0
) {
    devices = [];
    for (const chunk of manifest.chunks) {
        const filename = String(chunk?.file || "");
        if (!/^devices-part-\\d{3}\\.json$/.test(filename)) {
            throw new Error(`Invalid device catalog chunk name: ${filename}`);
        }
        const chunkUrl = new URL(
            `../../public/assets/data/device-catalog/${filename}`,
            import.meta.url
        );
        const records = JSON.parse(await readFile(chunkUrl, "utf8"));
        if (!Array.isArray(records)) {
            throw new Error(`Device catalog chunk ${filename} is not an array.`);
        }
        if (Number(chunk.records) !== records.length) {
            throw new Error(`Device catalog chunk ${filename} has an unexpected record count.`);
        }
        devices.push(...records);
    }
    if (Number(manifest.total) !== devices.length) {
        throw new Error("Device catalog manifest total does not match the loaded chunks.");
    }
} else {
    throw new Error("The device source manifest has an invalid format.");
}

if (!Array.isArray(devices) || devices.length === 0) {
    throw new Error("The device source file is empty or has an invalid format.");
}

const normalized = devices.map((device) => ({
    id: String(device?.id || "").trim(),
    name: String(device?.name || "").trim(),
    manufacturer: String(device?.manufacturer || "").trim(),
    model: String(device?.model || "").trim(),
    soc: String(device?.soc || "").trim(),
    device_type: String(device?.device_type || device?.deviceType || "").trim(),
}));

const requiredFields = ["id", "name", "manufacturer", "model", "soc", "device_type"];
const invalid = normalized.filter((device) =>
    requiredFields.some((field) => !device[field])
);
if (invalid.length) {
    throw new Error(
        `Found ${invalid.length} device records with missing required fields; import aborted.`
    );
}

const ids = new Set();
for (const device of normalized) {
    if (ids.has(device.id)) {
        throw new Error(`Duplicate device ID "${device.id}"; import aborted.`);
    }
    ids.add(device.id);
}

const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
};

const pageSize = 1000;

// Read all compatibility references BEFORE making changes. Any API, parsing,
// or pagination error aborts the script before the catalog can be pruned.
const referencedIds = new Set();
for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/compatibility_reports`);
    url.searchParams.set("select", "id,device_id");
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url, { headers });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(
            `Could not read compatibility report references (HTTP ${response.status}): ${detail}. No devices were changed.`
        );
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
        throw new Error("Compatibility reports returned an invalid response. No devices were changed.");
    }

    for (const row of rows) {
        if (row?.device_id) referencedIds.add(String(row.device_id));
    }
    if (rows.length < pageSize) break;
}

console.log(`Loaded ${referencedIds.size} referenced device IDs from compatibility reports.`);

// Read the existing catalog completely before any writes, too.
const existingIds = [];
for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/devices`);
    url.searchParams.set("select", "id");
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url, { headers });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(
            `Could not list existing device IDs (HTTP ${response.status}): ${detail}. No devices were changed.`
        );
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
        throw new Error("Existing devices returned an invalid response. No devices were changed.");
    }

    for (const row of rows) {
        if (row?.id) existingIds.push(String(row.id));
    }
    if (rows.length < pageSize) break;
}

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

const obsoleteIds = existingIds.filter((id) => !ids.has(id));
const safeToDelete = obsoleteIds.filter((id) => !referencedIds.has(id));
const preserved = obsoleteIds.length - safeToDelete.length;

console.log(
    `Found ${obsoleteIds.length} obsolete IDs: ${safeToDelete.length} unreferenced candidates, ${preserved} referenced records protected.`
);

// Foreign-key constraints provide a final safeguard if a new report is added
// after the reference snapshot was read.
let deleted = 0;
const deleteBatchSize = 100;

for (let offset = 0; offset < safeToDelete.length; offset += deleteBatchSize) {
    const batch = safeToDelete.slice(offset, offset + deleteBatchSize);
    const filter = batch
        .map((id) => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",");
    const url = `${supabaseUrl}/rest/v1/devices?id=in.(${encodeURIComponent(filter)})`;

    const response = await fetch(url, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=minimal" },
    });

    if (!response.ok) {
        const detail = await response.text();
        console.warn(
            `Could not delete legacy batch at offset ${offset} (HTTP ${response.status}); records left untouched: ${detail}`
        );
        continue;
    }

    deleted += batch.length;
}

console.log(
    `Finished. ${imported} devices synchronized, ${deleted} unreferenced legacy entries removed, ${preserved} referenced legacy entries preserved.`
);
