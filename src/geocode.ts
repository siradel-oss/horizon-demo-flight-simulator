// Place search for the "fly to" modal, via IGN's Géoplateforme geocoding API.

import { GEOCODE_INDEX, GEOCODE_URL } from "./config";

export interface GeocodeResult {
    label: string; // primary line, e.g. "Chamonix-Mont-Blanc"
    detail: string; // secondary context (category / postcode + city)
    latitude: number;
    longitude: number;
}

interface GeoJsonFeature {
    geometry?: { coordinates?: number[] }; // [lon, lat]
    properties?: Record<string, unknown>;
}

/** POI fields can be scalars or arrays; take the first usable string. */
function firstString(v: unknown): string {
    if (Array.isArray(v)) return v.length ? String(v[0]) : "";
    return v == null ? "" : String(v);
}

/**
 * Search places by free text, by relevance. Throws on network/HTTP errors; an
 * AbortError from `signal` propagates and should be ignored.
 */
export async function searchPlaces(
    query: string,
    signal: AbortSignal,
    limit = 8,
): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (!q) return [];
    const url =
        `${GEOCODE_URL}?q=${encodeURIComponent(q)}` +
        `&index=${encodeURIComponent(GEOCODE_INDEX)}&limit=${limit}`;

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
    const data = (await res.json()) as { features?: GeoJsonFeature[] };

    const out: GeocodeResult[] = [];
    for (const f of data.features ?? []) {
        const c = f.geometry?.coordinates;
        if (!c || c.length < 2) continue;
        const p = f.properties ?? {};
        const label =
            firstString(p.label) ||
            firstString(p.name) ||
            firstString(p.toponym) ||
            firstString(p.toponyme);
        if (!label) continue;
        const detail =
            firstString(p.category) ||
            firstString(p.type) ||
            [firstString(p.postcode), firstString(p.city)]
                .filter(Boolean)
                .join(" ");
        out.push({ label, detail, latitude: c[1], longitude: c[0] });
    }
    return out;
}
