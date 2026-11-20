// Horizon engine wiring: backend init and message pump, the layers, scene views,
// and the per-frame model and camera updates.

import { HrzApi } from "@siradel-oss/horizon-api";
import {
    HrzCoreBackend,
    type HrzCoreRuntimeFile,
} from "@siradel-oss/horizon-core";
import coreJsUrl from "@siradel-oss/horizon-core/dist/hrz_core.js?url";
import coreWasmUrl from "@siradel-oss/horizon-core/dist/hrz_core.wasm?url";
import { HrzProtocol } from "@siradel-oss/horizon-protocol";
import { PHONE } from "./device";

import {
    CAMERA,
    DTM_TILE_CACHE_SIZE,
    RENNES,
    RENNES_FLAT_TYPES,
    RENNES_TYPE_COLORS,
    ROAD_LABELS,
    PEAK_DOT_RADIUS_PX,
    LABEL_PRIORITY,
    PEAK_ELE_FONT_PX,
    PEAK_LABEL_COLOR,
    PEAK_LABEL_FONT_PX,
    PEAK_LABEL_FONT_URL,
    PEAK_RANK_MAX,
    PASS_DOT_RADIUS_PX,
    PASS_LABEL_COLOR,
    PASS_LABEL_FONT_PX,
    PLACE_DOT_RADIUS_PX,
    PLACE_LABEL_FONT_PX,
    PLACE_LABEL_FONT_URL,
    PLACE_LABEL_GAP_PX,
    PLACE_LABEL_RAISE_PX,
    MINIMAP,
    PLACES_MAX_LEVEL,
    PLACES_MVT_URL,
    PLACES_SOURCE_LAYER,
    SUN,
    TERRARIUM_DTM_URL,
    WATER_DOT_RADIUS_PX,
    WATER_LABEL_COLOR,
    WATER_LABEL_FONT_PX,
} from "./config";
import { stepPosition, type Quat } from "./math";
import type { PlaneState } from "./plane";
import type { Vehicle } from "./vehicles";

const GLOBAL_BOUNDS = { west: -180, south: -90, east: 180, north: 90 };

/**
 * Vector data layer ids. A tiles layer binds to its data by this number, so ids
 * must be unique across the scene: a duplicate silently binds to the wrong data.
 */
const DATA_LAYER_IDS = {
    places: 1,
    peaks: 2,
    passes: 3,
    waterNames: 4,
    minimapWater: 5,
    minimapRivers: 6,
    minimapBorders: 7,
    minimapRoads: 8,
    minimapBuildings: 9,
    roadNames: 26,
    rennesBuildings: 30,
} as const;

const PLACES_DATA_LAYER_ID = DATA_LAYER_IDS.places;
const PLACES_ATTR_NAME = 1;
const PLACES_ATTR_CLASS = 2;

// Scene views: the full-screen flight view is view 0; the minimap is view 1,
// composited on top. Layers pick views with a bitset (bit 0 = view 0).
const MAIN_VIEW = HrzProtocol.SceneViewIndex.SCENE_VIEW_0;
const MAIN_CAMERA = HrzProtocol.CameraIndex.CAMERA_0;
const MAIN_BITS = { bits: 1 };

const MINIMAP_VIEW = HrzProtocol.SceneViewIndex.SCENE_VIEW_1;
const MINIMAP_CAMERA = HrzProtocol.CameraIndex.CAMERA_1;
const MINIMAP_BITS = { bits: 2 };

/** Full-canvas normalized rectangle. */
const FULL_RECT = { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };
/** Empty scissor: hides a view's output. */
const ZERO_RECT = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

/** Vertical field of view (degrees). CAMERA_1 has no default and renders black without it. */
const CAMERA_FOVY = 70;

/** Scene-wide raster LOD tolerance (px). It also drives DTM refinement. */
const RASTER_MAX_SSE = 1.33;

interface ViewLightOpts {
    lighting: boolean;
    shadows: boolean;
    /** Simulated (vs static) sky, sun and ambient. */
    simulated: boolean;
}
const MAIN_LIGHT: ViewLightOpts = {
    lighting: true,
    shadows: true,
    simulated: true,
};
const MINIMAP_LIGHT: ViewLightOpts = {
    lighting: false,
    shadows: false,
    simulated: false,
};
/** Lit and shadowed, but with a static sky. */
const MODEL_LIGHT: ViewLightOpts = {
    lighting: true,
    shadows: true,
    simulated: false,
};

/** Static sky for the model look. */
const MODEL_SKY_COLOR = { r: 0.8, g: 0.886, b: 0.918, a: 1 };

function lightingFlags(o: ViewLightOpts) {
    return {
        enableLighting: o.lighting,
        castShadows: o.shadows,
        receiveShadows: o.shadows,
    };
}

/**
 * Terrain settings a view needs (a fresh view has none and renders black).
 * `flat` ignores every DTM in this view: under a nadir camera relief only shows
 * as parallax that shifts labels off their position.
 */
function viewTerrain(
    o: ViewLightOpts,
    flat = false,
): HrzProtocol.ITerrainSettings {
    return {
        terrainOpacity: 1,
        clipId: -1,
        lighting: lightingFlags(o),
        terrainColor: { b: 1, a: 1 },
        disableTerrainElevation: flat,
    };
}

/**
 * How a scene is lit.
 *  - `realistic`: simulated sun, sky and shadows.
 *  - `model`: a flat static sky, but the ground and buildings lit by a fixed sun,
 *    so a block model keeps its shading.
 */
export type SceneLook = "realistic" | "model";

export function setMainViewLook(
    api: HrzApi.AsyncApi,
    look: SceneLook,
    /** Ground colour where nothing is drawn on it. */
    terrainColor?: HrzProtocol.IColor,
): void {
    const opts = look === "model" ? MODEL_LIGHT : MAIN_LIGHT;
    const terrain = viewTerrain(opts);
    if (terrainColor) terrain.terrainColor = terrainColor;
    void sceneView().terrain().set(api, terrain);
    const ambient =
        look === "model" ? modelAmbient(MODEL_SKY_COLOR) : viewAmbient(opts);
    void sceneView().ambient().set(api, ambient);
}

/** Show or hide an imagery raster layer. */
export function setImageryVisible(
    api: HrzApi.AsyncApi,
    handle: HrzProtocol.LayerHandle,
    visible: boolean,
): void {
    void HrzApi.ImageryRasterLayerPathBuilder.create(handle)
        .visible()
        .set(api, visible);
}

/** Show or hide a vector tiles layer. */
export function setVectorTilesVisible(
    api: HrzApi.AsyncApi,
    handle: HrzProtocol.LayerHandle,
    visible: boolean,
): void {
    void HrzApi.VectorTilesLayerPathBuilder.create(handle)
        .visible()
        .set(api, visible);
}

/**
 * Ambient settings for the model look: one static sky colour, a sun placed from
 * the date, dimmed ambient so shading reads.
 *
 * `staticSpaceColor` defaults to black, so the sky beyond the atmosphere shell
 * would render black: it takes the sky colour too, with the transition pinned in
 * pixels so there is no gradient. The underground colour follows suit, or the
 * ground seen from below shows black.
 */
function modelAmbient(
    skyColor: HrzProtocol.IColor,
): HrzProtocol.IAmbientSettings {
    return {
        lighting: {
            enableLighting: true,
            castShadows: true,
            receiveShadows: true,
        },
        sunAmbientBalance: 0.5,
        lightingStrength: 1,
        sky: {
            mode: HrzProtocol.SkyMode.SKY_STATIC,
            attenuation: 0.5,
            staticAtmosphereColor: skyColor,
            staticSpaceColor: skyColor,
            staticColorTransitionStartDistance: 100000,
            staticColorTransitionEndDistance: 100000,
            staticColorTransitionDistanceUnit:
                HrzProtocol.StaticSkyColorTransitionUnit
                    .STATIC_SKY_COLOR_TRANSITION_UNIT_PIXELS,
        },
        undergroundColor: skyColor,
        sun: {
            mode: HrzProtocol.SunLightingMode.SUN_LIGHTING_STATIC,
            // From the date and hour, not an azimuth in the local frame: that one
            // follows the camera, and shadows would turn as the vehicle moves.
            solarDate: {
                solarTime: SUN.initialLocalSolarTime,
                atPrimeMeridian: false,
                dayOfYear: SUN.dayOfYear,
            },
            staticColor: { r: 1, g: 1, b: 1, a: 1 },
        },
        ambientLighting: {
            mode: HrzProtocol.AmbientLightingMode.AMBIENT_LIGHTING_STATIC,
            staticColor: { r: 0.55, g: 0.55, b: 0.55, a: 1 },
        },
    };
}

/** Ambient settings for a view; SCENE_VIEW_1 has no defaults and renders black without them. */
function viewAmbient(o: ViewLightOpts): HrzProtocol.IAmbientSettings {
    return {
        lighting: lightingFlags(o),
        sunAmbientBalance: 0.5,
        lightingStrength: 1,
        sky: {
            mode: o.simulated
                ? HrzProtocol.SkyMode.SKY_SIMULATED
                : HrzProtocol.SkyMode.SKY_STATIC,
            attenuation: 0.5,
            staticAtmosphereColor: { r: 0.8, g: 0.89, b: 0.92, a: 1 },
        },
        sun: {
            mode: o.simulated
                ? HrzProtocol.SunLightingMode.SUN_LIGHTING_SIMULATED
                : HrzProtocol.SunLightingMode.SUN_LIGHTING_STATIC,
            solarDate: {
                solarTime: SUN.initialLocalSolarTime,
                atPrimeMeridian: false,
                dayOfYear: SUN.dayOfYear,
            },
            staticColor: { r: 1, g: 1, b: 1, a: 1 },
        },
        ambientLighting: {
            mode: o.simulated
                ? HrzProtocol.AmbientLightingMode.AMBIENT_LIGHTING_SIMULATED
                : HrzProtocol.AmbientLightingMode.AMBIENT_LIGHTING_STATIC,
            staticColor: { r: 0.42, g: 0.42, b: 0.42, a: 1 },
        },
    };
}

const VIEWER_OPTIONS: HrzProtocol.IViewerOptions = {
    showLoadingScreen: false,
    // On-demand rendering: a pose is pushed every frame while flying.
    forceRender: false,
    // Event capture disabled at init can never be re-enabled, and the dev UI needs
    // it. Interactions are switched off at runtime instead (setUserInteractionsEnabled).
    disableEventsCapture: false,
    // AUTO trims flat-overlay cascades and imagery merge groups on modest hardware,
    // so ask for HIGH, except on phones.
    graphicsLevel: PHONE
        ? HrzProtocol.GraphicsLevel.GRAPHICS_LEVEL_AUTO
        : HrzProtocol.GraphicsLevel.GRAPHICS_LEVEL_HIGH,
    graphicsSettingsOverrides: {
        atmosphereEnabled: true,
        // The engine maximum: cascades decide how far a flat overlay still draws.
        flatOverlayCascadeCount: 4,
    },
};

/** Initialize the backend and resolve once the viewer is ready. */
export async function boot(
    canvas: HTMLCanvasElement,
): Promise<HrzApi.AsyncApi> {
    const api = await initBackend(canvas);
    await runPumpUntilReady(api);
    return api;
}

function initBackend(canvas: HTMLCanvasElement): Promise<HrzApi.AsyncApi> {
    return new Promise((resolve, reject) => {
        HrzCoreBackend.init(
            canvas,
            (file: HrzCoreRuntimeFile) =>
                new URL(
                    file === "hrz_core.wasm" ? coreWasmUrl : coreJsUrl,
                    import.meta.url,
                ).href,
            VIEWER_OPTIONS,
            (backend, initStatus) => {
                if (
                    initStatus !== HrzProtocol.ViewerInitStatus.INIT_SUCCESS ||
                    !backend
                ) {
                    reject(
                        new Error(`Horizon init failed (status ${initStatus})`),
                    );
                    return;
                }
                resolve(new HrzApi.AsyncApi(backend));
            },
        );
    });
}

let attributionsListener:
    ((list: HrzProtocol.Attribution.$Properties[]) => void) | null = null;

/**
 * Have the engine report the attributions of the visible layers, calling
 * `onChange` whenever the list changes. Entries carry text (possibly HTML) and/or
 * a logo URL; most data licences require all of them to be displayed.
 */
export function enableAttributions(
    api: HrzApi.AsyncApi,
    onChange: (list: HrzProtocol.Attribution.$Properties[]) => void,
): void {
    attributionsListener = onChange;
    void api.ViewerService.setAttributionEnabled({ value: true });
}

/** Start the message pump (kept running) and resolve on ViewerReadyMessage. */
function runPumpUntilReady(api: HrzApi.AsyncApi): Promise<void> {
    return new Promise((resolve) => {
        let ready = false;
        setInterval(async () => {
            const result = await api.MessageQueueService.dequeueMessages({
                maxMessageCount: 50,
            });
            for (const msg of result.messages ?? []) {
                if (!ready && msg.viewerReady != null) {
                    ready = true;
                    resolve();
                }
                if (msg.attributions != null) {
                    attributionsListener?.(msg.attributions.attributions ?? []);
                }
            }
        }, 50);
    });
}

/** Engine mouse/keyboard capture: off while flying (the page owns the camera), on for the dev UI. */
export function setUserInteractionsEnabled(
    api: HrzApi.AsyncApi,
    enabled: boolean,
): void {
    void api.ViewerService.setUserInteractionsEnabled({ value: enabled });
}

function sceneView(): HrzApi.SceneViewSettingsPathBuilder {
    return HrzApi.SceneViewSettingsPathBuilder.create(MAIN_VIEW);
}

/** Set the flight view's sun to a local solar time (hours). */
export function setSunTime(api: HrzApi.AsyncApi, hours: number): void {
    // The whole solarDate, which also switches the sun back from setSunAngles.
    void sceneView().ambient().sun().solarDate().set(api, {
        solarTime: hours,
        atPrimeMeridian: false,
        dayOfYear: SUN.dayOfYear,
    });
}

/**
 * Point the sun by azimuth and altitude in the local frame. Used for a sun pinned
 * in space: the equivalent local time wraps at midnight once a lap, and the engine
 * eases through the wrap, sweeping the sun backwards through a day. Angles have no
 * wrap (see src/sun.ts).
 */
export function setSunAngles(
    api: HrzApi.AsyncApi,
    azimuth: number,
    altitude: number,
): void {
    void sceneView().ambient().sun().angularDirection().set(api, {
        cameraFrame: HrzProtocol.AngularDirection.Frame.FRAME_ENU,
        azimuth,
        altitude,
    });
}

/**
 * Ground elevation (m) under a lat/lon from the already-loaded DTM tiles. Null when
 * the tile isn't cached (the query triggers no download): "unknown", not sea level.
 */
export async function queryGroundElevation(
    api: HrzApi.AsyncApi,
    latitude: number,
    longitude: number,
): Promise<number | null> {
    const res = await api.ViewerService.getTerrainElevation({
        position: { latitude, longitude, altitude: 0 },
    });
    return res.hasValue ? res.value : null;
}

/** Dump the live scene as JSON the engine's own tooling reads. */
export async function dumpScene(
    api: HrzApi.AsyncApi,
    name: string,
): Promise<string> {
    const dump = await api.SceneDumpService.dumpScene({ sceneName: name });
    return JSON.stringify(dump.toJSON(), null, 1);
}

/** Toggle Horizon's developer UI. Resolves to whether it is now open. */
export async function toggleDevUi(api: HrzApi.AsyncApi): Promise<boolean> {
    const result = await api.ViewerService.toggleDevUi();
    return result.value ?? false;
}

/** A Web Mercator raster tile source (see config). */
export interface RasterSpec {
    /** Layer name in the engine's dev UI. */
    name: string;
    /** Tile URL pattern with {z}/{x}/{y}. */
    url: string;
    attribution: string;
    /** Deepest level served. */
    maxLevel: number;
    /** Coverage in WGS84 degrees; no tile is requested outside it. */
    bounds: { west: number; south: number; east: number; north: number };
}

/** Drape a tiled raster over the terrain, in the main view only. */
export async function addTiledImagery(
    api: HrzApi.AsyncApi,
    spec: RasterSpec,
): Promise<SceneLayers> {
    const handle = await api.LayerService.createLayer({
        name: spec.name,
        type: HrzProtocol.LayerType.IMAGERY_RASTER,
    });

    const model: HrzProtocol.IImageryRasterLayer = {
        visible: true,
        sceneViews: MAIN_BITS,
        slot: 0,
        // The minimap's raster is in the bottom group, so toggling it never
        // reshuffles this one.
        group: HrzProtocol.RasterGroup.TOP_RASTER_GROUP,
        raster: {
            provider: {
                tiled: {
                    urlPattern: spec.url,
                    attribution: spec.attribution,
                    imageFormat: HrzProtocol.ImageFormat.SRGBA_8,
                    // A missing tile shows its blurred parent rather than a hole.
                    missingTilePolicy:
                        HrzProtocol.MissingTilePolicy.USE_LOWER_RESOLUTION,
                    geometry: {
                        projection: {
                            descriptorType:
                                HrzProtocol.SrsDescriptorType.SRID_DESCRIPTOR,
                            descriptor: "EPSG:3857",
                        },
                    },
                    tilingScheme: {
                        globalTiling: {
                            tileSize: 256,
                            levelZeroTileCountX: 1,
                            levelZeroTileCountY: 1,
                            minLevel: 0,
                            maxLevel: spec.maxLevel,
                            borderTileAspect:
                                HrzProtocol.BorderTileAspect.FULL_SIZED,
                        },
                    },
                },
            },
            sampling: {
                filtering: HrzProtocol.TextureFiltering.BILINEAR,
                alphaChannelUsage:
                    HrzProtocol.AlphaChannelUsage.IGNORE_ALPHA_CHANNEL,
                nodataHandling: HrzProtocol.NodataHandling.IGNORE_NODATA,
            },
            blending: { opacity: 1 },
            displayBounds: spec.bounds,
        },
    };

    HrzApi.ImageryRasterLayerPathBuilder.create(handle).set(api, model);
    return [handle];
}

/**
 * Town and village labels from OpenMapTiles.
 *
 * Horizon splits vector display in two: a VECTOR_DATA layer (source and
 * attributes) and a VECTOR_TILES layer that styles it, linked by a numeric id.
 * The script `fork`s so each place emits a raised label with a leader line (0)
 * and a ground dot (1).
 */
export async function addPlaceLabels(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    const ATTR_NAME = PLACES_ATTR_NAME;
    const ATTR_CLASS = PLACES_ATTR_CLASS;

    const dataHandle = await api.LayerService.createLayer({
        name: "Places",
        type: HrzProtocol.LayerType.VECTOR_DATA,
    });
    await HrzApi.VectorDataLayerPathBuilder.create(dataHandle).set(api, {
        id: PLACES_DATA_LAYER_ID,
        sources: [
            {
                hasGeometry: true,
                tiledDataProvider: {
                    urlPattern: PLACES_MVT_URL,
                    // Not the GeoJSON default: without this no tile loads.
                    format: HrzProtocol.VectorDataFormat.MVT_VECTOR_DATA,
                    layerName: PLACES_SOURCE_LAYER,
                    attribution: "© OpenMapTiles © OpenStreetMap contributors",
                    // A bare {z}/{x}/{y} URL has no TileJSON: without explicit
                    // levels and bounds the layer requests nothing.
                    minLevel: 0,
                    maxLevel: PLACES_MAX_LEVEL,
                    bounds: {
                        west: -180,
                        south: -85.0511,
                        east: 180,
                        north: 85.0511,
                    },
                },
                attributes: [
                    { id: ATTR_NAME, sourceName: "name" },
                    { id: ATTR_CLASS, sourceName: "class" },
                ],
            },
        ],
    });

    const tilesHandle = await api.LayerService.createLayer({
        name: "Place labels",
        type: HrzProtocol.LayerType.VECTOR_TILES,
    });
    await HrzApi.VectorTilesLayerPathBuilder.create(tilesHandle).set(api, {
        visible: true,
        clipId: -1,
        sceneViews: MAIN_BITS,
        staticTiles: true,
        source: { vectorDataLayerId: PLACES_DATA_LAYER_ID },
        // The default of 0 requests every tile from afar, so nothing loads.
        resolution: { maxScreenSpaceError: 2 },
        // Points have no useful Z: clamp the anchor onto the terrain.
        clamping: { method: HrzProtocol.VectorClampMode.ANCHOR, useZ: false },
        style: {
            attributes: [
                { stylingName: "place_name", vectorDataAttrId: ATTR_NAME },
                { stylingName: "place_class", vectorDataAttrId: ATTR_CLASS },
            ],
            stylingScript: `
                if (attr("place_class") == "city"
                    or attr("place_class") == "town"
                    or attr("place_class") == "village") {
                    set "label" = attr("place_name");
                    set "fontsize" = ${PLACE_LABEL_FONT_PX.village};
                    set "priority" = ${LABEL_PRIORITY.village};
                    if (attr("place_class") == "city") {
                        set "fontsize" = ${PLACE_LABEL_FONT_PX.city};
                        set "radius" = ${PLACE_DOT_RADIUS_PX.city};
                        set "priority" = ${LABEL_PRIORITY.city};
                    } elif (attr("place_class") == "town") {
                        set "fontsize" = ${PLACE_LABEL_FONT_PX.town};
                        set "radius" = ${PLACE_DOT_RADIUS_PX.town};
                        set "priority" = ${LABEL_PRIORITY.town};
                    }
                    fork { emit 0; }
                    emit 1;
                }
                discard;
            `,
            representations: [
                {
                    // 0: raised label with a leader line down to the point.
                    id: 0,
                    // Needed per representation too, or it renders in no view.
                    sceneViews: MAIN_BITS,
                    symbol: {
                        zIndex: 1,
                        clipToTile: true,
                        rootElement: {
                            anchor: {
                                positionOffset: {
                                    defaultValue: {
                                        x: 0,
                                        y: 0,
                                        z: PLACE_LABEL_RAISE_PX,
                                    },
                                },
                                positionOffsetSizeUnit:
                                    HrzProtocol.SymbolSizeUnit
                                        .SYMBOL_SIZE_IN_PIXELS,
                                positionOffsetRelativeScaling:
                                    HrzProtocol.SymbolRelativeScaling
                                        .SYMBOL_RELATIVE_SCALING_CAMERA_HEIGHT,
                                elementSizeRelativeScaling:
                                    HrzProtocol.SymbolRelativeScaling
                                        .SYMBOL_RELATIVE_SCALING_CAMERA_HEIGHT,
                                minRelativeScale: 0.8,
                                maxRelativeScale: 1.5,
                                // Overlapping labels drop out, keeping the higher priority.
                                canOverlapOtherSymbols: false,
                                hidesOtherSymbols: true,
                                isOptional: true,
                                cullingPriority: { name: "priority" },
                                child: {
                                    stack: {
                                        // Flutter-style alignment: y = 1 is the bottom.
                                        alignment: {
                                            defaultValue: { x: 0, y: 1 },
                                        },
                                        children: [
                                            {
                                                leaderLine: {
                                                    color: {
                                                        defaultValue: {
                                                            r: 1,
                                                            g: 1,
                                                            b: 1,
                                                            a: 0.9,
                                                        },
                                                    },
                                                    width: 1,
                                                },
                                            },
                                            {
                                                padding: {
                                                    bottomPadding: {
                                                        defaultValue:
                                                            PLACE_LABEL_GAP_PX,
                                                    },
                                                    child: {
                                                        text: {
                                                            text: {
                                                                name: "label",
                                                                defaultValue:
                                                                    "",
                                                            },
                                                            fontSize: {
                                                                name: "fontsize",
                                                                defaultValue:
                                                                    PLACE_LABEL_FONT_PX.town,
                                                            },
                                                            textColor: {
                                                                defaultValue: {
                                                                    r: 1,
                                                                    g: 1,
                                                                    b: 1,
                                                                    a: 1,
                                                                },
                                                            },
                                                            // Halo, in em.
                                                            outlineWidth: {
                                                                defaultValue: 0.15,
                                                            },
                                                            outlineColor: {
                                                                defaultValue: {
                                                                    r: 0,
                                                                    g: 0,
                                                                    b: 0,
                                                                    a: 0.85,
                                                                },
                                                            },
                                                            fontUrl:
                                                                PLACE_LABEL_FONT_URL,
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    // 1: ground dot.
                    id: 1,
                    sceneViews: MAIN_BITS,
                    flatOverlayPoint: {
                        color: { defaultValue: { r: 1, g: 1, b: 1, a: 1 } },
                        radius: {
                            name: "radius",
                            defaultValue: PLACE_DOT_RADIUS_PX.village,
                        },
                        radiusUnit:
                            HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                        outlineColor: {
                            defaultValue: { r: 0, g: 0, b: 0, a: 0.85 },
                        },
                        outlineWidth: { defaultValue: 2 },
                        outlineWidthUnit:
                            HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                        zIndex: 0,
                        clipToTile: true,
                    },
                },
            ],
        },
    });
    return tilesHandle;
}

/** What differs between the natural-feature label layers (peaks, passes, water). */
interface NaturalLabelSpec {
    dataLayerId: number;
    dataName: string;
    tilesName: string;
    /** MVT source-layer (mountain_peak, water_name, …). */
    sourceLayer: string;
    attributes: HrzProtocol.IVectorAttribute[];
    styleAttributes: HrzProtocol.IStylingAttributeRef[];
    /** Filters features and sets "label", "fontsize", "priority", "ele_label". */
    stylingScript: string;
    color: HrzProtocol.IColor;
    defaultNameFontPx: number;
    /** Name over an elevation line ("ele_label"), or a single line. */
    showElevation: boolean;
    defaultDotRadiusPx: number;
}

const LABEL_HALO = { r: 0, g: 0, b: 0, a: 0.85 };

/**
 * An italic label layer off an OpenMapTiles source-layer: name (and optional
 * elevation) raised over a leader line, plus a ground dot. The caller's script
 * picks the features and their size.
 */
async function addNaturalLabels(
    api: HrzApi.AsyncApi,
    spec: NaturalLabelSpec,
): Promise<HrzProtocol.LayerHandle> {
    const fill = { ...spec.color, a: 1 };
    const line = (
        nameProp: string,
        fontSize: HrzProtocol.IFloatProperty,
    ): HrzProtocol.ISymbolElement => ({
        text: {
            text: { name: nameProp, defaultValue: "" },
            fontSize,
            textColor: { defaultValue: fill },
            outlineWidth: { defaultValue: 0.15 },
            outlineColor: { defaultValue: LABEL_HALO },
            fontUrl: PEAK_LABEL_FONT_URL,
        },
    });

    const nameLine = line("label", {
        name: "fontsize",
        defaultValue: spec.defaultNameFontPx,
    });
    const content: HrzProtocol.ISymbolElement = spec.showElevation
        ? {
              flex: {
                  mainAxis: HrzProtocol.FlexAxis.FLEX_AXIS_VERTICAL,
                  crossAxisAlignment:
                      HrzProtocol.FlexCrossAxisAlignment.FLEX_CROSS_AXIS_CENTER,
                  children: [
                      nameLine,
                      line("ele_label", { defaultValue: PEAK_ELE_FONT_PX }),
                  ],
              },
          }
        : nameLine;

    const dataHandle = await api.LayerService.createLayer({
        name: spec.dataName,
        type: HrzProtocol.LayerType.VECTOR_DATA,
    });
    await HrzApi.VectorDataLayerPathBuilder.create(dataHandle).set(api, {
        id: spec.dataLayerId,
        sources: [
            {
                hasGeometry: true,
                tiledDataProvider: {
                    urlPattern: PLACES_MVT_URL,
                    format: HrzProtocol.VectorDataFormat.MVT_VECTOR_DATA,
                    layerName: spec.sourceLayer,
                    attribution: "© OpenMapTiles © OpenStreetMap contributors",
                    minLevel: 0,
                    maxLevel: PLACES_MAX_LEVEL,
                    bounds: {
                        west: -180,
                        south: -85.0511,
                        east: 180,
                        north: 85.0511,
                    },
                },
                attributes: spec.attributes,
            },
        ],
    });

    const tilesHandle = await api.LayerService.createLayer({
        name: spec.tilesName,
        type: HrzProtocol.LayerType.VECTOR_TILES,
    });
    await HrzApi.VectorTilesLayerPathBuilder.create(tilesHandle).set(api, {
        visible: true,
        clipId: -1,
        sceneViews: MAIN_BITS,
        staticTiles: true,
        source: { vectorDataLayerId: spec.dataLayerId },
        resolution: { maxScreenSpaceError: 2 },
        clamping: { method: HrzProtocol.VectorClampMode.ANCHOR, useZ: false },
        style: {
            attributes: spec.styleAttributes,
            stylingScript: spec.stylingScript,
            representations: [
                {
                    // 0: raised label with a leader line.
                    id: 0,
                    sceneViews: MAIN_BITS,
                    symbol: {
                        zIndex: 1,
                        clipToTile: true,
                        rootElement: {
                            anchor: {
                                positionOffset: {
                                    defaultValue: {
                                        x: 0,
                                        y: 0,
                                        z: PLACE_LABEL_RAISE_PX,
                                    },
                                },
                                positionOffsetSizeUnit:
                                    HrzProtocol.SymbolSizeUnit
                                        .SYMBOL_SIZE_IN_PIXELS,
                                positionOffsetRelativeScaling:
                                    HrzProtocol.SymbolRelativeScaling
                                        .SYMBOL_RELATIVE_SCALING_CAMERA_HEIGHT,
                                elementSizeRelativeScaling:
                                    HrzProtocol.SymbolRelativeScaling
                                        .SYMBOL_RELATIVE_SCALING_CAMERA_HEIGHT,
                                minRelativeScale: 0.8,
                                maxRelativeScale: 1.5,
                                canOverlapOtherSymbols: false,
                                hidesOtherSymbols: true,
                                isOptional: true,
                                cullingPriority: { name: "priority" },
                                child: {
                                    stack: {
                                        alignment: {
                                            defaultValue: { x: 0, y: 1 },
                                        },
                                        children: [
                                            {
                                                leaderLine: {
                                                    color: {
                                                        defaultValue: {
                                                            ...spec.color,
                                                            a: 0.9,
                                                        },
                                                    },
                                                    width: 1,
                                                },
                                            },
                                            {
                                                padding: {
                                                    bottomPadding: {
                                                        defaultValue:
                                                            PLACE_LABEL_GAP_PX,
                                                    },
                                                    child: content,
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    // 1: ground dot.
                    id: 1,
                    sceneViews: MAIN_BITS,
                    flatOverlayPoint: {
                        color: { defaultValue: fill },
                        radius: {
                            name: "radius",
                            defaultValue: spec.defaultDotRadiusPx,
                        },
                        radiusUnit:
                            HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                        outlineColor: { defaultValue: LABEL_HALO },
                        outlineWidth: { defaultValue: 2 },
                        outlineWidthUnit:
                            HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                        zIndex: 0,
                        clipToTile: true,
                    },
                },
            ],
        },
    });
    return tilesHandle;
}

/** Named peaks: name over elevation, sized by `rank` (prominence, 1 = major). */
export async function addPeakLabels(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    return addNaturalLabels(api, {
        dataLayerId: DATA_LAYER_IDS.peaks,
        dataName: "Peaks",
        tilesName: "Peak labels",
        sourceLayer: "mountain_peak",
        showElevation: true,
        attributes: [
            { id: 1, sourceName: "name" },
            { id: 2, sourceName: "class" },
            { id: 3, sourceName: "ele" },
            { id: 4, sourceName: "rank" },
        ],
        styleAttributes: [
            { stylingName: "peak_name", vectorDataAttrId: 1 },
            { stylingName: "peak_class", vectorDataAttrId: 2 },
            { stylingName: "peak_ele", vectorDataAttrId: 3 },
            { stylingName: "peak_rank", vectorDataAttrId: 4 },
        ],
        stylingScript: `
            if ((attr("peak_class") == "peak" or attr("peak_class") == "volcano")
                and attr("peak_name")) {
                set "label" = attr("peak_name");
                set "fontsize" = ${PEAK_LABEL_FONT_PX.low};
                set "priority" = ${LABEL_PRIORITY.peakMinor};
                if (attr("peak_rank") <= ${PEAK_RANK_MAX.high}) {
                    set "fontsize" = ${PEAK_LABEL_FONT_PX.high};
                    set "priority" = ${LABEL_PRIORITY.peakMajor};
                } elif (attr("peak_rank") <= ${PEAK_RANK_MAX.mid}) {
                    set "fontsize" = ${PEAK_LABEL_FONT_PX.mid};
                    set "priority" = ${LABEL_PRIORITY.peakMid};
                }
                if (attr("peak_ele")) { set "ele_label" = fmt("{} m", attr("peak_ele")); }
                fork { emit 0; }
                emit 1;
            }
            discard;
        `,
        color: PEAK_LABEL_COLOR,
        defaultNameFontPx: PEAK_LABEL_FONT_PX.low,
        defaultDotRadiusPx: PEAK_DOT_RADIUS_PX,
    });
}

/** Mountain passes: the `saddle` class of `mountain_peak`, name over elevation. */
export async function addPassLabels(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    return addNaturalLabels(api, {
        dataLayerId: DATA_LAYER_IDS.passes,
        dataName: "Passes",
        tilesName: "Pass labels",
        sourceLayer: "mountain_peak",
        showElevation: true,
        attributes: [
            { id: 1, sourceName: "name" },
            { id: 2, sourceName: "class" },
            { id: 3, sourceName: "ele" },
        ],
        styleAttributes: [
            { stylingName: "pass_name", vectorDataAttrId: 1 },
            { stylingName: "pass_class", vectorDataAttrId: 2 },
            { stylingName: "pass_ele", vectorDataAttrId: 3 },
        ],
        stylingScript: `
            if (attr("pass_class") == "saddle" and attr("pass_name")) {
                set "label" = attr("pass_name");
                set "fontsize" = ${PASS_LABEL_FONT_PX};
                set "priority" = ${LABEL_PRIORITY.pass};
                if (attr("pass_ele")) { set "ele_label" = fmt("{} m", attr("pass_ele")); }
                fork { emit 0; }
                emit 1;
            }
            discard;
        `,
        color: PASS_LABEL_COLOR,
        defaultNameFontPx: PASS_LABEL_FONT_PX,
        defaultDotRadiusPx: PASS_DOT_RADIUS_PX,
    });
}

/** Named lakes from `water_name`, single line. */
export async function addWaterLabels(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    return addNaturalLabels(api, {
        dataLayerId: DATA_LAYER_IDS.waterNames,
        dataName: "Water",
        tilesName: "Water labels",
        sourceLayer: "water_name",
        showElevation: false,
        attributes: [
            { id: 1, sourceName: "name" },
            { id: 2, sourceName: "class" },
        ],
        styleAttributes: [
            { stylingName: "water_name", vectorDataAttrId: 1 },
            { stylingName: "water_class", vectorDataAttrId: 2 },
        ],
        stylingScript: `
            if (attr("water_class") == "lake" and attr("water_name")) {
                set "label" = attr("water_name");
                set "fontsize" = ${WATER_LABEL_FONT_PX};
                set "priority" = ${LABEL_PRIORITY.lake};
                fork { emit 0; }
                emit 1;
            }
            discard;
        `,
        color: WATER_LABEL_COLOR,
        defaultNameFontPx: WATER_LABEL_FONT_PX,
        defaultDotRadiusPx: WATER_DOT_RADIUS_PX,
    });
}

/** Layers a scene owns, destroyed when it ends. */
export type SceneLayers = HrzProtocol.LayerHandle.$Properties[];

/** One credit: text (possibly HTML) and/or a logo. */
export type HrzAttribution = HrzProtocol.Attribution.$Properties;

export type LayerHandle = HrzProtocol.LayerHandle;

export async function destroySceneLayers(
    api: HrzApi.AsyncApi,
    layers: SceneLayers,
): Promise<void> {
    for (const handle of layers) await api.LayerService.destroyLayer(handle);
}

// --- Rennes ----------------------------------------------------------------
const ROAD_NAMES_DATA_ID = DATA_LAYER_IDS.roadNames;
const ROAD_NAMES_ATTR_NAME = 1;

/**
 * Street names laid flat along the street (see ROAD_LABELS). The engine passes
 * the line's direction at the anchor to the script (`anchorAngleAttributeName`),
 * which becomes the Y rotation; a quarter turn about X lays the text down.
 * Keep the script minimal: a failing styling script draws nothing, silently.
 */
export async function addRoadNames(
    api: HrzApi.AsyncApi,
    bits: { bits: number },
): Promise<SceneLayers> {
    const dataHandle = await api.LayerService.createLayer({
        name: "Road names data",
        type: HrzProtocol.LayerType.VECTOR_DATA,
    });
    await HrzApi.VectorDataLayerPathBuilder.create(dataHandle).set(api, {
        id: ROAD_NAMES_DATA_ID,
        sources: [
            {
                hasGeometry: true,
                tiledDataProvider: {
                    urlPattern: PLACES_MVT_URL,
                    format: HrzProtocol.VectorDataFormat.MVT_VECTOR_DATA,
                    // `transportation` carries no names; this is its labelling twin.
                    layerName: "transportation_name",
                    attribution: "© OpenMapTiles © OpenStreetMap contributors",
                    minLevel: 0,
                    maxLevel: PLACES_MAX_LEVEL,
                    bounds: GLOBAL_BOUNDS,
                },
                attributes: [
                    {
                        id: ROAD_NAMES_ATTR_NAME,
                        sourceName: "name",
                        transform:
                            HrzProtocol.AttributeTransform
                                .ATTRIBUTE_TRANSFORM_TO_STRING,
                    },
                ],
            },
        ],
    });

    const tilesHandle = await api.LayerService.createLayer({
        name: "Road names",
        type: HrzProtocol.LayerType.VECTOR_TILES,
    });
    await HrzApi.VectorTilesLayerPathBuilder.create(tilesHandle).set(api, {
        visible: true,
        clipId: -1,
        sceneViews: bits,
        staticTiles: true,
        lighting: {
            enableLighting: true,
            castShadows: true,
            receiveShadows: true,
        },
        source: { vectorDataLayerId: ROAD_NAMES_DATA_ID },
        resolution: { maxScreenSpaceError: 2 },
        clamping: { method: HrzProtocol.VectorClampMode.PER_VERTEX },
        visibilityConstraints: {},
        style: {
            attributes: [
                {
                    stylingName: "road_name",
                    vectorDataAttrId: ROAD_NAMES_ATTR_NAME,
                },
            ],
            anchorAngleAttributeName: "anchor_angle",
            stylingScript: `
                set "text" = attr("road_name");
                set "rotation_y" = attr("anchor_angle");
                emit "symbol";
            `,
            representations: [
                {
                    name: "symbol",
                    id: 0,
                    sceneViews: bits,
                    symbol: {
                        clipToTile: true,
                        rootElement: {
                            anchor: {
                                positionOffset: {
                                    defaultValue: { z: ROAD_LABELS.liftM },
                                },
                                positionOffsetSizeUnit:
                                    HrzProtocol.SymbolSizeUnit
                                        .SYMBOL_SIZE_IN_METERS,
                                // World-aligned rather than facing the camera, so it lies flat.
                                xAxisAlignment:
                                    HrzProtocol.SymbolAxisAlignment
                                        .AXIS_ALIGNMENT_WORLD,
                                yAxisAlignment:
                                    HrzProtocol.SymbolAxisAlignment
                                        .AXIS_ALIGNMENT_WORLD,
                                rotation: {
                                    name: "rotation",
                                    defaultValue: { x: Math.PI / 2 },
                                },
                                rotationOrder:
                                    HrzProtocol.EulerRotationOrder.EULER_XYZ,
                                elementAlignment: { defaultValue: {} },
                                keepUpright: true,
                                hidesOtherSymbols: true,
                                cullingPriority: {},
                                child: {
                                    text: {
                                        text: {
                                            name: "text",
                                            defaultValue: "",
                                        },
                                        fontSize: {
                                            defaultValue: ROAD_LABELS.fontPx,
                                        },
                                        textColor: {
                                            defaultValue: ROAD_LABELS.color,
                                        },
                                        outlineColor: {
                                            defaultValue:
                                                ROAD_LABELS.outlineColor,
                                        },
                                        outlineWidth: {
                                            defaultValue:
                                                ROAD_LABELS.outlineWidth,
                                        },
                                        fontUrl: PLACE_LABEL_FONT_URL,
                                        fontHttpHeaders: {},
                                        lineSpacing: {},
                                        alignment: {},
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        },
    });
    return [dataHandle, tilesHandle];
}

const RENNES_ATTR_FEATURE_ID = 9;
const RENNES_ATTR_HEIGHT = 1;
const RENNES_ATTR_TYPE = 2;
const RENNES_TYPE_PALETTE = "type_color";

/** One Geobuf tile pyramid as a data layer. */
async function addGeobufSource(
    api: HrzApi.AsyncApi,
    name: string,
    dataId: number,
    spec: {
        url: string;
        maxLevel: number;
        bounds: HrzProtocol.IGeographicBounds;
    },
    attributes: HrzProtocol.IVectorAttribute[],
): Promise<HrzProtocol.LayerHandle> {
    const handle = await api.LayerService.createLayer({
        name,
        type: HrzProtocol.LayerType.VECTOR_DATA,
    });
    await HrzApi.VectorDataLayerPathBuilder.create(handle).set(api, {
        id: dataId,
        sources: [
            {
                hasGeometry: true,
                tiledDataProvider: {
                    urlPattern: spec.url,
                    format: HrzProtocol.VectorDataFormat.GEOBUF_VECTOR_DATA,
                    attribution: RENNES.attribution,
                    minLevel: 0,
                    maxLevel: spec.maxLevel,
                    bounds: spec.bounds,
                },
                attributes: [
                    ...attributes,
                    // Lets the engine match the pieces of a feature split across tiles.
                    {
                        id: RENNES_ATTR_FEATURE_ID,
                        isSourceFeatureIds: true,
                        isFeatureId: true,
                    },
                ],
            },
        ],
    });
    return handle;
}

/** Tiles-layer source for a Geobuf pyramid, with its extent and depth stated explicitly. */
function geobufSource(
    dataId: number,
    spec: { maxLevel: number; bounds: HrzProtocol.IGeographicBounds },
): HrzProtocol.IVectorTilesSource {
    return {
        vectorDataLayerId: dataId,
        maxLevel: spec.maxLevel,
        bounds: spec.bounds,
        overrideBounds: true,
        overrideLevels: true,
    };
}

/**
 * Rennes buildings extruded to their height and coloured by `Type` through a
 * label palette. Non-building classes (woods, trees, water, bridges) are drawn
 * flat on the ground.
 */
export async function addRennesBuildings(
    api: HrzApi.AsyncApi,
    bits: { bits: number },
): Promise<SceneLayers> {
    const dataHandle = await addGeobufSource(
        api,
        "Rennes buildings data",
        DATA_LAYER_IDS.rennesBuildings,
        RENNES.buildings,
        [
            // No transform: Geobuf values are already typed, and adding
            // ATTRIBUTE_TRANSFORM_TO_NUMBER makes buildings load intermittently.
            { id: RENNES_ATTR_HEIGHT, sourceName: "ELEVATION" },
            { id: RENNES_ATTR_TYPE, sourceName: "Type" },
        ],
    );

    const flatTypes = RENNES_FLAT_TYPES.map(
        (t) => `attr("type") == "${t}"`,
    ).join(" or ");

    const tilesHandle = await api.LayerService.createLayer({
        name: "Rennes buildings",
        type: HrzProtocol.LayerType.VECTOR_TILES,
    });
    await HrzApi.VectorTilesLayerPathBuilder.create(tilesHandle).set(api, {
        visible: true,
        clipId: -1,
        sceneViews: bits,
        staticTiles: true,
        lighting: {
            enableLighting: true,
            castShadows: true,
            receiveShadows: true,
        },
        // Seat footprints on the terrain wherever it is; flat overlays drape anyway.
        clamping: { method: HrzProtocol.VectorClampMode.ANCHOR, useZ: false },
        visibilityConstraints: {},
        source: geobufSource(DATA_LAYER_IDS.rennesBuildings, RENNES.buildings),
        // Past the bottom of the pyramid every tile is "missing": USE_LOWER_RESOLUTION
        // would replace a refined layer with a coarser copy of itself.
        missingTilePolicy: HrzProtocol.MissingTilePolicy.USE_EMPTY_TILE,
        resolution: { maxScreenSpaceError: RENNES.maxScreenSpaceError },
        style: {
            attributes: [
                { stylingName: "height", vectorDataAttrId: RENNES_ATTR_HEIGHT },
                { stylingName: "type", vectorDataAttrId: RENNES_ATTR_TYPE },
            ],
            palettes: [
                {
                    name: RENNES_TYPE_PALETTE,
                    label: {
                        // Unlisted classes come out white.
                        defaultColor: { r: 1, g: 1, b: 1, a: 1 },
                        labels: Object.entries(RENNES_TYPE_COLORS).map(
                            ([label, color]) => ({
                                label,
                                color: { ...color, a: 1 },
                            }),
                        ),
                    },
                },
            ],
            // `colorize` looks the class up; `darken` derives the foot of the wall.
            stylingScript: `
                set "color" = colorize("${RENNES_TYPE_PALETTE}", attr("type"));
                if (${flatTypes}) {
                    emit "flat";
                } else {
                    set "base" = darken(prp("color"), 0.4);
                    set "extrusion" = attr("height");
                    emit "extruded";
                }
                emit "flat";
            `,
            representations: [
                {
                    name: "flat",
                    id: 0,
                    sceneViews: bits,
                    flatOverlayPolygon: {
                        color: {
                            name: "color",
                            defaultValue: RENNES.groundColor,
                        },
                        pattern: {},
                        // Under the street names.
                        zIndex: 0,
                        clipToTile: true,
                    },
                },
                {
                    name: "extruded",
                    id: 1,
                    sceneViews: bits,
                    extrudedGeometry: {
                        lighting: {
                            enableLighting: true,
                            castShadows: true,
                            receiveShadows: true,
                        },
                        extrusion: {
                            name: "extrusion",
                            defaultValue: RENNES.defaultHeightM,
                        },
                        lowerColor: {
                            name: "base",
                            defaultValue: RENNES.defaultBase,
                        },
                        upperColor: {
                            name: "color",
                            defaultValue: RENNES.defaultWall,
                        },
                        roofColor: {
                            name: "color",
                            defaultValue: RENNES.defaultRoof,
                        },
                        ...(RENNES.bevelM > 0
                            ? { bevelWidth: RENNES.bevelM }
                            : {}),
                        // No clipToTile: a building straddling a tile edge would then
                        // depend on which tile arrived first.
                    },
                },
            ],
        },
    });
    return [dataHandle, tilesHandle];
}

/** Show or hide a terrain layer; with none visible, the ground is flat at zero. */
export function setDtmVisible(
    api: HrzApi.AsyncApi,
    handle: HrzProtocol.LayerHandle.$Properties,
    visible: boolean,
): void {
    void HrzApi.DtmRasterLayerPathBuilder.create(handle)
        .visible()
        .set(api, visible);
}

/**
 * A WMTS elevation service over the global terrain, from its capabilities
 * document. Slot 1 with nodata discarded: where it has data it wins, elsewhere the
 * global terrain shows through.
 */
export async function addWmtsDtm(
    api: HrzApi.AsyncApi,
    spec: {
        name: string;
        capabilities: string;
        layer: string;
        sourceFormat: string;
        mimeTypeOverride: string;
        nodata: number;
        attribution: string;
    },
): Promise<SceneLayers> {
    const handle = await api.LayerService.createLayer({
        name: spec.name,
        type: HrzProtocol.LayerType.DTM_RASTER,
    });
    await HrzApi.DtmRasterLayerPathBuilder.create(handle).set(api, {
        visible: true,
        slot: 1,
        raster: {
            provider: {
                wmts: {
                    url: spec.capabilities,
                    httpHeaders: {},
                    layerIdentifier: spec.layer,
                    sourceImageFormat: spec.sourceFormat,
                    imageFormat: HrzProtocol.ImageFormat.R_F32,
                    mimeTypeOverride: spec.mimeTypeOverride,
                    attribution: spec.attribution,
                    nodata: {
                        hasNodata: true,
                        value: { floatValue: spec.nodata },
                    },
                },
            },
            sampling: {
                filtering: HrzProtocol.TextureFiltering.BILINEAR,
                nodataHandling:
                    HrzProtocol.NodataHandling.DISCARD_NODATA_PIXELS,
            },
            blending: { opacity: 1 },
            displayBounds: GLOBAL_BOUNDS,
        },
    });
    return [handle];
}

/**
 * The global Terrarium DTM. DTM layers have no per-view setting, so the minimap
 * ignores relief at the view level instead (`disableTerrainElevation`).
 */
export async function addTerrainDtm(
    api: HrzApi.AsyncApi,
): Promise<LayerHandle> {
    const handle = await api.LayerService.createLayer({
        name: "DTM",
        type: HrzProtocol.LayerType.DTM_RASTER,
    });

    const model: HrzProtocol.IDtmRasterLayer = {
        visible: true,
        raster: {
            provider: {
                tiled: {
                    urlPattern: TERRARIUM_DTM_URL,
                    attribution:
                        "Elevation tiles © Mapzen / AWS Terrain Tiles and data providers",
                    imageFormat: HrzProtocol.ImageFormat.TERRARIUM,
                    // USE_EMPTY_TILE would mean zero elevation: a sea-level hole.
                    missingTilePolicy:
                        HrzProtocol.MissingTilePolicy.USE_LOWER_RESOLUTION,
                    // Resident tiles keep getTerrainElevation reading fine tiles.
                    ...(DTM_TILE_CACHE_SIZE > 0
                        ? {
                              overrideTileCacheSize: true,
                              tileCacheSize: DTM_TILE_CACHE_SIZE,
                          }
                        : {}),
                    geometry: {
                        projection: {
                            descriptorType:
                                HrzProtocol.SrsDescriptorType.SRID_DESCRIPTOR,
                            descriptor: "EPSG:3857",
                        },
                    },
                    tilingScheme: {
                        globalTiling: {
                            tileSize: 256,
                            levelZeroTileCountX: 1,
                            levelZeroTileCountY: 1,
                            minLevel: 0,
                            maxLevel: 15,
                            borderTileAspect:
                                HrzProtocol.BorderTileAspect.FULL_SIZED,
                        },
                    },
                },
            },
            sampling: {
                filtering: HrzProtocol.TextureFiltering.BILINEAR,
                alphaChannelUsage:
                    HrzProtocol.AlphaChannelUsage.IGNORE_ALPHA_CHANNEL,
                nodataHandling: HrzProtocol.NodataHandling.SET_NODATA_TO_ZERO,
            },
            blending: { opacity: 1 },
            displayBounds: GLOBAL_BOUNDS,
        },
    };

    HrzApi.DtmRasterLayerPathBuilder.create(handle).set(api, model);
    return handle;
}

/**
 * Load a vehicle model. `frame` names the glTF's own axes; orientation in the
 * local tangent frame then comes from the rotation quaternion each frame.
 */
export async function addVehicleModel(
    api: HrzApi.AsyncApi,
    vehicle: Vehicle,
    plane: PlaneState,
    initialRotation: Quat,
): Promise<HrzProtocol.LayerHandle> {
    const handle = await api.LayerService.createLayer({
        name: vehicle.name,
        type: HrzProtocol.LayerType.SINGLE_MODEL,
    });

    const model: HrzProtocol.ISingleModelLayer = {
        visible: true,
        url: vehicle.modelUrl,
        attribution: vehicle.attribution,
        sceneViews: MAIN_BITS,
        clampToGround: false,
        // proto3 zero defaults would make the model transparent, unlit and clipped.
        color: { r: 1, g: 1, b: 1, a: 1 },
        clipId: -1,
        lighting: {
            enableLighting: true,
            castShadows: true,
            receiveShadows: true,
        },
        // Animation time = (global_time + phase) * speed.
        animation: {
            speed: vehicle.animationSpeed,
            phase: 0,
            enabledAnimations: vehicle.animations,
        },
        geographic: {
            latitude: plane.latitude,
            longitude: plane.longitude,
            altitude: plane.altitude,
        },
        transform: {
            offset: { x: 0, y: 0, z: 0 },
            scale: { x: vehicle.scale, y: vehicle.scale, z: vehicle.scale },
            rotation: initialRotation,
            frame: {
                up: HrzProtocol.Axis[vehicle.frame.up],
                front: HrzProtocol.Axis[vehicle.frame.front],
                handedness: HrzProtocol.Handedness[vehicle.frame.handedness],
            },
        },
    };

    await HrzApi.SingleModelLayerPathBuilder.create(handle).set(api, model);
    return handle;
}

/** Per-frame update of the model's position and orientation only. */
export function updatePlaneModel(
    api: HrzApi.AsyncApi,
    handle: HrzProtocol.LayerHandle,
    plane: PlaneState,
    rotation: Quat,
): void {
    void HrzApi.SingleModelLayerPathBuilder.create(handle)
        .geographic()
        .set(api, {
            latitude: plane.latitude,
            longitude: plane.longitude,
            altitude: plane.altitude,
        });
    void HrzApi.SingleModelLayerPathBuilder.create(handle)
        .transform()
        .rotation()
        .set(api, rotation);
}

/** Set propeller/rotor spin speed (0 freezes them on pause). */
export function setPropellerSpeed(
    api: HrzApi.AsyncApi,
    handle: HrzProtocol.LayerHandle,
    vehicle: Vehicle,
    speed: number,
): void {
    if (vehicle.animations.length === 0) return;
    void HrzApi.SingleModelLayerPathBuilder.create(handle)
        .animation()
        .set(api, {
            speed,
            phase: 0,
            enabledAnimations: vehicle.animations,
        });
}

/**
 * Snap the chase camera behind the vehicle. `lookYaw`/`lookPitch` add the
 * mouse-look offset; `baseTilt` is 0 straight down, PI/2 the horizon.
 */
export function updateCamera(
    api: HrzApi.AsyncApi,
    plane: PlaneState,
    distance: number,
    lookYaw: number,
    lookPitch: number,
    baseTilt: number,
): void {
    // The look clamp must never push the tilt above a steeper base tilt.
    const lowerTilt = Math.min(CAMERA.look.minTilt, baseTilt);
    const tilt = Math.min(
        CAMERA.look.maxTilt,
        Math.max(lowerTilt, baseTilt + lookPitch),
    );
    api.CameraService.setFixedTarget({
        cameraIndex: MAIN_CAMERA,
        angularViewpoint: {
            target: {
                latitude: plane.latitude,
                longitude: plane.longitude,
                altitude: plane.altitude,
            },
            bearing: plane.heading + CAMERA.bearingOffsetRad + lookYaw,
            tilt,
            distance,
        },
        altitudeMode: HrzProtocol.AltitudeMode.RELATIVE_TO_ELLIPSOID,
        // Per-vehicle limits are enforced page-side.
        minDistance: 1,
        maxDistance: 1e7,
        minTilt: 0,
        maxTilt: Math.PI,
        // No goToAnimation: the camera snaps and tracks exactly.
    });
}

/** First-person camera near the nose, plus the mouse-look offset. */
export function updateCockpitCamera(
    api: HrzApi.AsyncApi,
    plane: PlaneState,
    lookYaw: number,
    lookPitch: number,
): void {
    const eye = stepPosition(
        plane,
        plane.heading,
        CAMERA.cockpit.forwardOffsetM,
    );
    api.CameraService.setFixedPosition({
        cameraIndex: MAIN_CAMERA,
        pose: {
            position: {
                latitude: eye.latitude,
                longitude: eye.longitude,
                altitude: plane.altitude + CAMERA.cockpit.upOffsetM,
            },
            bearing: plane.heading + lookYaw,
            // 0 = horizon, positive = up. The flight-path angle (not pitch) follows
            // where the plane is actually going, stalls included.
            tilt: plane.flightPathAngle + lookPitch,
        },
        altitudeMode: HrzProtocol.AltitudeMode.RELATIVE_TO_ELLIPSOID,
        minTilt: -Math.PI / 2,
        maxTilt: Math.PI,
    });
}

// --- Minimap (second scene view) -------------------------------------------

/** Normalized on-canvas rectangle: (0,0) top-left, (1,1) bottom-right. */
export interface MinimapRect {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
}

/**
 * Configure both scene views: the lit flight view full-screen, and the minimap
 * (flat, unlit, static sky) in `rect`. Each view needs its own camera fov,
 * terrain and ambient, or it renders black.
 */
export async function initViews(
    api: HrzApi.AsyncApi,
    rect: MinimapRect,
): Promise<void> {
    await HrzApi.CameraSettingsPathBuilder.create(MAIN_CAMERA).set(api, {
        fovy: CAMERA_FOVY,
    });
    await HrzApi.CameraSettingsPathBuilder.create(MINIMAP_CAMERA).set(api, {
        fovy: CAMERA_FOVY,
    });

    await HrzApi.SceneSettingsPathBuilder.create()
        .activeViews()
        .set(api, { bits: 3 });
    await HrzApi.SceneSettingsPathBuilder.create()
        .mainView()
        .set(api, MAIN_VIEW);

    // The DTM is a raster too: this also sets when the terrain refines, which
    // clamped geometry is placed from. The engine default is 2.
    await HrzApi.SceneSettingsPathBuilder.create()
        .raster()
        .maxScreenSpaceError()
        .set(api, RASTER_MAX_SSE);

    await HrzApi.SceneViewSettingsPathBuilder.create(MAIN_VIEW).set(api, {
        camera: MAIN_CAMERA,
        terrain: viewTerrain(MAIN_LIGHT),
        ambient: viewAmbient(MAIN_LIGHT),
        viewport: { viewport: FULL_RECT, scissor: FULL_RECT },
    });
    await HrzApi.SceneViewSettingsPathBuilder.create(MINIMAP_VIEW).set(api, {
        camera: MINIMAP_CAMERA,
        terrain: viewTerrain(MINIMAP_LIGHT, true),
        ambient: viewAmbient(MINIMAP_LIGHT),
        // Full-canvas scissor; only the viewport is the corner.
        viewport: { viewport: rect, scissor: FULL_RECT },
    });
}

/** Place the minimap viewport; hidden, its scissor collapses to nothing. */
export function setMinimapViewport(
    api: HrzApi.AsyncApi,
    rect: MinimapRect,
    visible: boolean,
): void {
    void HrzApi.SceneViewSettingsPathBuilder.create(MINIMAP_VIEW)
        .viewport()
        .set(api, { viewport: rect, scissor: visible ? FULL_RECT : ZERO_RECT });
}

/**
 * Add or remove the minimap view from the active set. Toggling makes the main view
 * reload its imagery, but while a second view is active, main-view flat overlays
 * only draw in the finest cascade, which hides distant ones.
 */
export function setMinimapActive(api: HrzApi.AsyncApi, active: boolean): void {
    void HrzApi.SceneSettingsPathBuilder.create()
        .activeViews()
        .set(api, { bits: active ? 3 : 1 });
}

/** Point the minimap camera straight down, north-up, from `rangeM` above the target. */
export function updateMinimapCamera(
    api: HrzApi.AsyncApi,
    latitude: number,
    longitude: number,
    targetAltitude: number,
    rangeM: number,
): void {
    api.CameraService.setFixedTarget({
        cameraIndex: MINIMAP_CAMERA,
        angularViewpoint: {
            target: { latitude, longitude, altitude: targetAltitude },
            bearing: 0,
            tilt: 0,
            distance: rangeM,
        },
        altitudeMode: HrzProtocol.AltitudeMode.RELATIVE_TO_ELLIPSOID,
        minDistance: MINIMAP.minRangeM,
        maxDistance: MINIMAP.maxRangeM,
        minTilt: 0,
        maxTilt: 0,
    });
}

/** Minimap base map: the Terrarium tiles coloured by a hypsometric palette. */
export async function addMinimapElevation(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    const handle = await api.LayerService.createLayer({
        name: "Minimap elevation",
        type: HrzProtocol.LayerType.IMAGERY_RASTER,
    });

    const colorStops = MINIMAP.elevationPalette.map((s) => {
        const color = { r: s.r, g: s.g, b: s.b, a: 1 };
        // Same colour on both sides of a stop: a smooth ramp, no band.
        return { value: s.value, firstColor: color, secondColor: color };
    });

    const model: HrzProtocol.IImageryRasterLayer = {
        visible: true,
        sceneViews: MINIMAP_BITS,
        // Separate group from the main imagery, so toggling it never reshuffles it.
        group: HrzProtocol.RasterGroup.BOTTOM_RASTER_GROUP,
        raster: {
            provider: {
                palettized: {
                    provider: {
                        tiled: {
                            urlPattern: TERRARIUM_DTM_URL,
                            attribution:
                                "Elevation tiles © Mapzen / AWS Terrain Tiles and data providers",
                            imageFormat: HrzProtocol.ImageFormat.TERRARIUM,
                            missingTilePolicy:
                                HrzProtocol.MissingTilePolicy.USE_EMPTY_TILE,
                            geometry: {
                                projection: {
                                    descriptorType:
                                        HrzProtocol.SrsDescriptorType
                                            .SRID_DESCRIPTOR,
                                    descriptor: "EPSG:3857",
                                },
                            },
                            tilingScheme: {
                                globalTiling: {
                                    tileSize: 256,
                                    levelZeroTileCountX: 1,
                                    levelZeroTileCountY: 1,
                                    minLevel: 0,
                                    maxLevel: 15,
                                    borderTileAspect:
                                        HrzProtocol.BorderTileAspect.FULL_SIZED,
                                },
                            },
                        },
                    },
                    palette: {
                        colorStops,
                        interpolationMode:
                            HrzProtocol.ColorInterpolationMode.LINEAR_SRGB,
                    },
                },
            },
            sampling: {
                filtering: HrzProtocol.TextureFiltering.BILINEAR,
                alphaChannelUsage:
                    HrzProtocol.AlphaChannelUsage.IGNORE_ALPHA_CHANNEL,
                nodataHandling: HrzProtocol.NodataHandling.IGNORE_NODATA,
            },
            blending: { opacity: 1 },
            displayBounds: GLOBAL_BOUNDS,
        },
    };

    HrzApi.ImageryRasterLayerPathBuilder.create(handle).set(api, model);
    return handle;
}

/** Minimap city and town labels, styled over the same "Places" data as the main view. */
export async function addMinimapPlaceLabels(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    const handle = await api.LayerService.createLayer({
        name: "Minimap places",
        type: HrzProtocol.LayerType.VECTOR_TILES,
    });
    await HrzApi.VectorTilesLayerPathBuilder.create(handle).set(api, {
        visible: true,
        clipId: -1,
        sceneViews: MINIMAP_BITS,
        staticTiles: true,
        source: { vectorDataLayerId: PLACES_DATA_LAYER_ID },
        resolution: { maxScreenSpaceError: 2 },
        clamping: { method: HrzProtocol.VectorClampMode.ANCHOR, useZ: false },
        style: {
            attributes: [
                {
                    stylingName: "place_name",
                    vectorDataAttrId: PLACES_ATTR_NAME,
                },
                {
                    stylingName: "place_class",
                    vectorDataAttrId: PLACES_ATTR_CLASS,
                },
            ],
            stylingScript: `
                if (attr("place_class") == "city" or attr("place_class") == "town") {
                    set "label" = attr("place_name");
                    set "fontsize" = ${MINIMAP.townFontPx};
                    if (attr("place_class") == "city") {
                        set "fontsize" = ${MINIMAP.cityFontPx};
                    }
                    fork { emit 0; }
                    emit 1;
                }
                discard;
            `,
            representations: [
                {
                    // 0: dot, above the other minimap overlays.
                    id: 0,
                    sceneViews: MINIMAP_BITS,
                    flatOverlayPoint: {
                        color: { defaultValue: { r: 1, g: 1, b: 1, a: 1 } },
                        radius: { defaultValue: MINIMAP.dotRadiusPx },
                        radiusUnit:
                            HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                        outlineColor: {
                            defaultValue: { r: 0, g: 0, b: 0, a: 0.85 },
                        },
                        outlineWidth: { defaultValue: 1.5 },
                        outlineWidthUnit:
                            HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                        zIndex: 20,
                        clipToTile: true,
                    },
                },
                {
                    // 1: name above the dot, fixed pixel size.
                    id: 1,
                    sceneViews: MINIMAP_BITS,
                    symbol: {
                        zIndex: 21,
                        clipToTile: true,
                        ignoreWorldOcclusions: true,
                        rootElement: {
                            anchor: {
                                // Screen-space pixels: −y is up.
                                positionOffset: {
                                    defaultValue: {
                                        x: 0,
                                        y: -MINIMAP.labelOffsetPx,
                                        z: 0,
                                    },
                                },
                                positionOffsetSizeUnit:
                                    HrzProtocol.SymbolSizeUnit
                                        .SYMBOL_SIZE_IN_PIXELS,
                                canOverlapOtherSymbols: false,
                                hidesOtherSymbols: true,
                                isOptional: true,
                                child: {
                                    text: {
                                        text: {
                                            name: "label",
                                            defaultValue: "",
                                        },
                                        fontSize: {
                                            name: "fontsize",
                                            defaultValue: MINIMAP.townFontPx,
                                        },
                                        textColor: {
                                            defaultValue: {
                                                r: 1,
                                                g: 1,
                                                b: 1,
                                                a: 1,
                                            },
                                        },
                                        outlineWidth: { defaultValue: 0.18 },
                                        outlineColor: {
                                            defaultValue: {
                                                r: 0,
                                                g: 0,
                                                b: 0,
                                                a: 0.9,
                                            },
                                        },
                                        fontUrl: PLACE_LABEL_FONT_URL,
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        },
    });
    return handle;
}

/** A minimap-only data + tiles pair off one OpenMapTiles source-layer, as flat overlays. */
async function addMinimapVectorLayer(
    api: HrzApi.AsyncApi,
    spec: {
        name: string;
        dataLayerId: number;
        sourceLayer: string;
        attributes: HrzProtocol.IVectorAttribute[];
        styleAttributes: HrzProtocol.IStylingAttributeRef[];
        stylingScript: string;
        representations: HrzProtocol.IVectorRepr[];
        /** Only visible while the camera is below this altitude (m). */
        visibleBelowM?: number;
    },
): Promise<HrzProtocol.LayerHandle> {
    const dataHandle = await api.LayerService.createLayer({
        name: `${spec.name} data`,
        type: HrzProtocol.LayerType.VECTOR_DATA,
    });
    await HrzApi.VectorDataLayerPathBuilder.create(dataHandle).set(api, {
        id: spec.dataLayerId,
        sources: [
            {
                hasGeometry: true,
                tiledDataProvider: {
                    urlPattern: PLACES_MVT_URL,
                    format: HrzProtocol.VectorDataFormat.MVT_VECTOR_DATA,
                    layerName: spec.sourceLayer,
                    attribution: "© OpenMapTiles © OpenStreetMap contributors",
                    minLevel: 0,
                    maxLevel: PLACES_MAX_LEVEL,
                    bounds: {
                        west: -180,
                        south: -85.0511,
                        east: 180,
                        north: 85.0511,
                    },
                },
                attributes: spec.attributes,
            },
        ],
    });

    const tilesHandle = await api.LayerService.createLayer({
        name: spec.name,
        type: HrzProtocol.LayerType.VECTOR_TILES,
    });
    await HrzApi.VectorTilesLayerPathBuilder.create(tilesHandle).set(api, {
        visible: true,
        clipId: -1,
        sceneViews: MINIMAP_BITS,
        staticTiles: true,
        source: { vectorDataLayerId: spec.dataLayerId },
        resolution: { maxScreenSpaceError: 2 },
        visibilityConstraints:
            spec.visibleBelowM === undefined
                ? undefined
                : {
                      constraints: [
                          {
                              altitude: {
                                  relativePosition:
                                      HrzProtocol.RelativePositionQualifier
                                          .BELOW,
                                  altitude: spec.visibleBelowM,
                              },
                          },
                      ],
                  },
        style: {
            attributes: spec.styleAttributes,
            stylingScript: spec.stylingScript,
            representations: spec.representations,
        },
    });
    return tilesHandle;
}

/** Minimap water bodies (`water`). */
export async function addMinimapWater(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    return addMinimapVectorLayer(api, {
        name: "Minimap water",
        dataLayerId: DATA_LAYER_IDS.minimapWater,
        sourceLayer: "water",
        attributes: [],
        styleAttributes: [],
        stylingScript: `emit 0;`,
        representations: [
            {
                id: 0,
                sceneViews: MINIMAP_BITS,
                flatOverlayPolygon: {
                    // Above the rivers, so estuaries cover the river line.
                    color: { defaultValue: MINIMAP.waterFillColor },
                    zIndex: 1,
                    clipToTile: true,
                },
            },
        ],
    });
}

/** Minimap rivers and streams (`waterway`); ditches and drains are dropped. */
export async function addMinimapRivers(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    return addMinimapVectorLayer(api, {
        name: "Minimap rivers",
        dataLayerId: DATA_LAYER_IDS.minimapRivers,
        sourceLayer: "waterway",
        attributes: [
            { id: 1, sourceName: "class" },
            { id: 2, sourceName: "intermittent" },
        ],
        styleAttributes: [
            { stylingName: "wclass", vectorDataAttrId: 1 },
            { stylingName: "intermittent", vectorDataAttrId: 2 },
        ],
        // "dashon" equal to the period draws solid; shorter dashes intermittent rivers.
        stylingScript: `
            if (attr("wclass") == "ditch" or attr("wclass") == "drain") { discard; }
            set "width" = ${MINIMAP.riverWidthPx};
            if (attr("wclass") == "river" or attr("wclass") == "canal") {
                set "width" = ${MINIMAP.riverMajorWidthPx};
            }
            set "dashon" = ${MINIMAP.riverDashPeriodPx};
            if (attr("intermittent") == 1) { set "dashon" = ${MINIMAP.riverDashOnPx}; }
            emit 0;
        `,
        representations: [
            {
                id: 0,
                sceneViews: MINIMAP_BITS,
                flatOverlayPolyline: {
                    color: { defaultValue: MINIMAP.riverColor },
                    width: {
                        name: "width",
                        defaultValue: MINIMAP.riverWidthPx,
                    },
                    widthUnit:
                        HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                    dashes: {
                        mode: HrzProtocol.DashMode.DASH_ENABLED_FILLED,
                        secondaryColor: {
                            defaultValue: { r: 0, g: 0, b: 0, a: 0 },
                        },
                        period: { defaultValue: MINIMAP.riverDashPeriodPx },
                        periodUnit:
                            HrzProtocol.DashSizeUnit.DASH_SIZE_IN_PIXELS,
                        primarySegmentLength: {
                            name: "dashon",
                            defaultValue: MINIMAP.riverDashPeriodPx,
                        },
                        primarySegmentLengthUnit:
                            HrzProtocol.DashSizeUnit.DASH_SIZE_IN_PIXELS,
                    },
                    zIndex: 0,
                    clipToTile: true,
                },
            },
        ],
    });
}

/** Minimap admin borders (`boundary`), dashed, wider for higher levels. */
export async function addMinimapBorders(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    const w = MINIMAP.borderWidthPx;
    return addMinimapVectorLayer(api, {
        name: "Minimap borders",
        dataLayerId: DATA_LAYER_IDS.minimapBorders,
        sourceLayer: "boundary",
        attributes: [
            { id: 1, sourceName: "admin_level" },
            { id: 2, sourceName: "maritime" },
        ],
        styleAttributes: [
            { stylingName: "admin_level", vectorDataAttrId: 1 },
            { stylingName: "maritime", vectorDataAttrId: 2 },
        ],
        stylingScript: `
            if (attr("maritime") == 1) { discard; }
            set "width" = ${w.municipality};
            if (attr("admin_level") <= 2) {
                set "width" = ${w.country};
            } elif (attr("admin_level") <= 4) {
                set "width" = ${w.region};
            } elif (attr("admin_level") <= 6) {
                set "width" = ${w.county};
            }
            emit 0;
        `,
        representations: [
            {
                id: 0,
                sceneViews: MINIMAP_BITS,
                flatOverlayPolyline: {
                    color: { defaultValue: MINIMAP.borderColor },
                    width: { name: "width", defaultValue: w.municipality },
                    widthUnit:
                        HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                    dashes: {
                        mode: HrzProtocol.DashMode.DASH_ENABLED_FILLED,
                        secondaryColor: {
                            defaultValue: { r: 0, g: 0, b: 0, a: 0 },
                        },
                        period: { defaultValue: MINIMAP.borderDashPeriodPx },
                        periodUnit:
                            HrzProtocol.DashSizeUnit.DASH_SIZE_IN_PIXELS,
                        primarySegmentLength: {
                            defaultValue: MINIMAP.borderDashOnPx,
                        },
                        primarySegmentLengthUnit:
                            HrzProtocol.DashSizeUnit.DASH_SIZE_IN_PIXELS,
                    },
                    zIndex: 10,
                    clipToTile: true,
                },
            },
        ],
    });
}

/** Minimap roads (`transportation`), width by class; non-road classes are dropped. */
export async function addMinimapRoads(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    const rw = MINIMAP.roadWidthPx;
    return addMinimapVectorLayer(api, {
        name: "Minimap roads",
        dataLayerId: DATA_LAYER_IDS.minimapRoads,
        sourceLayer: "transportation",
        visibleBelowM: MINIMAP.roadVisibleBelowM,
        attributes: [
            { id: 1, sourceName: "class" },
            { id: 2, sourceName: "brunnel" },
        ],
        styleAttributes: [
            { stylingName: "road_class", vectorDataAttrId: 1 },
            { stylingName: "brunnel", vectorDataAttrId: 2 },
        ],
        // Tunnels are dashed.
        stylingScript: `
            set "dashon" = ${MINIMAP.roadDashPeriodPx};
            if (attr("brunnel") == "tunnel") { set "dashon" = ${MINIMAP.roadTunnelDashOnPx}; }
            if (attr("road_class") == "motorway") { set "width" = ${rw.motorway}; emit 0; }
            elif (attr("road_class") == "trunk") { set "width" = ${rw.trunk}; emit 0; }
            elif (attr("road_class") == "primary") { set "width" = ${rw.primary}; emit 0; }
            elif (attr("road_class") == "secondary") { set "width" = ${rw.secondary}; emit 0; }
            elif (attr("road_class") == "tertiary") { set "width" = ${rw.tertiary}; emit 0; }
            elif (attr("road_class") == "minor") { set "width" = ${rw.minor}; emit 0; }
            elif (attr("road_class") == "service") { set "width" = ${rw.service}; emit 0; }
            discard;
        `,
        representations: [
            {
                id: 0,
                sceneViews: MINIMAP_BITS,
                flatOverlayPolyline: {
                    color: { defaultValue: MINIMAP.roadColor },
                    width: { name: "width", defaultValue: rw.minor },
                    widthUnit:
                        HrzProtocol.InWorldSizeUnit.IN_WORLD_SIZE_IN_PIXELS,
                    dashes: {
                        mode: HrzProtocol.DashMode.DASH_ENABLED_FILLED,
                        secondaryColor: {
                            defaultValue: { r: 0, g: 0, b: 0, a: 0 },
                        },
                        period: { defaultValue: MINIMAP.roadDashPeriodPx },
                        periodUnit:
                            HrzProtocol.DashSizeUnit.DASH_SIZE_IN_PIXELS,
                        primarySegmentLength: {
                            name: "dashon",
                            defaultValue: MINIMAP.roadDashPeriodPx,
                        },
                        primarySegmentLengthUnit:
                            HrzProtocol.DashSizeUnit.DASH_SIZE_IN_PIXELS,
                    },
                    zIndex: 4,
                    clipToTile: true,
                },
            },
        ],
    });
}

/** Minimap building footprints (`building`), only in the deepest tiles. */
export async function addMinimapBuildings(
    api: HrzApi.AsyncApi,
): Promise<HrzProtocol.LayerHandle> {
    return addMinimapVectorLayer(api, {
        name: "Minimap buildings",
        dataLayerId: DATA_LAYER_IDS.minimapBuildings,
        sourceLayer: "building",
        attributes: [],
        styleAttributes: [],
        stylingScript: `emit 0;`,
        representations: [
            {
                id: 0,
                sceneViews: MINIMAP_BITS,
                flatOverlayPolygon: {
                    color: { defaultValue: MINIMAP.buildingColor },
                    zIndex: 3,
                    clipToTile: true,
                },
            },
        ],
    });
}
