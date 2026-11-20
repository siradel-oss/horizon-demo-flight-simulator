// Tweakable constants for the demo.

/**
 * Absolute URL of a file under public/ (the engine fetches from a worker).
 * `new URL()` encodes `{z}` as `%7Bz%7D`, so tile templates are put back.
 */
const asset = (path: string): string =>
    new URL(path, document.baseURI).href
        .replace(/%7B/g, "{")
        .replace(/%7D/g, "}");

/** Default start pose: the Chamonix valley. */
export const START = {
    latitude: 45.9237,
    longitude: 6.8694,
    /** Metres above the WGS84 ellipsoid. */
    altitude: 2600,
    /** Degrees clockwise from North. */
    headingDeg: 200,
};

/** Recorded scene paths (T records one; see src/trajectory.ts). */
export const TRAJECTORY = {
    /** Milliseconds between recorded samples (also the playback step). */
    intervalMs: 250,
    /** A path ending within this distance (m) of its start is sealed into a loop. */
    captureRadiusM: 120,
    /** Trailing samples eased toward the start pose when sealing a loop. */
    sealSamples: 8,
};

// --- "Fly to" place search (F) ----------------------------------------------
/** IGN Géoplateforme geocoding endpoint (GeoJSON, no API key). */
export const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";
/** POIs (peaks, lakes, landmarks) + addresses/municipalities. */
export const GEOCODE_INDEX = "poi,address";
/** Altitude (m) for a teleport, kept if already higher; clears most Alpine terrain. */
export const FLYTO_ALTITUDE_M = 3800;

/** Waypoint navigation: heading bug and distance/ETA/bearing on the PFD. */
export const NAV = {
    /** Horizontal distance (m) within which the destination counts as reached. */
    arrivalRadiusM: 600,
    /** How long (ms) the "arrived" banner lingers before it clears itself. */
    arrivedHoldMs: 4000,
    /** Floor groundspeed (m/s) for the ETA, so a near-stall doesn't blow it up. */
    minEtaSpeedMps: 5,
};

/**
 * Minimap: a second scene view rendered into a corner of the canvas. Horizon has
 * no 2D mode, so it is a nadir camera over a hypsometric elevation raster and
 * OpenMapTiles vectors.
 */
export const MINIMAP = {
    /** Camera height above the ground (m), i.e. the zoom. */
    defaultRangeM: 25000,
    minRangeM: 1200,
    maxRangeM: 200000,
    /** Multiplier per wheel notch over the minimap (>1 zooms out). */
    zoomFactor: 1.25,
    /**
     * Elevation (m) → colour, interpolated in sRGB. Most stops sit below 800 m so
     * lowland terrain still shows gradation.
     */
    elevationPalette: [
        { value: 0, r: 0.17, g: 0.31, b: 0.2 },
        { value: 150, r: 0.28, g: 0.4, b: 0.23 },
        { value: 350, r: 0.45, g: 0.48, b: 0.27 },
        { value: 550, r: 0.58, g: 0.54, b: 0.31 },
        { value: 800, r: 0.6, g: 0.5, b: 0.34 },
        { value: 1200, r: 0.56, g: 0.44, b: 0.31 },
        { value: 1800, r: 0.5, g: 0.39, b: 0.29 },
        { value: 2500, r: 0.47, g: 0.43, b: 0.42 },
        { value: 3200, r: 0.55, g: 0.55, b: 0.58 },
        { value: 4000, r: 0.68, g: 0.68, b: 0.72 },
        { value: 4800, r: 0.86, g: 0.86, b: 0.9 },
    ],
    /** Label sizes (px). */
    cityFontPx: 13,
    townFontPx: 10,
    dotRadiusPx: 3.5,
    /** Pixels the name is lifted above its dot. */
    labelOffsetPx: 13,

    // Hydrography (OpenMapTiles `water` + `waterway`).
    waterFillColor: { r: 0.22, g: 0.38, b: 0.6, a: 0.9 },
    riverColor: { r: 0.42, g: 0.6, b: 0.82, a: 1 },
    riverWidthPx: 1.0,
    riverMajorWidthPx: 1.8,
    /** Intermittent rivers are dashed: period and "on" length (px). */
    riverDashPeriodPx: 6,
    riverDashOnPx: 2.5,

    // Admin borders (OpenMapTiles `boundary`).
    borderColor: { r: 0.92, g: 0.87, b: 0.72, a: 0.85 },
    borderDashOnPx: 3,
    borderDashPeriodPx: 8,
    borderWidthPx: {
        country: 1.8,
        region: 1.3,
        county: 1.0,
        municipality: 0.7,
    },

    // Roads (`transportation`) and buildings (`building`): only in deep tiles.
    roadColor: { r: 0.14, g: 0.14, b: 0.17, a: 0.85 },
    roadWidthPx: {
        motorway: 2.2,
        trunk: 1.9,
        primary: 1.6,
        secondary: 1.3,
        tertiary: 1.0,
        minor: 0.8,
        service: 0.6,
    },
    /** Roads only below this camera altitude (m): tile LOD alone shows them too early. */
    roadVisibleBelowM: 18000,
    /** Tunnels are dashed: period and "on" length (px). */
    roadDashPeriodPx: 5,
    roadTunnelDashOnPx: 2.5,
    buildingColor: { r: 0.34, g: 0.33, b: 0.31, a: 0.75 },
};

/**
 * IGN orthophotos (no key, CORS open). `maxLevel` is the deepest level served;
 * `bounds` fences requests to the coverage, since outside it the service answers 404.
 */
export const IGN_ORTHO = {
    name: "IGN Orthophotos",
    url:
        "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
        "&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    attribution: "Orthophotos © IGN / Géoplateforme",
    maxLevel: 19,
    bounds: { west: -5.5, south: 41.2, east: 10.0, north: 51.5 },
};

/** The same service seen from orbit: world imagery down to level 12 (~40 m/px). */
export const IGN_ORTHO_WORLD = {
    ...IGN_ORTHO,
    name: "IGN Orthophotos (world)",
    maxLevel: 12,
    bounds: { west: -180, south: -85, east: 180, north: 85 },
};

/**
 * Street names laid flat along their road. Horizon cannot yet run text along a
 * line, so each feature gets one straight label rotated to the line's direction
 * at its anchor; on a curve it reads as a chord.
 */
export const ROAD_LABELS = {
    fontPx: 13,
    color: { r: 0.16, g: 0.16, b: 0.18, a: 1 },
    outlineColor: { r: 1, g: 1, b: 1, a: 0.85 },
    /** Em units. */
    outlineWidth: 0.25,
    /** Metres above the street. */
    liftM: 2,
};

/** Extent of the central Rennes extract bundled in public/data/rennes. */
const RENNES_EXTRACT = {
    west: -1.725,
    south: 48.088,
    east: -1.645,
    north: 48.132,
};

/** Rennes buildings (Siradel), as a Geobuf tile pyramid. */
export const RENNES = {
    buildings: {
        url: asset("data/rennes/buildings/{z}/{x}/{y}.geobuf"),
        maxLevel: 14,
        bounds: RENNES_EXTRACT,
    },
    attribution: "Rennes LOD1 © Siradel",
    /** Ground colour under the vectors. */
    groundColor: { r: 0.961, g: 0.953, b: 0.933, a: 1 },
    /** Tile refinement tolerance (px). Lower buys nothing past the deepest tile. */
    maxScreenSpaceError: 2,
    /**
     * Bevel along extruded edges (m). Must stay 0: with a bevel, buildings load
     * intermittently (it doubles geometry memory and is dropped per feature for
     * small or tessellated footprints).
     */
    bevelM: 0,
    /** Fallbacks for a building whose data carries no height or class. */
    defaultHeightM: 8,
    defaultBase: { r: 0.42, g: 0.36, b: 0.34, a: 1 },
    defaultWall: { r: 0.62, g: 0.55, b: 0.52, a: 1 },
    defaultRoof: { r: 0.75, g: 0.68, b: 0.64, a: 1 },
};

/** Building colour by the `Type` attribute (a label palette: keyed on strings). */
export const RENNES_TYPE_COLORS: Record<
    string,
    { r: number; g: number; b: number }
> = {
    BUILDING: { r: 0.93, g: 0.82, b: 0.62 },
    SHACK_HOUSE: { r: 0.85, g: 0.66, b: 0.44 },
    INDUSTRY: { r: 0.66, g: 0.45, b: 0.78 },
    CONSTRUCTION: { r: 0.74, g: 0.74, b: 0.76 },
    MONUMENT: { r: 1.0, g: 0.69, b: 0.04 },
    FORTIFICATION: { r: 0.79, g: 0.64, b: 0.15 },
    PLATFORM: { r: 0.62, g: 0.62, b: 0.64 },
    PYLON: { r: 0.49, g: 0.49, b: 0.51 },
    WOOD: { r: 0.0, g: 0.58, b: 0.06 },
    TREE: { r: 0.0, g: 0.58, b: 0.06 },
    WATER: { r: 0.0, g: 0.58, b: 1.0 },
    ROAD_BRIDGE: { r: 0.56, g: 0.56, b: 0.56 },
    PEDESTRIAN_BRIDGE: { r: 0.56, g: 0.56, b: 0.56 },
    WATER_BRIDGE: { r: 0.56, g: 0.56, b: 0.56 },
    COVERED_ROAD: { r: 0.56, g: 0.56, b: 0.56 },
};

/** Classes drawn flat on the ground rather than extruded. */
export const RENNES_FLAT_TYPES = [
    "WOOD",
    "TREE",
    "WATER",
    "ROAD_BRIDGE",
    "PEDESTRIAN_BRIDGE",
    "WATER_BRIDGE",
    "COVERED_ROAD",
];

/**
 * IGN RGE ALTI (metre-scale relief over France), laid over the global Terrarium
 * DTM. Nodata is discarded, so outside France the global terrain shows through.
 */
export const IGN_DTM = {
    name: "IGN RGE ALTI",
    /** WMTS capabilities: the engine works out the tile URLs itself. */
    capabilities:
        "https://data.geopf.fr/annexes/ressources/wmts/altimetrie.xml",
    layer: "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES",
    /** Band-interleaved 32-bit floats… */
    sourceFormat: "image/x-bil;bits=32",
    /** …served without a usable media type, so it is declared here. */
    mimeTypeOverride:
        "image/x.raw;width=256;height=256;channels=1;bit_width=32;interleaving=line",
    nodata: -99999,
    attribution:
        "Institut national de l'information géographique et forestière",
};

/** Terrarium-encoded global DTM tiles. */
export const TERRARIUM_DTM_URL =
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
/**
 * Resident DTM tile cache (tiles), or 0 for the engine default. The web default
 * relies on the HTTP cache, so `getTerrainElevation` only sees tiles needed for
 * rendering and returns coarse or null samples. Crash detection, the AGL readout
 * and holding a hovering vehicle above the ground all depend on these queries.
 */
export const DTM_TILE_CACHE_SIZE = 256;

/** OpenMapTiles vector tiles (data.gouv.fr): place names, peaks, water, roads. */
export const PLACES_MVT_URL =
    "https://openmaptiles.data.gouv.fr/data/planet-vector/{z}/{x}/{y}.pbf";
export const PLACES_SOURCE_LAYER = "place";
export const PLACES_MAX_LEVEL = 14;
/** Label font (Roboto, Apache-2.0, in public/fonts). */
export const PLACE_LABEL_FONT_URL = asset("fonts/Roboto-Medium.ttf");
/** Pixels a label is lifted above its ground point (a leader line bridges the gap). */
export const PLACE_LABEL_RAISE_PX = 40;
/** Gap (px) between the top of the leader line and the text. */
export const PLACE_LABEL_GAP_PX = 2;
export const PLACE_LABEL_FONT_PX = { city: 21, town: 16, village: 9 };
export const PLACE_DOT_RADIUS_PX = { city: 8, town: 6, village: 4 };

/** Collision priority per label kind: higher wins when labels overlap. */
export const LABEL_PRIORITY = {
    city: 30,
    town: 25,
    village: 20,
    peakMajor: 22,
    peakMid: 16,
    peakMinor: 12,
    lake: 16,
    pass: 10,
};

// Natural-feature labels: italic, per map convention.
export const PEAK_LABEL_FONT_URL = asset("fonts/Roboto-MediumItalic.ttf");
export const PEAK_LABEL_COLOR = { r: 0.93, g: 0.8, b: 0.52 };
/** Peak name size (px) by prominence tier. */
export const PEAK_LABEL_FONT_PX = { high: 15, mid: 12, low: 10 };
/** Max OpenMapTiles `rank` (1 = most prominent) for each size tier. */
export const PEAK_RANK_MAX = { high: 1, mid: 3 };
export const PEAK_ELE_FONT_PX = 8;
export const PEAK_DOT_RADIUS_PX = 4;

export const PASS_LABEL_COLOR = { r: 0.6, g: 0.85, b: 0.95 };
export const PASS_LABEL_FONT_PX = 11;
export const PASS_DOT_RADIUS_PX = 4;

export const WATER_LABEL_COLOR = { r: 0.45, g: 0.62, b: 0.98 };
export const WATER_LABEL_FONT_PX = 12;
export const WATER_DOT_RADIUS_PX = 4;

/** Sun: `dayOfYear` 172 is the summer solstice. Times are local solar hours. */
export const SUN = {
    dayOfYear: 172,
    initialLocalSolarTime: 14,
};

/**
 * Terrain crash detection, from the ground elevation under the vehicle. The query
 * reads cached tiles only and may return nothing, in which case the check is skipped.
 */
export const CRASH = {
    /** Crash when height above ground falls below this (m). */
    clearanceM: 3,
    /** Ground sampling interval (ms). */
    queryIntervalMs: 16,
    /** Height above ground (m) the plane respawns at. */
    resetClearanceM: 400,
};

/** Radio altimeter: hidden above the ceiling, amber at caution, red at warning (m AGL). */
export const GPWS = {
    displayCeilingM: 1000,
    cautionAglM: 400,
    warningAglM: 150,
};

/**
 * After a jump the DTM is still streaming in. For `durationMs`, crash detection is
 * suspended and the plane eases toward `arrivalAglM`, never below `clearanceM`.
 */
export const TERRAIN_SETTLE = {
    durationMs: 4000,
    clearanceM: 150,
    arrivalAglM: 500,
    /** Ease rate (1/s). */
    response: 3.0,
};

/**
 * Arcade flight model: a point mass with an angle-of-attack lift curve.
 * Lift = liftK · v² · Cl(α), α = pitch − flight-path angle + trim. Cl rises with α
 * up to the stall angle, then collapses.
 */
export const FLIGHT = {
    gravity: 9.81,

    startSpeedMps: 120, // ~430 km/h
    startThrottle: 0.4,
    /** Altitude floor and ceiling above the ellipsoid (m). */
    minAltitude: 0,
    maxAltitude: 9000,
    /** Floor on forward airspeed, keeps the math well-behaved. */
    minForwardSpeed: 6,

    // Level cruise at throttle t solves t·thrustAccelMax = dragK·v².
    thrustAccelMax: 8, // m/s² at full throttle
    dragK: 0.000222, // 1/m
    throttleRate: 0.4, // throttle units per second while held

    // Air density σ(h) = exp(-h / scale height) scales lift, drag and thrust,
    // giving a soft service ceiling.
    densityScaleHeightM: 8500,

    // liftK balances weight at startSpeed, α = alphaTrim and START's altitude.
    // Recalibrate if START.altitude changes a lot.
    liftK: 0.0037,
    clAlphaPerRad: 5.0,
    alphaTrimRad: 0.05,
    alphaStallRad: 0.3, // ~17°
    postStallSlope: 4.0, // Cl drop per rad past the stall
    clMin: 0.15,
    maxLiftG: 8,

    maxPitchRad: 0.9, // ~51°
    maxBankRad: 1.2, // ~69°
    // Assist mode: ease toward the commanded attitude (1/s)…
    pitchResponse: 2.5,
    bankResponse: 3.0,
    // …and back to level, more slowly, on release.
    pitchCenterResponse: 1.0,
    bankCenterResponse: 1.2,
    // Manual mode: attitude rates while held; it stays put on release.
    pitchRateRadPerSec: 0.7,
    bankRateRadPerSec: 0.9,
};

/** Camera settings shared by all vehicles (distances and tilt are per vehicle). */
export const CAMERA = {
    /** Distance change per wheel notch (m). */
    zoomStep: 25,
    /** Zoom speed while +/- is held (m/s). */
    zoomRateMps: 140,
    /** Camera bearing relative to the heading (rad); 0 is behind, looking forward. */
    bearingOffsetRad: 0,

    /** Drag to orbit the view; it eases back after release. */
    look: {
        sensitivityRadPerPx: 0.005,
        /** Clamp on the tilt offset (rad). Yaw is unbounded. */
        maxPitchRad: 1.0,
        yawSign: 1,
        pitchSign: -1,
        /** Pause after release before recentring (ms). */
        returnDelayMs: 600,
        /** Recentring ease rate (1/s). */
        returnResponse: 2.5,
        /** Clamp on the resulting chase tilt (rad). */
        minTilt: 0.2,
        maxTilt: Math.PI - 0.2,
    },

    /**
     * Cockpit camera. plane.glb's nose is 8 m ahead of its origin, so 9 m puts
     * the eye just clear of it. The engine camera has no roll.
     */
    cockpit: {
        forwardOffsetM: 9,
        upOffsetM: 1.5,
    },
};

/** Height of the attributions bar (px), pushed into CSS as `--attrib-h`. */
export const UI = {
    attributionBarPx: 22,
};

/**
 * Opening scene: an id, a 0-based index, or "last". `?scene=…` overrides it.
 */
export const START_SCENE: string | number = 0;

/**
 * Least time (ms) a scene holds the screen before its path may hand over: guards
 * against a path that reports itself finished immediately.
 */
export const SCENE_MIN_DWELL_MS = 4000;

/**
 * Black curtain across automatic scene changes (not manual ones, where it would
 * read as lag): fade out, hold while the first tiles arrive, fade in.
 */
export const SCENE_FADE = {
    outMs: 700,
    holdMs: 1000,
    inMs: 900,
};

/** Unattended recovery back to the tour. */
export const AUTO_RESET = {
    /** Crash overlay wait before the demo restarts itself (ms). */
    crashDelayMs: 30000,
    /** Input idle time while flying manually that triggers a restart (ms). */
    idleDelayMs: 60000,
    /** Warning toast lead time before that restart (ms). */
    idleWarnMs: 20000,
};
