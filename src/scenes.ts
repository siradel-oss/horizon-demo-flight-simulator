// The tour: each scene is a place, the layers that show it, a vehicle and a
// recorded path. The scene machine lives in main.ts.
//
// A scene with `trajectory: null` opens under manual control at `start`, ready
// for a path to be recorded (T) and pasted into src/trajectory-data.ts.

import { IGN_ORTHO, IGN_ORTHO_WORLD, RENNES, START, SUN } from "./config";
import {
    addRennesBuildings,
    addRoadNames,
    addTiledImagery,
    type SceneLayers,
} from "./horizon";
import type { HrzApi } from "@siradel-oss/horizon-api";
import type { StartPose } from "./plane";
import type { SceneLook } from "./horizon";
import type { HrzProtocol } from "@siradel-oss/horizon-protocol";
import type { VehicleId } from "./vehicles";
import {
    CHAMONIX_TRAJECTORY,
    PLANET_TRAJECTORY,
    RENNES_TRAJECTORY,
} from "./trajectory-data";
import type { TrajectoryData } from "./trajectory";
import type { Text } from "./i18n";

/** Whether the minimap is on when the scene opens (M toggles it either way). */
export type SceneMinimap = "hidden" | "shown";

export interface Scene {
    /** Stable key, used for `?scene=`, the recording panel and logs. */
    id: string;
    /** Shown in the scene badge. */
    name: Text;
    /** One line on what the scene demonstrates. */
    blurb: Text;
    /** Start pose while the scene has no path; otherwise the path's first sample is used. */
    start: StartPose;
    /** Local solar time the scene opens at (hours). */
    solarTime: number;
    vehicle: VehicleId;
    minimap: SceneMinimap;
    /** Lighting look. Defaults to "realistic". */
    look?: SceneLook;
    /**
     * Show the relief (Terrarium + IGN RGE ALTI). Off, the ground is flat at zero
     * and no elevation tile is fetched. Defaults to false.
     */
    terrain?: boolean;
    /** Ground colour where nothing covers the terrain. Defaults to the engine's. */
    terrainColor?: HrzProtocol.IColor;
    /** Chase-camera tilt (0 = straight down, PI/2 = horizon), overriding the vehicle's. */
    cameraTiltRad?: number;
    /** Show the shared place labels (towns, peaks, passes, lakes). Defaults to true. */
    placeLabels?: boolean;
    /**
     * Pin the sun in space: local solar time follows the vehicle's longitude, so
     * flying far east or west reaches dusk or dawn. `solarTime` is then the local
     * time at the start point.
     */
    sunFixedInSpace?: boolean;
    /** The flown path, or null while the scene is being authored. */
    trajectory: TrajectoryData | null;
    /**
     * Create the layers this scene owns; they are destroyed when it ends. Shared
     * layers (DTMs, vehicle, labels, minimap) are created once at boot.
     */
    createLayers: (api: HrzApi.AsyncApi) => Promise<SceneLayers>;
}

/** Compose several layer builders into one scene's `createLayers`. */
function layers(
    ...builders: ((api: HrzApi.AsyncApi) => Promise<SceneLayers>)[]
): (api: HrzApi.AsyncApi) => Promise<SceneLayers> {
    return async (api) => {
        const handles: SceneLayers = [];
        for (const build of builders) handles.push(...(await build(api)));
        return handles;
    };
}

/** The pose a scene opens at: its path's first sample, or `start` without one. */
export function sceneStart(scene: Scene): StartPose {
    const first = scene.trajectory?.samples[0];
    if (!first) return scene.start;
    const [latitude, longitude, altitude, headingDeg] = first;
    return { latitude, longitude, altitude, headingDeg };
}

/** Scene-view bits for the main (flight) view. */
const MAIN_VIEW_BITS = { bits: 1 };

/** The tour, in order; it wraps after the last scene. */
export const SCENES: Scene[] = [
    {
        id: "chamonix",
        name: { en: "Chamonix — Mont Blanc", fr: "Chamonix — Mont-Blanc" },
        blurb: {
            en: "By plane: IGN relief and orthophotos, place names",
            fr: "En avion : relief et orthophotos de l'IGN, noms de lieux",
        },
        start: START,
        solarTime: SUN.initialLocalSolarTime,
        vehicle: "plane",
        minimap: "hidden",
        trajectory: CHAMONIX_TRAJECTORY,
        terrain: true,
        createLayers: (api) => addTiledImagery(api, IGN_ORTHO),
    },
    {
        id: "rennes",
        name: {
            en: "Rennes — the city by building type",
            fr: "Rennes — la ville par type de bâtiment",
        },
        blurb: {
            en: "By drone: buildings coloured by type and street names",
            fr: "En drone : bâtiments colorés par type et noms de rues",
        },
        // Over the Vilaine, heading north-east toward the old town.
        start: {
            latitude: 48.1063,
            longitude: -1.6915,
            altitude: 380,
            headingDeg: 45,
        },
        solarTime: 15,
        vehicle: "drone",
        minimap: "hidden",
        look: "model",
        // No imagery: the vectors stand on a plain pale ground.
        terrainColor: RENNES.groundColor,
        cameraTiltRad: 0.85,
        // The street names replace the global place labels.
        placeLabels: false,
        trajectory: RENNES_TRAJECTORY,
        // Street names over the buildings.
        createLayers: layers(
            (api) => addRennesBuildings(api, MAIN_VIEW_BITS),
            (api) => addRoadNames(api, MAIN_VIEW_BITS),
        ),
    },
    {
        id: "planet",
        name: { en: "Low Earth orbit", fr: "Orbite basse" },
        blurb: {
            en: "By shuttle: the Mediterranean from 400 km, France on the horizon",
            fr: "En navette : la Méditerranée à 400 km, la France à l'horizon",
        },
        // Over the Atlantic at 400 km, heading east over Iberia and the Mediterranean.
        start: {
            latitude: 30.0,
            longitude: -37.7,
            altitude: 400000,
            headingDeg: 67,
        },
        solarTime: 14,
        sunFixedInSpace: true,
        vehicle: "orbiter",
        look: "realistic",
        // Labels are unreadable from orbit.
        placeLabels: false,
        minimap: "hidden",
        trajectory: PLANET_TRAJECTORY,
        createLayers: (api) => addTiledImagery(api, IGN_ORTHO_WORLD),
    },
];
