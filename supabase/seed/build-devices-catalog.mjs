import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import {
    ANDROID_HANDHELDS,
    cleanModelName,
    deviceSlug,
    formatDeviceDisplayModel,
    hashDeviceKey,
    normalizeDevicePart,
    resolveCommercialSoc,
} from "./soc-map.mjs";

const CATALOG_URL =
    "https://hossain-khan.github.io/android-device-catalog-parser/catalog-data/android-devices-catalog.min.json";

const ALLOWED_FORM_FACTORS = new Set(["Phone", "Tablet"]);

const CANONICAL_MANUFACTURERS = {
    abxylute: "Abxylute",
    alcatel: "Alcatel",
    alldocube: "Alldocube",
    amazon: "Amazon",
    anbernic: "Anbernic",
    asus: "ASUS",
    ayaneo: "AYANEO",
    ayn: "AYN",
    blackview: "Blackview",
    blu: "BLU",
    bq: "bq",
    cat: "CAT",
    chuwi: "CHUWI",
    coolpad: "Coolpad",
    cubot: "Cubot",
    doogee: "DOOGEE",
    fairphone: "Fairphone",
    fujitsu: "Fujitsu",
    google: "Google",
    gpd: "GPD",
    hisense: "Hisense",
    hmd: "HMD",
    honor: "HONOR",
    htc: "HTC",
    huawei: "HUAWEI",
    infinix: "Infinix",
    itel: "itel",
    konkr: "KONKR",
    kt: "KT",
    kyocera: "Kyocera",
    lava: "Lava",
    lenovo: "Lenovo",
    lg: "LG",
    logitech: "Logitech",
    mangmi: "MANGMI",
    meizu: "Meizu",
    micromax: "Micromax",
    moqi: "MOQI",
    motorola: "Motorola",
    nokia: "Nokia",
    nothing: "Nothing",
    nubia: "Nubia",
    oneplus: "OnePlus",
    oppo: "OPPO",
    oukitel: "OUKITEL",
    panasonic: "Panasonic",
    philips: "Philips",
    pimax: "Pimax",
    poco: "POCO",
    powkiddy: "Powkiddy",
    razer: "Razer",
    realme: "Realme",
    redmi: "Redmi",
    retroid: "Retroid",
    samsung: "Samsung",
    sharp: "Sharp",
    sony: "Sony",
    tcl: "TCL",
    teclast: "Teclast",
    tecno: "TECNO",
    tjd: "TJD",
    ulefone: "Ulefone",
    umidigi: "UMIDIGI",
    unihertz: "Unihertz",
    vivo: "vivo",
    wiko: "Wiko",
    xiaomi: "Xiaomi",
    zpg: "ZPG",
    zte: "ZTE",
};

function normalizeManufacturer(raw) {
    const clean = String(raw || "")
        .replace(/^"+|"+$/g, "")
        .replace(/""+/g, '"')
        .replace(/\s+/g, " ")
        .trim();
    if (!clean) return "";
    const key = normalizeDevicePart(clean);
    return CANONICAL_MANUFACTURERS[key] || clean;
}

function normalizeDeviceType(formFactor) {
    const clean = String(formFactor || "").trim().toLowerCase();
    if (clean === "tablet") return "tablet";
    if (clean === "handheld") return "handheld";
    return "phone";
}

function truncateText(text, maxLength) {
    const str = String(text || "").trim();
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength).trim();
}

function buildDisplayName(displayModel, soc) {
    const cleanModel = truncateText(displayModel, 240);
    const cleanSoc = String(soc || "").trim();
    if (!cleanSoc) return cleanModel;

    const full = `${cleanModel} (${cleanSoc})`;
    if (full.length <= 240) return full;

    const maxModelLen = Math.max(20, 240 - cleanSoc.length - 3);
    return `${truncateText(cleanModel, maxModelLen)} (${cleanSoc})`;
}

function buildDeviceId(prefix, displayModel, soc, usedIds) {
    const baseKey = `${normalizeDevicePart(displayModel)}|${normalizeDevicePart(soc)}`;
    const hash = hashDeviceKey(baseKey);
    const slug = deviceSlug(`${displayModel}${soc ? `-${soc}` : ""}`) || "device";
    let id = `${prefix}:${slug.slice(0, 180 - prefix.length)}-${hash}`;
    id = id.slice(0, 200);

    let counter = 2;
    while (usedIds.has(id)) {
        const suffix = `-${counter}`;
        id = `${id.slice(0, 200 - suffix.length)}${suffix}`;
        counter += 1;
    }
    usedIds.add(id);
    return id;
}

function sqlString(value) {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

async function main() {
    console.log("Fetching Google Play Android Device Catalog...");
    const response = await fetch(CATALOG_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch catalog (HTTP ${response.status})`);
    }
    const rawCatalog = await response.json();
    if (!Array.isArray(rawCatalog)) {
        throw new Error("Upstream catalog is not an array.");
    }

    console.log(`Fetched ${rawCatalog.length} raw catalog entries.`);

    const dedupMap = new Map();
    let skippedFormFactor = 0;
    let skippedEmpty = 0;

    for (const item of rawCatalog) {
        const formFactor = String(item?.formFactor || "").trim();
        if (!ALLOWED_FORM_FACTORS.has(formFactor)) {
            skippedFormFactor += 1;
            continue;
        }

        const manufacturer = normalizeManufacturer(item?.manufacturer);
        const cleanedModel = cleanModelName(manufacturer, item?.modelName || item?.device);
        if (!cleanedModel && !manufacturer) {
            skippedEmpty += 1;
            continue;
        }

        const displayModel = formatDeviceDisplayModel(manufacturer, cleanedModel);
        if (!displayModel) {
            skippedEmpty += 1;
            continue;
        }

        const soc = resolveCommercialSoc(item?.processorName, item?.gpu);
        const deviceType = normalizeDeviceType(formFactor);

        const normModel = normalizeDevicePart(displayModel);
        const normSoc = normalizeDevicePart(soc);
        const dedupKey = `${normModel}|${normSoc}`;

        // If an entry already exists with the exact same model & SoC, keep it
        // (preferring non-empty manufacturer/model metadata or tablet over phone only if same)
        if (!dedupMap.has(dedupKey)) {
            dedupMap.set(dedupKey, {
                prefix: "catalog",
                manufacturer: truncateText(manufacturer, 120),
                model: truncateText(displayModel, 200),
                soc: truncateText(soc, 120),
                device_type: deviceType,
            });
        }
    }

    // Merge curated Android handhelds (overrides/adds handheld device_type)
    let handheldAdded = 0;
    let handheldUpdated = 0;
    for (const handheld of ANDROID_HANDHELDS) {
        const manufacturer = normalizeManufacturer(handheld.manufacturer);
        const displayModel = formatDeviceDisplayModel(manufacturer, handheld.model);
        const soc = String(handheld.soc || "").trim();
        const dedupKey = `${normalizeDevicePart(displayModel)}|${normalizeDevicePart(soc)}`;

        if (dedupMap.has(dedupKey)) {
            const existing = dedupMap.get(dedupKey);
            existing.manufacturer = truncateText(manufacturer, 120);
            existing.model = truncateText(displayModel, 200);
            existing.device_type = "handheld";
            existing.prefix = "handheld";
            handheldUpdated += 1;
        } else {
            dedupMap.set(dedupKey, {
                prefix: "handheld",
                manufacturer: truncateText(manufacturer, 120),
                model: truncateText(displayModel, 200),
                soc: truncateText(soc, 120),
                device_type: "handheld",
            });
            handheldAdded += 1;
        }
    }

    // Secondary pass: if the same displayModel exists BOTH with a known SoC and with empty SoC,
    // drop the empty-SoC duplicate so we don't have "Device X" alongside "Device X (Snapdragon ...)"
    const modelsWithSoc = new Set();
    for (const entry of dedupMap.values()) {
        if (entry.soc) {
            modelsWithSoc.add(normalizeDevicePart(entry.model));
        }
    }

    let droppedEmptySocDuplicates = 0;
    for (const [key, entry] of dedupMap.entries()) {
        if (!entry.soc && modelsWithSoc.has(normalizeDevicePart(entry.model))) {
            dedupMap.delete(key);
            droppedEmptySocDuplicates += 1;
        }
    }

    const usedIds = new Set();
    const devices = [];
    for (const entry of dedupMap.values()) {
        const id = buildDeviceId(entry.prefix, entry.model, entry.soc, usedIds);
        const name = buildDisplayName(entry.model, entry.soc);
        devices.push({
            id,
            name,
            manufacturer: entry.manufacturer,
            model: entry.model,
            soc: entry.soc,
            device_type: entry.device_type,
        });
    }

    devices.sort((a, b) => a.name.localeCompare(b.name, "en"));

    // Write the catalog in manageable JSON shards. The manifest keeps the
    // importer deterministic while avoiding a single oversized GitHub file.
    const dataDir = new URL("../../public/assets/data/", import.meta.url);
    const shardsDir = new URL("../../public/assets/data/device-catalog/", import.meta.url);
    await mkdir(shardsDir, { recursive: true });

    for (const filename of await readdir(shardsDir)) {
        if (/^devices-part-\\d{3}\\.json$/.test(filename)) {
            await rm(new URL(filename, shardsDir), { force: true });
        }
    }

    const shardSize = 1000;
    const chunks = [];
    for (let i = 0; i < devices.length; i += shardSize) {
        const part = devices.slice(i, i + shardSize);
        const filename = `devices-part-${String(chunks.length + 1).padStart(3, "0")}.json`;
        await writeFile(new URL(filename, shardsDir), JSON.stringify(part), "utf8");
        chunks.push({ file: filename, records: part.length });
    }

    const manifest = {
        format: "napl-device-catalog-shards-v1",
        total: devices.length,
        chunkSize: shardSize,
        chunks,
    };
    await writeFile(
        new URL("devices.json", dataDir),
        `${JSON.stringify(manifest, null, 2)}\\n`,
        "utf8"
    );

    // Generate compact batched SQL seed for Supabase SQL Editor
    const sqlOutUrl = new URL("./devices_seed.sql", import.meta.url);
    const sqlChunks = [];
    sqlChunks.push("-- Generated Android device catalog seed for NAPL (Phone, Tablet, Handheld)");
    sqlChunks.push(`-- Total unique devices: ${devices.length}`);
    sqlChunks.push("BEGIN;");
    sqlChunks.push("");
    sqlChunks.push(`ALTER TABLE public.devices
    ADD COLUMN IF NOT EXISTS manufacturer text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS soc text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'phone';`);
    sqlChunks.push("");
    sqlChunks.push(`CREATE TEMP TABLE _napl_seed_devices (
    id text PRIMARY KEY,
    name text NOT NULL,
    manufacturer text NOT NULL,
    model text NOT NULL,
    soc text NOT NULL,
    device_type text NOT NULL
) ON COMMIT DROP;`);
    sqlChunks.push("");

    const batchSize = 500;
    for (let i = 0; i < devices.length; i += batchSize) {
        const batch = devices.slice(i, i + batchSize);
        const rowsSql = batch
            .map(
                (d) =>
                    `(${sqlString(d.id)}, ${sqlString(d.name)}, ${sqlString(
                        d.manufacturer
                    )}, ${sqlString(d.model)}, ${sqlString(d.soc)}, ${sqlString(
                        d.device_type
                    )})`
            )
            .join(",\n");
        sqlChunks.push(
            `INSERT INTO _napl_seed_devices (id, name, manufacturer, model, soc, device_type) VALUES\n${rowsSql};`
        );
    }

    sqlChunks.push("");
    sqlChunks.push(`INSERT INTO public.devices (id, name, manufacturer, model, soc, device_type)
SELECT id, name, manufacturer, model, soc, device_type
FROM _napl_seed_devices
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    manufacturer = EXCLUDED.manufacturer,
    model = EXCLUDED.model,
    soc = EXCLUDED.soc,
    device_type = EXCLUDED.device_type;`);
    sqlChunks.push("");
    sqlChunks.push(`-- Remove obsolete/duplicate legacy devices only if they have no compatibility reports
DELETE FROM public.devices d
WHERE NOT EXISTS (
    SELECT 1 FROM _napl_seed_devices s WHERE s.id = d.id
)
AND NOT EXISTS (
    SELECT 1 FROM public.compatibility_reports r WHERE r.device_id = d.id
);`);
    sqlChunks.push("");
    sqlChunks.push("COMMIT;");
    sqlChunks.push("");

    await writeFile(sqlOutUrl, sqlChunks.join("\n"), "utf8");

    // Statistics & diagnostics
    const byType = { phone: 0, tablet: 0, handheld: 0 };
    const socCounts = new Map();
    const unmappedFallbacks = new Map();
    let withSoc = 0;

    for (const d of devices) {
        byType[d.device_type] = (byType[d.device_type] || 0) + 1;
        if (d.soc) {
            withSoc += 1;
            socCounts.set(d.soc, (socCounts.get(d.soc) || 0) + 1);
            if (/^Snapdragon \(|^MediaTek MT|^Unisoc (?:SC|UMS|SL)/i.test(d.soc)) {
                unmappedFallbacks.set(d.soc, (unmappedFallbacks.get(d.soc) || 0) + 1);
            }
        }
    }

    console.log("Build summary:");
    console.log(`- Skipped non-Phone/Tablet form factors: ${skippedFormFactor}`);
    console.log(`- Skipped empty model/mfg: ${skippedEmpty}`);
    console.log(`- Dropped empty-SoC duplicates: ${droppedEmptySocDuplicates}`);
    console.log(`- Handhelds added: ${handheldAdded}, updated: ${handheldUpdated}`);
    console.log(`- Final unique devices: ${devices.length}`);
    console.log(`- By type: phone=${byType.phone}, tablet=${byType.tablet}, handheld=${byType.handheld}`);
    console.log(`- Devices with SoC: ${withSoc} / ${devices.length}`);
    console.log("\nTop 15 SoCs:");
    Array.from(socCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .forEach(([soc, count]) => console.log(`  ${count.toString().padStart(4)}  ${soc}`));

    console.log("\nTop 25 fallback/code SoCs remaining:");
    Array.from(unmappedFallbacks.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .forEach(([soc, count]) => console.log(`  ${count.toString().padStart(4)}  ${soc}`));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
