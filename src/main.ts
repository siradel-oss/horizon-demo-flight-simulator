import {
    AUTO_RESET,
    SCENE_FADE,
    SCENE_MIN_DWELL_MS,
    CAMERA,
    CRASH,
    FLYTO_ALTITUDE_M,
    GPWS,
    IGN_DTM,
    MINIMAP,
    NAV,
    START_SCENE,
    SUN,
    TERRAIN_SETTLE,
    UI,
} from "./config";
import { searchPlaces, type GeocodeResult } from "./geocode";
import {
    destroySceneLayers,
    addMinimapBorders,
    addMinimapBuildings,
    addMinimapElevation,
    addMinimapPlaceLabels,
    addMinimapRivers,
    addMinimapRoads,
    addMinimapWater,
    addPassLabels,
    addPeakLabels,
    addPlaceLabels,
    addWaterLabels,
    addVehicleModel,
    addTerrainDtm,
    addWmtsDtm,
    dumpScene,
    setDtmVisible,
    boot,
    enableAttributions,
    initViews,
    queryGroundElevation,
    setImageryVisible,
    setMainViewLook,
    setMinimapActive,
    setMinimapViewport,
    setVectorTilesVisible,
    setSunAngles,
    setSunTime,
    setPropellerSpeed,
    setUserInteractionsEnabled,
    toggleDevUi,
    updateCamera,
    updateCockpitCamera,
    updateMinimapCamera,
    updatePlaneModel,
    type HrzAttribution,
    type LayerHandle,
    type MinimapRect,
    type SceneLayers,
} from "./horizon";
import { createInput, normalizedKey, setInputEnabled } from "./input";
import {
    degToRad,
    easeToward,
    geoDelta,
    orientationFromAttitude,
} from "./math";
import {
    createPlane,
    flyTo,
    resetPlane,
    updateHover,
    updatePlane,
    type PlaneState,
} from "./plane";
import { VEHICLES, type Vehicle } from "./vehicles";
import { SCENES, sceneStart } from "./scenes";
import { sunAngles } from "./sun";
import { TOUCH } from "./device";
import { LANG, setLang, t, translatePage } from "./i18n";
import { createAbout } from "./ui/about";
import { bindFlightStick, bindThrottleLever } from "./ui/touch-controls";
import {
    serializeTrajectory,
    TrajectoryPlayer,
    TrajectoryRecorder,
    type TrajectoryData,
} from "./trajectory";

// The touch layout (stick, lever, action buttons) is used on every device: it
// works with a mouse, and the keyboard shortcuts still apply.
document.documentElement.classList.add("touch");
translatePage();
const about = createAbout();
document
    .getElementById("about-open")!
    .addEventListener("click", () => about.open());
document
    .getElementById("attribution")!
    .addEventListener("click", () => about.open("sources"));
const langButton = document.getElementById("lang-switch")!;
langButton.textContent = LANG === "en" ? "FR" : "EN";
langButton.addEventListener("click", () =>
    setLang(LANG === "en" ? "fr" : "en"),
);

const canvas = document.getElementById("viewer") as HTMLCanvasElement;
const loading = document.getElementById("loading")!;
const pauseButton = document.getElementById("pause") as HTMLButtonElement;
const modeText = document.getElementById("mode-text")!;
const modeBox = document.getElementById("mode-box")!;
const searchModal = document.getElementById("search-modal")!;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResults = document.getElementById("search-results")!;
const searchStatus = document.getElementById("search-status")!;
const sunSlider = document.getElementById("sun-slider") as HTMLInputElement;
const sunTime = document.getElementById("sun-time")!;
const crashOverlay = document.getElementById("crash-overlay")!;
const crashReset = document.getElementById("crash-reset") as HTMLButtonElement;
const crashCountdown = document.getElementById("crash-countdown")!;
const crashSeconds = document.getElementById("crash-seconds")!;
const crashProgressFill = document.getElementById("crash-progress-fill")!;
const attributionBar = document.getElementById("attribution")!;
const pfd = document.getElementById("pfd")!;
// Readout used instead of the PFD by hovering vehicles.
const droneHud = document.getElementById("drone-hud")!;
const dhSpd = document.getElementById("dh-spd")!;
const dhAlt = document.getElementById("dh-alt")!;
const dhAgl = document.getElementById("dh-agl")!;
const dhAglField = document.getElementById("dh-agl-field")!;
const dhVs = document.getElementById("dh-vs")!;
const dhSpdUnit = document.getElementById("dh-spd-unit")!;
const dhAltUnit = document.getElementById("dh-alt-unit")!;
const dhVsUnit = document.getElementById("dh-vs-unit")!;
const dhHdg = document.getElementById("dh-hdg")!;
const throttleLabel = document.getElementById("throttle-label")!;
const idleToast = document.getElementById("idle-toast")!;
const demoAction = document.getElementById("act-demo")!;
const idleSeconds = document.getElementById("idle-seconds")!;
const recIndicator = document.getElementById("rec-indicator")!;
const trajModal = document.getElementById("trajectory-modal")!;
const trajOutput = document.getElementById(
    "trajectory-output",
) as HTMLTextAreaElement;
const trajCopy = document.getElementById(
    "trajectory-copy",
) as HTMLButtonElement;
const trajClose = document.getElementById(
    "trajectory-close",
) as HTMLButtonElement;
const trajHint = document.getElementById("trajectory-hint")!;
const sceneNumber = document.getElementById("scene-number")!;
const sceneName = document.getElementById("scene-name")!;
const sceneBlurb = document.getElementById("scene-blurb")!;
// Control-mode annunciator: cyan = assist (self-centering), amber = manual.
const MODE_ASSIST_COLOR = "#cfe8ff";
const MODE_MANUAL_COLOR = "#ffd24a";
const thrFill = document.getElementById("thr-fill")!;
const thrValue = document.getElementById("thr-value")!;
const THR_TRACK_BOTTOM = 154;
const THR_TRACK_HEIGHT = 140;

// Attitude indicator (artificial horizon).
const attitudeEl = document.getElementById("attitude")!;
const aiRoll = document.getElementById("ai-roll")!;
const aiPitch = document.getElementById("ai-pitch")!;
const aiScale = document.getElementById("ai-scale")!;
// Radio altimeter, on the attitude indicator.
const aiRa = document.getElementById("ai-ra")!;
const raBox = document.getElementById("ra-box")!;
const raValue = document.getElementById("ra-value")!;
const AI_PX_PER_DEG = 2.3; // pitch ladder spacing
const AI_BANK_SIGN = -1;
const AI_PITCH_SIGN = 1;

// Airspeed / altitude / heading tapes.
const asiScale = document.getElementById("asi-scale")!;
const asiValue = document.getElementById("asi-value")!;
const altScale = document.getElementById("alt-scale")!;
const altValue = document.getElementById("alt-value")!;
const hdgScale = document.getElementById("hdg-scale")!;
const hdgValue = document.getElementById("hdg-value")!;
const hdgBug = document.getElementById("hdg-bug")!;
const navBanner = document.getElementById("nav-banner")!;
const navName = document.getElementById("nav-name")!;
const navDist = document.getElementById("nav-dist")!;
const navEta = document.getElementById("nav-eta")!;
const navBrg = document.getElementById("nav-brg")!;
const navClear = document.getElementById("nav-clear") as HTMLButtonElement;
// HTML frame over the minimap scene view.
const minimapFrame = document.getElementById("minimap")!;
const minimapHide = document.getElementById(
    "minimap-hide",
) as HTMLButtonElement;
const minimapPlane = document.getElementById("minimap-plane")!;
const ASI_PX_PER_KMH = 1.1;
const ALT_PX_PER_M = 0.09;
const HDG_PX_PER_DEG = 2.0;
const TAPE_CENTER_Y = 84;
const HDG_CENTER_X = 150;

// Vertical-speed indicator.
const vsiBar = document.getElementById("vsi-bar")!;
const vsiValue = document.getElementById("vsi-value")!;
const VSI_MAX_MPS = 30; // full scale
const VSI_HALF_PX = 68; // zero line to full scale
const VSI_CENTER_Y = 82; // zero line

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(
    tag: string,
    attrs: Record<string, string | number>,
): SVGElement {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

/** Size the drawing buffer to the display, accounting for HiDPI. */
function resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
}

/** Build the artificial-horizon SVG once (sky/ground, pitch ladder, roll scale). */
function buildAttitudeIndicator(): void {
    const S = AI_PX_PER_DEG;
    // Oversized so they cover any roll and pitch.
    aiPitch.appendChild(
        svgEl("rect", {
            x: -160,
            y: 100 - 800,
            width: 520,
            height: 800,
            fill: "#3d7fb8",
        }),
    );
    aiPitch.appendChild(
        svgEl("rect", {
            x: -160,
            y: 100,
            width: 520,
            height: 800,
            fill: "#7a5b3a",
        }),
    );
    aiPitch.appendChild(
        svgEl("line", {
            x1: -160,
            y1: 100,
            x2: 360,
            y2: 100,
            stroke: "#fff",
            "stroke-width": 2,
        }),
    );

    for (const d of [10, 20, 30]) {
        for (const s of [1, -1]) {
            const y = 100 - s * d * S;
            aiPitch.appendChild(
                svgEl("line", {
                    x1: 80,
                    y1: y,
                    x2: 120,
                    y2: y,
                    stroke: "#eef4fb",
                    "stroke-width": 1.4,
                }),
            );
            for (const [x, anchor] of [
                [74, "end"],
                [126, "start"],
            ] as const) {
                const t = svgEl("text", {
                    x,
                    y: y + 3,
                    fill: "#eef4fb",
                    "font-size": 8,
                    "text-anchor": anchor,
                });
                t.textContent = String(d);
                aiPitch.appendChild(t);
            }
        }
    }

    // Roll scale ticks.
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const major = [0, 30, 60].includes(Math.abs(b));
        aiScale.appendChild(
            svgEl("line", {
                x1: 100,
                y1: 11,
                x2: 100,
                y2: major ? 20 : 17,
                transform: `rotate(${b} 100 100)`,
            }),
        );
    }
}

/** Update the artificial horizon from the plane's attitude. */
function updateAttitude(plane: PlaneState): void {
    const bankDeg = (plane.bank * 180) / Math.PI;
    const pitchDeg = (plane.pitch * 180) / Math.PI;
    aiRoll.setAttribute(
        "transform",
        `rotate(${(AI_BANK_SIGN * bankDeg).toFixed(2)} 100 100)`,
    );
    aiPitch.setAttribute(
        "transform",
        `translate(0 ${(AI_PITCH_SIGN * pitchDeg * AI_PX_PER_DEG).toFixed(2)})`,
    );
    attitudeEl.classList.toggle("stall", plane.stalled);
}

/** Radio altimeter and TERRAIN warning from height above ground (null = unknown). */
function updateGpws(agl: number | null): void {
    if (agl === null || agl > GPWS.displayCeilingM) {
        aiRa.setAttribute("visibility", "hidden");
        attitudeEl.classList.remove("gpws-warn");
        return;
    }
    aiRa.setAttribute("visibility", "visible");
    raValue.textContent = String(Math.max(0, Math.round(agl)));
    const warning = agl <= GPWS.warningAglM;
    const caution = agl <= GPWS.cautionAglM;
    raBox.setAttribute(
        "stroke",
        warning ? "#ff5a5a" : caution ? "#ffd24a" : "#cdd6e0",
    );
    raValue.setAttribute("fill", warning ? "#ff5a5a" : "#fff");
    attitudeEl.classList.toggle("gpws-warn", warning);
}

/** Add a rung (tick + optional label) to a vertical tape scale. */
function vTapeRung(
    group: Element,
    y: number,
    value: number,
    major: boolean,
    side: "right" | "left",
): void {
    const inner = side === "right" ? 6 : 56;
    const len = major ? 14 : 8;
    const x2 = side === "right" ? inner + len : inner - len;
    group.appendChild(
        svgEl("line", {
            x1: inner,
            y1: y,
            x2,
            y2: y,
            stroke: "#cdd6e0",
            "stroke-width": 1.2,
        }),
    );
    if (major) {
        const lx = side === "right" ? x2 + 4 : x2 - 4;
        const t = svgEl("text", {
            x: lx,
            y: y + 3,
            fill: "#cdd6e0",
            "font-size": 8,
            "text-anchor": side === "right" ? "start" : "end",
        });
        t.textContent = String(value);
        group.appendChild(t);
    }
}

/** Build the airspeed, altitude, and heading scales once. */
function buildTapes(): void {
    // Airspeed (km/h): tick every 20, label every 100.
    for (let v = 0; v <= 1000; v += 20) {
        vTapeRung(asiScale, -v * ASI_PX_PER_KMH, v, v % 100 === 0, "right");
    }
    // Altitude (m): tick every 100, label every 500.
    for (let a = 0; a <= 12000; a += 100) {
        vTapeRung(altScale, -a * ALT_PX_PER_M, a, a % 500 === 0, "left");
    }
    // Heading: tick every 10°, label every 30°. Drawn past 0 and 360 to cover the wrap.
    for (let h = -90; h <= 450; h += 10) {
        const x = h * HDG_PX_PER_DEG;
        const major = h % 30 === 0;
        hdgScale.appendChild(
            svgEl("line", {
                x1: x,
                y1: major ? 16 : 20,
                x2: x,
                y2: 28,
                stroke: "#cdd6e0",
                "stroke-width": 1.2,
            }),
        );
        if (major) {
            const hn = ((h % 360) + 360) % 360;
            const cardinal = (
                { 0: "N", 90: "E", 180: "S", 270: "W" } as Record<
                    number,
                    string
                >
            )[hn];
            const t = svgEl("text", {
                x,
                y: 11,
                fill: cardinal ? "#ffffff" : "#aeb8c4",
                "font-size": cardinal ? 12 : 9,
                "font-weight": cardinal ? 700 : 600,
                "text-anchor": "middle",
            });
            t.textContent = cardinal ?? String(hn);
            hdgScale.appendChild(t);
        }
    }
}

/** Scroll the tapes to the current speed/altitude/heading and update the readouts. */
function updateTapes(plane: PlaneState): void {
    const kmh = plane.speed * 3.6;
    asiScale.setAttribute(
        "transform",
        `translate(0 ${(TAPE_CENTER_Y + kmh * ASI_PX_PER_KMH).toFixed(1)})`,
    );
    asiValue.textContent = kmh.toFixed(0);

    altScale.setAttribute(
        "transform",
        `translate(0 ${(TAPE_CENTER_Y + plane.altitude * ALT_PX_PER_M).toFixed(1)})`,
    );
    altValue.textContent = plane.altitude.toFixed(0);

    const hdg = ((((plane.heading * 180) / Math.PI) % 360) + 360) % 360;
    hdgScale.setAttribute(
        "transform",
        `translate(${(HDG_CENTER_X - hdg * HDG_PX_PER_DEG).toFixed(1)} 0)`,
    );
    hdgValue.textContent = hdg.toFixed(0).padStart(3, "0");
}

/** Grow the vertical-speed bar up (climb) / down (descent) from the zero line. */
function updateVsi(plane: PlaneState): void {
    const d = Math.max(-1, Math.min(1, plane.vv / VSI_MAX_MPS)) * VSI_HALF_PX;
    vsiBar.setAttribute("y", (VSI_CENTER_Y - Math.max(d, 0)).toFixed(1));
    vsiBar.setAttribute("height", Math.abs(d).toFixed(1));
    const v = Math.round(plane.vv);
    vsiValue.textContent = v > 0 ? `+${v}` : String(v);
}

/** Fill the vertical throttle gauge from the bottom and update its readout. */
function updateThrottleGauge(plane: PlaneState): void {
    const f = Math.min(1, Math.max(0, plane.throttle));
    const h = f * THR_TRACK_HEIGHT;
    thrFill.setAttribute("y", (THR_TRACK_BOTTOM - h).toFixed(1));
    thrFill.setAttribute("height", h.toFixed(1));
    thrValue.textContent = (f * 100).toFixed(0);
}

/** Model orientation from the attitude plus the vehicle's render corrections. */
function vehicleRotation(vehicle: Vehicle, plane: PlaneState) {
    const heading = plane.heading + degToRad(vehicle.headingOffsetDeg);
    return orientationFromAttitude(
        heading,
        vehicle.pitchRenderSign * plane.pitch,
        vehicle.bankRenderSign * plane.bank,
    );
}

async function main(): Promise<void> {
    document.documentElement.style.setProperty(
        "--attrib-h",
        `${UI.attributionBarPx}px`,
    );
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    buildAttitudeIndicator();
    buildTapes();

    const api = await boot(canvas);

    // Shared layers, created once: DTMs, place labels, minimap. Imagery belongs
    // to the scenes.
    //
    // Destroying a WMTS DTM layer crashes Horizon 26.1, so the DTMs are created
    // once and hidden in scenes without relief.
    const dtmLayers = [
        await addTerrainDtm(api),
        ...(await addWmtsDtm(api, IGN_DTM)),
    ];
    const placeLabelLayers: LayerHandle[] = [];
    placeLabelLayers.push(
        await addPlaceLabels(api),
        await addPeakLabels(api),
        await addPassLabels(api),
        await addWaterLabels(api),
    );

    // Minimap layers, bottom to top.
    const minimapElevation = await addMinimapElevation(api);
    await addMinimapRivers(api);
    await addMinimapWater(api);
    await addMinimapBuildings(api);
    await addMinimapRoads(api);
    await addMinimapBorders(api);
    await addMinimapPlaceLabels(api);

    // Credits for the visible layers, re-sent by the engine as they change. Text
    // may be HTML; logos are shown too, as the licences require.
    const renderCredits = (credits: HrzAttribution[]): void => {
        const seen = new Set<string>();
        const items = credits.filter((a) => {
            const key = `${a.text ?? ""}|${a.logoUrl ?? ""}`;
            if (!a.text && !a.logoUrl) return false;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        attributionBar.replaceChildren(
            ...items.map((a) => {
                const span = document.createElement("span");
                if (a.logoUrl) {
                    const img = document.createElement("img");
                    img.src = a.logoUrl;
                    img.alt = "";
                    span.appendChild(img);
                }
                if (a.text) {
                    const text = document.createElement("span");
                    text.innerHTML = a.text;
                    span.appendChild(text);
                }
                return span;
            }),
        );
    };
    enableAttributions(api, renderCredits);

    // The minimap frame is placed by CSS; its rectangle, normalized to the canvas,
    // is the minimap view's viewport.
    const minimapRect = (): MinimapRect => {
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        const r = minimapFrame.getBoundingClientRect();
        return {
            xMin: r.left / w,
            yMin: r.top / h,
            xMax: r.right / w,
            yMax: r.bottom / h,
        };
    };
    await initViews(api, minimapRect());

    const plane = createPlane();

    /**
     * Sun time base. The engine takes a *local* solar time, so the sun follows the
     * camera. With the sun pinned in space (Scene.sunFixedInSpace), the local time
     * is `base + longitude / 15`, with `base` the solar time at longitude 0;
     * otherwise `base` is the local time itself.
     */
    let sunBaseHours = SUN.initialLocalSolarTime;
    let sunFixedInSpace = false;

    /**
     * Longitude unwrapped across ±180°. The engine eases the sun toward each new
     * value, so a 360° jump would play out as the sun running a day backwards.
     */
    let sunLongitude = 0;
    let sunLongitudePrev = 0;
    const trackSunLongitude = (): void => {
        let delta = plane.longitude - sunLongitudePrev;
        if (delta > 180) delta -= 360;
        else if (delta < -180) delta += 360;
        sunLongitude += delta;
        sunLongitudePrev = plane.longitude;
    };
    /** Sun azimuth, unwrapped for the same reason. */
    let sunAzimuth = 0;
    let sunAzimuthPrev: number | null = null;
    const trackSunAzimuth = (raw: number): number => {
        if (sunAzimuthPrev === null) {
            sunAzimuth = raw;
        } else {
            let delta = raw - sunAzimuthPrev;
            if (delta > Math.PI) delta -= Math.PI * 2;
            else if (delta < -Math.PI) delta += Math.PI * 2;
            sunAzimuth += delta;
        }
        sunAzimuthPrev = raw;
        return sunAzimuth;
    };

    /** Re-seat the unwrapped longitude and azimuth after a teleport. */
    const resetSunLongitude = (): void => {
        sunLongitude = plane.longitude;
        sunLongitudePrev = plane.longitude;
        sunAzimuthPrev = null;
    };

    /** Local solar time under the vehicle, deliberately not wrapped to a day. */
    const localSunTime = (): number =>
        sunBaseHours + (sunFixedInSpace ? sunLongitude / 15 : 0);

    const wrapDay = (h: number): number => ((h % 24) + 24) % 24;

    const fmtClock = (h: number): string => {
        const hh = Math.floor(h) % 24;
        const mm = Math.floor((h - Math.floor(h)) * 60);
        return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    const applySunTime = (h: number): void => {
        setSunTime(api, h);
        sunTime.textContent = fmtClock(wrapDay(h));
    };
    /** Push the sun for the vehicle's position and sync the slider. */
    const refreshSun = (): void => {
        trackSunLongitude();
        const local = localSunTime();
        sunSlider.value = String(wrapDay(local));
        if (sunFixedInSpace) {
            // Angles, not an hour: no midnight wrap for the engine to ease through.
            const { azimuth, altitude } = sunAngles(
                plane.latitude,
                SUN.dayOfYear,
                local,
            );
            setSunAngles(api, trackSunAzimuth(azimuth), altitude);
            sunTime.textContent = fmtClock(wrapDay(local));
        } else {
            applySunTime(local);
        }
    };
    try {
        sunSlider.value = String(SUN.initialLocalSolarTime);
        applySunTime(SUN.initialLocalSolarTime);
        sunSlider.addEventListener("input", () => {
            // The slider is local time under the vehicle; a pinned sun moves the base.
            const local = parseFloat(sunSlider.value);
            sunBaseHours = sunFixedInSpace ? local - sunLongitude / 15 : local;
            applySunTime(local);
        });
    } catch (err) {
        console.warn("Sun setup failed:", err);
    }
    const input = createInput();
    let vehicle: Vehicle = VEHICLES.plane;
    let planeHandle = await addVehicleModel(
        api,
        vehicle,
        plane,
        vehicleRotation(vehicle, plane),
    );

    /** Instruments show only while the visitor flies, and match the vehicle. */
    const refreshInstruments = (): void => {
        const flying = !autopilot;
        demoAction.classList.toggle("available", flying && player !== null);
        pfd.classList.toggle("active", flying && vehicle.hud === "pfd");
        droneHud.classList.toggle("active", flying && vehicle.hud === "drone");
        throttleLabel.textContent =
            vehicle.flight.kind === "hover"
                ? t({ en: "Climb", fr: "Montée" })
                : t({ en: "Throttle", fr: "Gaz" });
    };

    const setVehicle = async (next: Vehicle): Promise<void> => {
        if (next.id !== vehicle.id) {
            // New model first, so no frame shows an empty sky.
            const previous = planeHandle;
            planeHandle = await addVehicleModel(
                api,
                next,
                plane,
                vehicleRotation(next, plane),
            );
            await api.LayerService.destroyLayer(previous);
        }
        vehicle = next;
        cameraDistance = next.camera.distance;
        cameraTilt = next.camera.tiltRad;
        refreshInstruments();
    };

    // Attract mode plays the scene's path until the visitor touches a flight control.
    let player: TrajectoryPlayer | null = null;
    let autopilot = false;
    const setAutopilot = (value: boolean): void => {
        autopilot = value;
        refreshInstruments();
    };
    // Non-null while recording (T); recording suspends the unattended resets.
    let recorder: TrajectoryRecorder | null = null;

    // --- Minimap -------------------------------------------------------------
    // The map is centred on the vehicle, so its marker is an SVG pinned at the
    // frame centre and rotated to the heading.
    let minimapVisible = false;
    let minimapRange = MINIMAP.defaultRangeM;
    const refreshMinimap = (): void => {
        updateMinimapCamera(
            api,
            plane.latitude,
            plane.longitude,
            plane.altitude,
            minimapRange,
        );
        const hdgDeg = (plane.heading * 180) / Math.PI;
        minimapPlane.style.transform = `translate(-50%, -50%) rotate(${hdgDeg.toFixed(1)}deg)`;
    };
    refreshMinimap();

    const mapAction = document.querySelector<HTMLElement>(
        '#touch-actions [data-key="m"]',
    );
    const setMinimapVisible = (value: boolean): void => {
        minimapVisible = value;
        minimapFrame.classList.toggle("hidden", !minimapVisible);
        mapAction?.classList.toggle("active", minimapVisible);
        setMinimapViewport(api, minimapRect(), minimapVisible);
        // Off, the view leaves the active set (see setMinimapActive) and its
        // elevation raster stops streaming.
        setMinimapActive(api, minimapVisible);
        setImageryVisible(api, minimapElevation, minimapVisible);
        if (minimapVisible) refreshMinimap();
    };
    minimapHide.addEventListener("click", () => setMinimapVisible(false));
    // The wheel over the minimap zooms it, not the chase camera.
    minimapFrame.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            e.stopPropagation();
            const factor =
                e.deltaY > 0 ? MINIMAP.zoomFactor : 1 / MINIMAP.zoomFactor;
            minimapRange = Math.min(
                MINIMAP.maxRangeM,
                Math.max(MINIMAP.minRangeM, minimapRange * factor),
            );
            refreshMinimap();
        },
        { passive: false },
    );
    window.addEventListener("resize", () =>
        setMinimapViewport(api, minimapRect(), minimapVisible),
    );

    let paused = false;
    // The search modal is open (the sim is paused meanwhile).
    let modalOpen = false;
    let crashed = false;
    // When (performance.now) an unattended crash resets the demo; 0 = no countdown.
    let autoResetAt = 0;
    // Last deliberate input (keys, clicks, wheel, drags), for the idle restart.
    let lastActivity = performance.now();
    let idleWarning = false;
    let groundElev: number | null = null; // metres; null until a tile is cached
    let elevPending = false;
    let lastElevQuery = 0;
    // Until settleUntil, terrain is still loading after a jump (see TERRAIN_SETTLE).
    let settleUntil = 0;
    // Highest altitude the settle has lifted the plane to: it never goes back
    // below, so a late low DTM reading can't drop it.
    let settleFloorAlt = -Infinity;

    // Control mode (C): false = assist (self-centering), true = manual (hold).
    let holdAttitude = !TOUCH;
    const updateModeHud = (): void => {
        const color = holdAttitude ? MODE_MANUAL_COLOR : MODE_ASSIST_COLOR;
        modeText.textContent = holdAttitude ? "M" : "A";
        modeText.setAttribute("fill", color);
        modeBox.setAttribute("stroke", color);
    };
    updateModeHud();

    // Camera: chase or cockpit (V).
    let cockpit = false;
    let cameraDistance: number = VEHICLES.plane.camera.distance;
    let cameraTilt: number = VEHICLES.plane.camera.tiltRad;

    // Mouse-look offsets (rad); they ease back after release.
    let lookYaw = 0;
    let lookPitch = 0;
    let dragging = false;
    let lookReleaseTime = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const applyCamera = (): void => {
        if (cockpit) updateCockpitCamera(api, plane, lookYaw, lookPitch);
        else
            updateCamera(
                api,
                plane,
                cameraDistance,
                lookYaw,
                lookPitch,
                cameraTilt,
            );
    };

    const zoom = (deltaMeters: number): void => {
        cameraDistance = Math.min(
            vehicle.camera.maxDistance,
            Math.max(vehicle.camera.minDistance, cameraDistance + deltaMeters),
        );
        if (paused && !cockpit) applyCamera();
    };
    window.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            zoom(Math.sign(e.deltaY) * CAMERA.zoomStep);
        },
        { passive: false },
    );

    // Drag to look around; two fingers pinch-zoom instead.
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    const spread = (): number => {
        const [a, b] = [...touches.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };
    canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (e.pointerType === "touch") {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.size === 2) pinchDist = spread();
        }
        e.preventDefault();
        dragging = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
        if (touches.has(e.pointerId)) {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.size >= 2) {
                const d = spread();
                if (pinchDist > 0 && d > 0)
                    zoom(cameraDistance * (pinchDist / d - 1));
                pinchDist = d;
                lastPointerX = e.clientX;
                lastPointerY = e.clientY;
                return;
            }
        }
        if (!dragging) return;
        const s = CAMERA.look.sensitivityRadPerPx;
        lookYaw += (e.clientX - lastPointerX) * s * CAMERA.look.yawSign;
        lookPitch = Math.max(
            -CAMERA.look.maxPitchRad,
            Math.min(
                CAMERA.look.maxPitchRad,
                lookPitch +
                    (e.clientY - lastPointerY) * s * CAMERA.look.pitchSign,
            ),
        );
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        if (paused) applyCamera();
    });
    const endDrag = (e: PointerEvent): void => {
        touches.delete(e.pointerId);
        if (!dragging) return;
        dragging = false;
        // Fold yaw into (−π, π] so it recentres the short way round.
        lookYaw = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw));
        lookReleaseTime = performance.now();
        canvas.style.cursor = "";
        if (canvas.hasPointerCapture(e.pointerId))
            canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // Capture phase: counted even when a handler stops propagation.
    const noteActivity = (): void => {
        lastActivity = performance.now();
    };
    for (const type of ["keydown", "pointerdown", "wheel"] as const) {
        window.addEventListener(type, noteActivity, {
            capture: true,
            passive: true,
        });
    }
    window.addEventListener(
        "pointermove",
        (e) => {
            if (e.buttons !== 0) noteActivity();
        },
        { capture: true, passive: true },
    );

    // The page owns the camera; the engine gets input only while its dev UI is open.
    setUserInteractionsEnabled(api, false);

    const setPaused = (value: boolean): void => {
        paused = value;
        pauseButton.classList.toggle("paused", paused);
        pauseButton.textContent = paused
            ? t({ en: "▶ Resume", fr: "▶ Reprendre" })
            : t({ en: "⏸ Pause", fr: "⏸ Pause" });
        document
            .querySelector('#touch-actions [data-key="p"]')
            ?.classList.toggle("active", paused);
        setPropellerSpeed(
            api,
            planeHandle,
            vehicle,
            paused ? 0 : vehicle.animationSpeed,
        );
    };
    pauseButton.addEventListener("click", () => {
        setPaused(!paused);
        pauseButton.blur(); // so Space doesn't re-trigger it
    });

    // --- Terrain crash ------------------------------------------------------
    const setCrashed = (value: boolean): void => {
        crashed = value;
        crashOverlay.classList.toggle("active", value);
        setPropellerSpeed(
            api,
            planeHandle,
            vehicle,
            value ? 0 : vehicle.animationSpeed,
        );
        // Not while recording, which would lose the samples.
        autoResetAt =
            value && !recorder
                ? performance.now() + AUTO_RESET.crashDelayMs
                : 0;
        crashCountdown.style.display = autoResetAt !== 0 ? "" : "none";
    };
    // Lift the plane clear of the ground, level it and resume.
    const resetCrash = (): void => {
        const base = groundElev ?? plane.altitude;
        flyTo(
            plane,
            plane.latitude,
            plane.longitude,
            base + CRASH.resetClearanceM,
        );
        groundElev = null;
        settleUntil = performance.now() + TERRAIN_SETTLE.durationMs;
        settleFloorAlt = -Infinity;
        setCrashed(false);
        if (paused) setPaused(false);
        updatePlaneModel(
            api,
            planeHandle,
            plane,
            vehicleRotation(vehicle, plane),
        );
        applyCamera();
    };
    crashReset.addEventListener("click", resetCrash);

    // --- Trajectory recording (T) -------------------------------------------
    const finishRecording = (data: TrajectoryData, sceneId: string): void => {
        const json = serializeTrajectory(data);
        const constName = `${sceneId.toUpperCase()}_TRAJECTORY`;
        trajHint.innerHTML =
            `Scene <code>${sceneId}</code>, ${data.samples.length} samples. Paste into ` +
            `<code>src/trajectory-data.ts</code> as <code>${constName}</code>, then set it ` +
            `as that scene's <code>trajectory</code> in <code>src/scenes.ts</code>.`;
        trajOutput.value = json;
        trajModal.classList.add("open");
        console.log(`Recorded trajectory (${sceneId}):\n` + json);
        setPaused(true);
    };

    const startRecording = (): void => {
        recorder = new TrajectoryRecorder();
        recIndicator.textContent = "● REC  0 samples";
        recIndicator.classList.add("active");
        trajModal.classList.remove("open");
        setAutopilot(false);
        setPaused(false);
    };

    const stopRecording = (): void => {
        const rec = recorder;
        if (!rec) return;
        recorder = null;
        recIndicator.classList.remove("active");
        const data = rec.stop();
        if (data) finishRecording(data, SCENES[sceneIndex].id);
        else console.warn("Recording discarded: too few samples to be a path");
    };
    trajCopy.addEventListener("click", () => {
        void navigator.clipboard?.writeText(trajOutput.value);
        trajOutput.select();
    });
    trajClose.addEventListener("click", () => {
        trajModal.classList.remove("open");
        setPaused(false);
    });

    // --- "Fly to" search (F) ----------------------------------------------
    // Opening pauses the sim and disables the flight keys so typing reaches the field.
    let pausedBeforeModal = false;
    let results: GeocodeResult[] = [];
    let selectedIndex = 0;
    let debounceTimer = 0;
    let activeSearch: AbortController | null = null;

    // Destination the PFD guides toward; null when none is set.
    let destination: {
        latitude: number;
        longitude: number;
        label: string;
    } | null = null;
    let navArrivedAt = 0; // 0 = not arrived

    const clearDestination = (): void => {
        destination = null;
        navArrivedAt = 0;
        navBanner.classList.remove("active", "arrived");
        hdgBug.setAttribute("visibility", "hidden");
    };
    navClear.addEventListener("click", clearDestination);

    const setSearchStatus = (msg: string): void => {
        searchResults.replaceChildren();
        results = [];
        searchStatus.textContent = msg;
        searchStatus.hidden = !msg;
    };

    const highlight = (): void => {
        const children = Array.from(searchResults.children);
        children.forEach((li, i) =>
            li.classList.toggle("selected", i === selectedIndex),
        );
        children[selectedIndex]?.scrollIntoView({ block: "nearest" });
    };

    const teleportTo = (r: GeocodeResult): void => {
        setAutopilot(false);
        flyTo(
            plane,
            r.latitude,
            r.longitude,
            Math.max(plane.altitude, FLYTO_ALTITUDE_M),
        );
        resetSunLongitude();
        groundElev = null;
        settleUntil = performance.now() + TERRAIN_SETTLE.durationMs;
        settleFloorAlt = -Infinity;
        if (crashed) setCrashed(false);
        closeSearch();
        setPaused(false);
        updatePlaneModel(
            api,
            planeHandle,
            plane,
            vehicleRotation(vehicle, plane),
        );
        applyCamera();
    };

    const setDestination = (r: GeocodeResult): void => {
        setAutopilot(false);
        destination = {
            latitude: r.latitude,
            longitude: r.longitude,
            label: r.label,
        };
        navArrivedAt = 0;
        navName.textContent = r.label;
        navBanner.classList.add("active");
        navBanner.classList.remove("arrived");
        closeSearch();
        setPaused(false);
    };

    // How far (px) the heading bug slides before pinning to the strip edge.
    const HDG_BUG_MAX_PX = 146;
    const fmtEta = (sec: number): string => {
        if (!isFinite(sec)) return "--:--";
        const total = Math.round(sec);
        const pad = (n: number): string => String(n).padStart(2, "0");
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    };

    const updateNav = (now: number): void => {
        if (!destination) return;
        const { distanceM, bearingRad } = geoDelta(plane, destination);

        const bearingDeg = (bearingRad * 180) / Math.PI;
        const hdgDeg = ((((plane.heading * 180) / Math.PI) % 360) + 360) % 360;
        const off = ((bearingDeg - hdgDeg + 540) % 360) - 180; // [-180, 180]
        const px = Math.max(
            -HDG_BUG_MAX_PX,
            Math.min(HDG_BUG_MAX_PX, off * HDG_PX_PER_DEG),
        );
        hdgBug.setAttribute("transform", `translate(${px.toFixed(1)} 0)`);
        hdgBug.setAttribute("visibility", "visible");

        if (navArrivedAt === 0 && distanceM <= NAV.arrivalRadiusM) {
            navArrivedAt = now;
            navBanner.classList.add("arrived");
            navName.textContent = `${t({ en: "Arrived", fr: "Arrivée" })} · ${destination.label}`;
        }
        if (navArrivedAt !== 0) {
            if (now - navArrivedAt > NAV.arrivedHoldMs) clearDestination();
            return;
        }

        const km = distanceM / 1000;
        navDist.innerHTML = `<b>${km >= 100 ? km.toFixed(0) : km.toFixed(1)} km</b>`;
        const gs = Math.max(plane.vh, NAV.minEtaSpeedMps);
        navEta.innerHTML = `${t({ en: "ETA", fr: "ETA" })} <b>${fmtEta(distanceM / gs)}</b>`;
        navBrg.innerHTML = `BRG <b>${String(Math.round(bearingDeg) % 360).padStart(3, "0")}°</b>`;
    };

    const renderResults = (list: GeocodeResult[]): void => {
        results = list;
        selectedIndex = 0;
        searchStatus.hidden = true;
        const items = list.map((r, i) => {
            const li = document.createElement("li");
            if (i === 0) li.className = "selected";

            const main = document.createElement("div");
            main.className = "r-main";
            const label = document.createElement("span");
            label.className = "r-label";
            label.textContent = r.label;
            main.appendChild(label);
            if (r.detail) {
                const detail = document.createElement("span");
                detail.className = "r-detail";
                detail.textContent = r.detail;
                main.appendChild(detail);
            }
            li.appendChild(main);

            // mousedown, not click: fires before the input blurs.
            const actions = document.createElement("div");
            actions.className = "r-actions";
            const mkBtn = (
                text: string,
                cls: string,
                act: (r: GeocodeResult) => void,
            ) => {
                const b = document.createElement("button");
                b.type = "button";
                b.className = cls;
                b.textContent = text;
                b.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    act(r);
                });
                return b;
            };
            actions.appendChild(
                mkBtn(
                    t({ en: "Set course", fr: "Mettre le cap" }),
                    "r-course",
                    setDestination,
                ),
            );
            actions.appendChild(
                mkBtn(
                    t({ en: "Teleport", fr: "Téléporter" }),
                    "r-teleport",
                    teleportTo,
                ),
            );
            li.appendChild(actions);
            return li;
        });
        searchResults.replaceChildren(...items);
    };

    function openSearch(): void {
        if (modalOpen) return;
        modalOpen = true;
        pausedBeforeModal = paused;
        if (!paused) setPaused(true);
        setInputEnabled(false);
        searchModal.classList.add("open");
        searchInput.value = "";
        setSearchStatus("");
        // No autofocus on touch screens: the keyboard would hide the results.
        if (!TOUCH) searchInput.focus();
    }

    function closeSearch(): void {
        if (!modalOpen) return;
        modalOpen = false;
        searchModal.classList.remove("open");
        setInputEnabled(true);
        clearTimeout(debounceTimer);
        activeSearch?.abort();
        searchInput.blur();
        if (!pausedBeforeModal) setPaused(false);
    }

    searchInput.addEventListener("input", () => {
        const q = searchInput.value;
        clearTimeout(debounceTimer);
        activeSearch?.abort();
        if (!q.trim()) {
            setSearchStatus("");
            return;
        }
        debounceTimer = window.setTimeout(() => {
            const controller = new AbortController();
            activeSearch = controller;
            setSearchStatus(t({ en: "Searching…", fr: "Recherche…" }));
            searchPlaces(q, controller.signal)
                .then((found) => {
                    if (controller.signal.aborted) return;
                    if (found.length) renderResults(found);
                    else
                        setSearchStatus(
                            t({ en: "No matches", fr: "Aucun résultat" }),
                        );
                })
                .catch((err: unknown) => {
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    )
                        return;
                    console.warn("Geocode failed:", err);
                    setSearchStatus(
                        t({
                            en: "Search unavailable",
                            fr: "Recherche indisponible",
                        }),
                    );
                });
        }, 250);
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            closeSearch();
        } else if (e.key === "ArrowDown" && results.length) {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
            highlight();
        } else if (e.key === "ArrowUp" && results.length) {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            highlight();
        } else if (e.key === "Enter") {
            e.preventDefault();
            const r = results[selectedIndex];
            if (r) (e.shiftKey ? teleportTo : setDestination)(r);
        }
    });

    searchModal.addEventListener("mousedown", (e) => {
        if (e.target === searchModal) closeSearch();
    });

    // --- Scenes -------------------------------------------------------------
    // Loading a scene swaps its layers and resets the plane, camera, control mode,
    // minimap and time of day to the scene's defaults.
    let sceneIndex = 0;
    let sceneLoadedAt = performance.now();
    let sceneLayers: SceneLayers = [];
    let sceneLoading = false;

    const updateSceneBadge = (): void => {
        const scene = SCENES[sceneIndex];
        sceneNumber.textContent = `${sceneIndex + 1}/${SCENES.length}`;
        sceneName.textContent = t(scene.name);
        sceneBlurb.textContent = scene.trajectory
            ? t(scene.blurb)
            : `${t(scene.blurb)} — no path recorded yet (T to record)`;
    };

    /** Why a switch happened (logged). */
    type SceneSwitch = "boot" | "manual" | "path-ended" | "unattended";

    // Curtain across automatic scene changes (see SCENE_FADE).
    const fade = document.getElementById("fade") as HTMLDivElement;
    let fadeLift: number | undefined;
    // From the start of the fade-out to the start of the fade-in, the world is
    // frozen, so the change reads as a cut rather than a pan.
    let curtainDown = false;
    const fadeTo = (black: boolean, ms: number): Promise<void> => {
        window.clearTimeout(fadeLift);
        curtainDown = black;
        fade.style.transitionDuration = `${ms}ms`;
        fade.classList.toggle("black", black);
        return new Promise((done) => window.setTimeout(done, ms));
    };

    const loadScene = async (
        index: number,
        why: SceneSwitch,
    ): Promise<void> => {
        if (sceneLoading) return;
        sceneLoading = true;
        const curtain = why === "path-ended" || why === "unattended";
        if (curtain) await fadeTo(true, SCENE_FADE.outMs);
        else window.clearTimeout(fadeLift);
        try {
            const scene = SCENES[index];
            const at = sceneStart(scene);
            console.info(
                `[${(performance.now() / 1000).toFixed(1)}s] ` +
                    `Scene ${index + 1}/${SCENES.length} (${scene.id}) — ${why} @ ` +
                    `${at.latitude.toFixed(4)}, ${at.longitude.toFixed(4)}, ${at.altitude} m`,
            );
            await setVehicle(VEHICLES[scene.vehicle]);
            // Destroy before building: data layer ids are fixed, and two live
            // layers with the same id bind to the wrong data.
            await destroySceneLayers(api, sceneLayers);
            sceneLayers = [];
            sceneLayers = await scene.createLayers(api);
            sceneIndex = index;
            sceneLoadedAt = performance.now();

            closeSearch();
            clearDestination();
            resetPlane(plane, sceneStart(scene));
            groundElev = null;
            settleUntil = performance.now() + TERRAIN_SETTLE.durationMs;
            settleFloorAlt = -Infinity;
            player = scene.trajectory
                ? new TrajectoryPlayer(scene.trajectory)
                : null;
            setAutopilot(player !== null);
            holdAttitude = true;
            updateModeHud();
            cockpit = false;
            cameraDistance = vehicle.camera.distance;
            cameraTilt = scene.cameraTiltRad ?? vehicle.camera.tiltRad;
            lookYaw = 0;
            lookPitch = 0;
            minimapRange = MINIMAP.defaultRangeM;
            setMinimapVisible(scene.minimap === "shown");
            setMainViewLook(api, scene.look ?? "realistic", scene.terrainColor);
            for (const dtm of dtmLayers)
                setDtmVisible(api, dtm, scene.terrain ?? false);
            for (const layer of placeLabelLayers) {
                setVectorTilesVisible(api, layer, scene.placeLabels ?? true);
            }
            // `solarTime` is the local time at the scene's start point.
            sunFixedInSpace = scene.sunFixedInSpace ?? false;
            resetSunLongitude();
            sunBaseHours = sunFixedInSpace
                ? scene.solarTime - scene.start.longitude / 15
                : scene.solarTime;
            refreshSun();
            setCrashed(false);
            setPaused(false);
            lastActivity = performance.now();
            updateSceneBadge();
            updatePlaneModel(
                api,
                planeHandle,
                plane,
                vehicleRotation(vehicle, plane),
            );
            applyCamera();
        } finally {
            sceneLoading = false;
            if (curtain) {
                fadeLift = window.setTimeout(
                    () => void fadeTo(false, SCENE_FADE.inMs),
                    SCENE_FADE.holdMs,
                );
            } else if (fade.classList.contains("black")) {
                void fadeTo(false, SCENE_FADE.inMs);
            }
        }
    };

    /** Next scene for the tour on its own: scenes without a path are skipped (N visits them). */
    const nextAutoIndex = (): number => {
        for (let step = 1; step <= SCENES.length; step++) {
            const index = (sceneIndex + step) % SCENES.length;
            if (SCENES[index].trajectory) return index;
        }
        return sceneIndex;
    };

    const nextScene = (): void => {
        // While recording, N stops it first so the JSON isn't lost.
        if (recorder) {
            stopRecording();
            return;
        }
        void loadScene((sceneIndex + 1) % SCENES.length, "manual");
    };

    window.addEventListener("keydown", (e) => {
        if (modalOpen) return;
        const key = normalizedKey(e);
        // While crashed, only R (reset) and F (search) work.
        if (crashed) {
            if (key === "r") {
                e.preventDefault();
                resetCrash();
            } else if (key === "f") {
                e.preventDefault();
                openSearch();
            }
            return;
        }
        if (key === "f") {
            e.preventDefault();
            openSearch();
        }
        if (key === " " || key === "p") {
            e.preventDefault();
            setPaused(!paused);
        }
        if (key === "g" && destination) {
            e.preventDefault();
            clearDestination();
        }
        // Resume the demo: replay the scene's path.
        if (key === "r" && !autopilot && player) {
            e.preventDefault();
            void loadScene(sceneIndex, "manual");
        }
        if (key === "n") {
            e.preventDefault();
            nextScene();
        }
        if (key === "t") {
            e.preventDefault();
            if (recorder) stopRecording();
            else startRecording();
        }
        if (key === "m") {
            e.preventDefault();
            setMinimapVisible(!minimapVisible);
        }
        if (key === "c") {
            e.preventDefault();
            holdAttitude = !holdAttitude;
            updateModeHud();
        }
        if (key === "v") {
            e.preventDefault();
            cockpit = !cockpit;
            applyCamera();
        }
        // Hidden: download the live scene as a JSON dump (also copied to the clipboard).
        if (key === "e") {
            e.preventDefault();
            void (async () => {
                try {
                    const scene = SCENES[sceneIndex];
                    const json = await dumpScene(api, scene.id);
                    const file = `${scene.id}-scene.json`;
                    const url = URL.createObjectURL(
                        new Blob([json], { type: "application/json" }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = file;
                    link.click();
                    URL.revokeObjectURL(url);
                    await navigator.clipboard
                        ?.writeText(json)
                        .catch(() => undefined);
                    console.info(
                        `Scene dumped: ${file} (${(json.length / 1024).toFixed(0)} kB)`,
                    );
                } catch (err) {
                    console.warn("Scene dump failed:", err);
                }
            })();
        }
        // Hidden: Horizon's dev UI, which needs engine interactions while open.
        if (key === "d") {
            e.preventDefault();
            void (async () => {
                const open = await toggleDevUi(api);
                setUserInteractionsEnabled(api, open);
            })();
        }
    });

    // Action buttons synthesize their key, driving the same handlers as the keyboard.
    for (const kbd of document.querySelectorAll<HTMLElement>(
        "#touch-actions [data-key]",
    )) {
        const k = kbd.dataset.key!;
        const send = (type: "keydown" | "keyup"): void => {
            window.dispatchEvent(new KeyboardEvent(type, { key: k }));
        };
        kbd.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            kbd.setPointerCapture(e.pointerId);
            kbd.classList.add("pressed");
            send("keydown");
        });
        const release = (): void => {
            if (!kbd.classList.contains("pressed")) return;
            kbd.classList.remove("pressed");
            send("keyup");
        };
        kbd.addEventListener("pointerup", release);
        kbd.addEventListener("pointercancel", release);
    }

    bindFlightStick(document.getElementById("stick")!, input);
    const throttleLever = bindThrottleLever(
        document.getElementById("throttle")!,
        input,
    );

    // --- Unattended reset ----------------------------------------------------
    // An abandoned crash or manual flight restarts the tour from its first scene.
    const setIdleWarning = (value: boolean): void => {
        if (value === idleWarning) return;
        idleWarning = value;
        idleToast.classList.toggle("active", value);
    };

    const fullReset = (): void => {
        setIdleWarning(false);
        void loadScene(startSceneIndex(), "unattended");
    };

    // Only while flying manually (paused counts as idle); a crash has its own countdown.
    const updateIdle = (now: number): void => {
        if (autopilot || crashed || recorder) {
            setIdleWarning(false);
            return;
        }
        const remainingMs = AUTO_RESET.idleDelayMs - (now - lastActivity);
        if (remainingMs <= 0) {
            fullReset();
            return;
        }
        setIdleWarning(remainingMs <= AUTO_RESET.idleWarnMs);
        if (idleWarning)
            idleSeconds.textContent = String(Math.ceil(remainingMs / 1000));
    };

    const updateAutoReset = (now: number): void => {
        const remainingMs = autoResetAt - now;
        if (remainingMs <= 0) {
            fullReset();
            return;
        }
        crashSeconds.textContent = String(Math.ceil(remainingMs / 1000));
        const fraction = remainingMs / AUTO_RESET.crashDelayMs;
        crashProgressFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    };

    /** Where the tour opens: `?scene=` if given, else START_SCENE (id, index, or
     *  "last"). Anything unrecognised falls back to the first scene. */
    const startSceneIndex = (): number => {
        const fromUrl = new URLSearchParams(location.search).get("scene");
        const wanted = fromUrl ?? START_SCENE;
        const resolve = (): number => {
            if (wanted === "last") return SCENES.length - 1;
            const byId = SCENES.findIndex((s) => s.id === wanted);
            if (byId >= 0) return byId;
            const index = Number(wanted);
            return Number.isInteger(index) &&
                index >= 0 &&
                index < SCENES.length
                ? index
                : 0;
        };
        const index = resolve();
        console.info(
            `Start scene: ${SCENES[index].id} (index ${index}) — from ` +
                (fromUrl !== null
                    ? `?scene=${fromUrl}`
                    : `START_SCENE=${String(START_SCENE)}`),
        );
        return index;
    };

    // Load the first scene before revealing the page.
    await loadScene(startSceneIndex(), "boot");
    loading.classList.add("hidden");

    const updateDroneHud = (v: PlaneState, agl: number | null): void => {
        const high = vehicle.hudUnits === "high";
        dhSpd.textContent = high ? (v.vh / 1000).toFixed(2) : v.vh.toFixed(1);
        dhAlt.textContent = high
            ? (v.altitude / 1000).toFixed(0)
            : Math.round(v.altitude).toString();
        dhVs.textContent = high
            ? (v.vv >= 0 ? "+" : "") + (v.vv / 1000).toFixed(2)
            : (v.vv >= 0 ? "+" : "") + v.vv.toFixed(1);
        for (const [el, unit] of [
            [dhSpdUnit, high ? "km/s" : "m/s"],
            [dhAltUnit, high ? "km" : "m"],
            [dhVsUnit, high ? "km/s" : "m/s"],
        ] as const) {
            el.textContent = unit;
        }
        const hdg = ((((v.heading * 180) / Math.PI) % 360) + 360) % 360;
        dhHdg.textContent = String(Math.round(hdg) % 360).padStart(3, "0");
        dhAgl.textContent = agl === null ? "—" : Math.round(agl).toString();
        dhAglField.classList.toggle(
            "warning",
            agl !== null && agl <= GPWS.warningAglM,
        );
        dhAglField.classList.toggle(
            "caution",
            agl !== null && agl > GPWS.warningAglM && agl <= GPWS.cautionAglM,
        );
    };

    let last = performance.now();
    const frame = (now: number): void => {
        // Clamped above so a background tab doesn't teleport the plane, and below
        // because the first rAF timestamp can precede performance.now().
        const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
        if (now - last > 1000) {
            console.info(
                `Long frame gap: ${((now - last) / 1000).toFixed(1)}s (clamped to ${dt}s)`,
            );
        }
        last = now;

        let lookDecayed = false;
        if (
            !dragging &&
            (lookYaw !== 0 || lookPitch !== 0) &&
            now - lookReleaseTime > CAMERA.look.returnDelayMs
        ) {
            lookYaw = easeToward(lookYaw, 0, CAMERA.look.returnResponse, dt);
            lookPitch = easeToward(
                lookPitch,
                0,
                CAMERA.look.returnResponse,
                dt,
            );
            if (Math.abs(lookYaw) < 1e-3) lookYaw = 0;
            if (Math.abs(lookPitch) < 1e-3) lookPitch = 0;
            lookDecayed = true;
        }

        if (crashed && autoResetAt !== 0) updateAutoReset(now);
        else updateIdle(now);

        if (!paused && !crashed && !curtainDown) {
            // Held-key zoom; camera only, so it doesn't end attract mode.
            const zoomInput = (input.zoomOut ? 1 : 0) - (input.zoomIn ? 1 : 0);
            if (zoomInput !== 0) zoom(zoomInput * CAMERA.zoomRateMps * dt);

            // Hand control to the player the instant they touch a flight control.
            if (
                autopilot &&
                (input.up ||
                    input.down ||
                    input.left ||
                    input.right ||
                    input.throttleUp ||
                    input.throttleDown ||
                    input.stickX !== 0 ||
                    input.stickY !== 0 ||
                    input.throttleSet !== null)
            ) {
                setAutopilot(false);
            }

            if (autopilot && player) {
                const pose = player.advance(dt);
                // Once the path is spent, hold the last pose until the scene changes.
                if (player.completed) {
                    if (!sceneLoading) {
                        console.info(
                            `Path ended: ${SCENES[sceneIndex].id} after ` +
                                `${player.elapsedSec.toFixed(1)}s of ${player.durationSec.toFixed(1)}s`,
                        );
                        if (now - sceneLoadedAt > SCENE_MIN_DWELL_MS) {
                            void loadScene(nextAutoIndex(), "path-ended");
                        }
                    }
                } else {
                    plane.latitude = pose.latitude;
                    plane.longitude = pose.longitude;
                    plane.altitude = pose.altitude;
                    plane.heading = pose.heading;
                    plane.pitch = pose.pitch;
                    plane.bank = pose.bank;
                    plane.speed = pose.speed;
                    plane.vv = pose.vv;
                    const horiz = Math.sqrt(
                        Math.max(
                            0,
                            pose.speed * pose.speed - pose.vv * pose.vv,
                        ),
                    );
                    plane.flightPathAngle = Math.atan2(
                        pose.vv,
                        Math.max(horiz, 1),
                    );
                    plane.stalled = false;
                }
            } else if (vehicle.flight.kind === "hover") {
                updateHover(plane, input, dt, vehicle.flight);
            } else {
                updatePlane(plane, input, dt, holdAttitude);
            }
            updatePlaneModel(
                api,
                planeHandle,
                plane,
                vehicleRotation(vehicle, plane),
            );
            if (sunFixedInSpace) refreshSun();
            applyCamera();
            if (vehicle.hud === "pfd") {
                updateAttitude(plane);
                updateTapes(plane);
                updateVsi(plane);
                updateThrottleGauge(plane);
            }
            // The lever mirrors the throttle, or the climb rate around mid-travel.
            throttleLever.show(
                vehicle.flight.kind === "hover"
                    ? 0.5 +
                          Math.max(
                              -0.5,
                              Math.min(
                                  0.5,
                                  plane.vv / vehicle.flight.maxClimb / 2,
                              ),
                          )
                    : plane.throttle,
            );
            updateNav(now);
            if (minimapVisible) refreshMinimap();

            // Sample the ground (throttled, non-blocking); null means unknown.
            if (!elevPending && now - lastElevQuery > CRASH.queryIntervalMs) {
                elevPending = true;
                lastElevQuery = now;
                void queryGroundElevation(api, plane.latitude, plane.longitude)
                    .then((g) => {
                        elevPending = false;
                        if (g !== null) groundElev = g;
                    })
                    .catch(() => {
                        elevPending = false;
                    });
            }
            // Settle window after a jump (see TERRAIN_SETTLE); not in attract mode.
            if (
                !autopilot &&
                vehicle.flight.kind === "aircraft" &&
                groundElev !== null &&
                now < settleUntil
            ) {
                const target = groundElev + TERRAIN_SETTLE.arrivalAglM;
                const minAlt = groundElev + TERRAIN_SETTLE.clearanceM;
                const prevAlt = plane.altitude;
                const alt = Math.max(
                    minAlt,
                    easeToward(prevAlt, target, TERRAIN_SETTLE.response, dt),
                );
                if (alt > prevAlt)
                    settleFloorAlt = Math.max(settleFloorAlt, alt);
                plane.altitude = Math.max(alt, settleFloorAlt);
                plane.vv = 0;
                plane.flightPathAngle = 0;
            }
            const agl =
                groundElev !== null ? plane.altitude - groundElev : null;
            updateGpws(agl);
            if (vehicle.hud === "drone") updateDroneHud(plane, agl);
            // An aircraft crashes (manual flight only, after the settle); a hovering
            // vehicle is always held above the ground.
            const blocking = vehicle.collision === "block";
            if (
                agl !== null &&
                agl <= CRASH.clearanceM &&
                groundElev !== null
            ) {
                if (blocking) {
                    plane.altitude = groundElev + CRASH.clearanceM;
                    plane.vv = Math.max(0, plane.vv);
                } else if (!autopilot && now >= settleUntil) {
                    setCrashed(true);
                }
            }

            if (recorder) {
                recorder.sample(plane, now);
                recIndicator.textContent = `● REC  ${recorder.count} samples`;
            }
        } else if (lookDecayed) {
            applyCamera(); // keep recentring while paused or crashed
        }

        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

main().catch((err) => {
    console.error(err);
    loading.textContent = t({
        en: "The 3D view can't start on this device or browser.",
        fr: "La vue 3D ne peut pas démarrer sur cet appareil ou ce navigateur.",
    });
});
