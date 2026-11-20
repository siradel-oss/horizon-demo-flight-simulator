// Recorded flight paths for attract mode: evenly spaced samples (one every
// `intervalMs`), each a compact tuple so the JSON stays hand-editable:
//
//     [latitude, longitude, altitudeM, headingDeg, pitchDeg, bankDeg]
//
// A path that ends near its start is sealed into a seamless loop; any other
// path plays once and stops.

import { TRAJECTORY } from "./config";
import { degToRad } from "./math";
import type { PlaneState } from "./plane";

/** One recorded sample: [lat, lon, altM, headingDeg, pitchDeg, bankDeg]. */
export type TrajectorySample = [number, number, number, number, number, number];

export interface TrajectoryData {
    /** Milliseconds between consecutive samples. */
    intervalMs: number;
    samples: TrajectorySample[];
}

/** Pose handed to the sim each frame during playback (angles in radians). */
export interface TrajectoryPose {
    latitude: number;
    longitude: number;
    altitude: number;
    heading: number;
    pitch: number;
    bank: number;
    /** Derived from neighbouring samples, for the HUD tapes. */
    speed: number;
    /** Vertical speed (climb positive), m/s, for the VSI. */
    vv: number;
}

const WGS84_A = 6378137; // meters
const DEG2RAD = Math.PI / 180;

/** How near a path's end must be to its start to count as closing on itself. */
const LOOP_CLOSE_M = 60;

/** Flat-earth horizontal distance between two lat/lon points, in meters. */
function horizontalDistanceM(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const meanLat = ((lat1 + lat2) / 2) * DEG2RAD;
    const dNorth = (lat2 - lat1) * DEG2RAD * WGS84_A;
    const dEast =
        deltaLonDeg(lon1, lon2) * DEG2RAD * WGS84_A * Math.cos(meanLat);
    return Math.hypot(dNorth, dEast);
}

/** Signed difference between two longitudes, the short way round (−180, 180]. */
function deltaLonDeg(from: number, to: number): number {
    return ((to - from + 540) % 360) - 180;
}

/** Interpolate longitude the short way round (across the antimeridian), in [−180, 180). */
function lerpLonDeg(a: number, b: number, t: number): number {
    const lon = a + deltaLonDeg(a, b) * t;
    return ((lon + 540) % 360) - 180;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Interpolate an angle (radians) the shortest way round the circle. */
function lerpAngleRad(a: number, b: number, t: number): number {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

/** Plays a recorded trajectory; call `advance(dt)` each frame for the interpolated pose. */
export class TrajectoryPlayer {
    private readonly intervalSec: number;
    /** Per-sample pose in radians: [lat, lon, alt, headingRad, pitchRad, bankRad]. */
    private readonly poses: TrajectorySample[];
    /** Horizontal ground speed of each segment i -> i+1, m/s. */
    private readonly segSpeed: number[];
    /** Vertical speed of each segment i -> i+1, m/s. */
    private readonly segVv: number[];
    /** Position along the loop, in seconds. */
    private phase = 0;
    /** How long one pass of the path takes, in seconds. */
    get durationSec(): number {
        return this.segments * this.intervalSec;
    }
    /** How far into the path the playback currently is, in seconds. */
    get elapsedSec(): number {
        return this.phase;
    }
    /** Whether the path closes on itself, and how many segments it therefore has. */
    private readonly looping: boolean;
    private readonly segments: number;
    /** Seconds of playback accumulated, never wrapped — what `completed` counts. */
    private travelled = 0;
    /** True once a full pass of the path has been flown. The scene machine uses
     *  it to move on; a looping path keeps playing seamlessly meanwhile. */
    completed = false;

    constructor(data: TrajectoryData) {
        this.intervalSec = data.intervalMs / 1000;
        this.poses = data.samples.map(
            ([lat, lon, alt, hdg, pitch, bank]) =>
                [
                    lat,
                    lon,
                    alt,
                    degToRad(hdg),
                    degToRad(pitch),
                    degToRad(bank),
                ] as TrajectorySample,
        );

        // An open path has no wrapping segment back to its start.
        const n = this.poses.length;
        const first = this.poses[0];
        const last = this.poses[n - 1];
        const gap =
            n > 1
                ? horizontalDistanceM(first[0], first[1], last[0], last[1])
                : 0;
        const tail =
            n > 2
                ? horizontalDistanceM(
                      this.poses[n - 2][0],
                      this.poses[n - 2][1],
                      last[0],
                      last[1],
                  )
                : 0;
        // Closed if the end is about where one more step would have put it.
        this.looping = n > 2 && gap <= Math.max(LOOP_CLOSE_M, tail * 2);
        this.segments = this.looping ? n : Math.max(1, n - 1);

        // Per-segment speeds, for the instruments during playback.
        this.segSpeed = [];
        this.segVv = [];
        for (let i = 0; i < this.segments; i++) {
            const a = this.poses[i];
            const b = this.poses[this.looping ? (i + 1) % n : i + 1];
            const horiz = horizontalDistanceM(a[0], a[1], b[0], b[1]);
            const dAlt = b[2] - a[2];
            this.segSpeed.push(Math.hypot(horiz, dAlt) / this.intervalSec);
            this.segVv.push(dAlt / this.intervalSec);
        }
    }

    /** Advance the phase by `dt` seconds and return the interpolated pose. */
    advance(dt: number): TrajectoryPose {
        const n = this.poses.length;
        const loopSec = this.segments * this.intervalSec;
        // Completion is accumulated, not inferred from the wrapped phase, so a
        // negative step can't mark the path finished.
        this.travelled += Math.max(0, dt);
        if (this.travelled >= loopSec) this.completed = true;
        if (this.completed && !this.looping) {
            this.phase = loopSec;
        } else {
            this.phase = (this.phase + dt) % loopSec;
            if (this.phase < 0) this.phase += loopSec;
        }

        const f = this.phase / this.intervalSec;
        // Clamped to the last real segment.
        const i = Math.min(Math.floor(f), this.segments - 1);
        const j = this.looping ? (i + 1) % n : i + 1;
        const t = f - Math.floor(f);
        const a = this.poses[i];
        const b = this.poses[j];
        return {
            latitude: lerp(a[0], b[0], t),
            longitude: lerpLonDeg(a[1], b[1], t),
            altitude: lerp(a[2], b[2], t),
            heading: lerpAngleRad(a[3], b[3], t),
            pitch: lerp(a[4], b[4], t),
            bank: lerp(a[5], b[5], t),
            speed: this.segSpeed[i],
            vv: this.segVv[i],
        };
    }
}

/**
 * Records the live plane: call `sample` each frame (time-based, so frame-rate
 * independent) and `stop` to get the data.
 */
export class TrajectoryRecorder {
    private readonly samples: TrajectorySample[] = [];
    private lastSampleMs = -Infinity;

    /** Samples captured so far. */
    get count(): number {
        return this.samples.length;
    }

    /** Record the plane if an interval has elapsed since the last sample. */
    sample(plane: PlaneState, nowMs: number): void {
        if (nowMs - this.lastSampleMs < TRAJECTORY.intervalMs) return;
        this.lastSampleMs = nowMs;
        this.samples.push([
            plane.latitude,
            plane.longitude,
            plane.altitude,
            (plane.heading * 180) / Math.PI,
            (plane.pitch * 180) / Math.PI,
            (plane.bank * 180) / Math.PI,
        ]);
    }

    /**
     * Finish recording. Returns null if too little was captured to be useful.
     * A path that ends within `captureRadiusM` of its start is treated as a loop
     * and sealed; anything else is left open.
     */
    stop(): TrajectoryData | null {
        if (this.samples.length < 3) return null;
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const closes =
            horizontalDistanceM(first[0], first[1], last[0], last[1]) <=
            TRAJECTORY.captureRadiusM;
        return this.finalize(closes);
    }

    /**
     * Copy the samples out; for a loop, ease the tail toward the start pose (weights
     * stop short of 1, so the last sample doesn't duplicate the first).
     */
    private finalize(seal: boolean): TrajectoryData {
        const samples = this.samples.map((s) => [...s] as TrajectorySample);
        if (!seal) return { intervalMs: TRAJECTORY.intervalMs, samples };
        const start = samples[0];
        const n = samples.length;
        const tail = Math.min(TRAJECTORY.sealSamples, n - 1);
        for (let k = 1; k <= tail; k++) {
            const idx = n - tail - 1 + k;
            const w = k / (tail + 1);
            const s = samples[idx];
            s[0] = lerp(s[0], start[0], w);
            s[1] = lerp(s[1], start[1], w);
            s[2] = lerp(s[2], start[2], w);
            s[3] = blendAngleDeg(s[3], start[3], w);
            s[4] = lerp(s[4], start[4], w);
            s[5] = lerp(s[5], start[5], w);
        }
        return { intervalMs: TRAJECTORY.intervalMs, samples };
    }
}

/** Blend two heading angles in degrees the shortest way round. */
function blendAngleDeg(a: number, b: number, t: number): number {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return a + d * t;
}

/** Serialise a trajectory as JSON, one sample per line, for src/trajectory-data.ts. */
export function serializeTrajectory(data: TrajectoryData): string {
    const rows = data.samples
        .map(([lat, lon, alt, hdg, pitch, bank]) => {
            const t = [
                lat.toFixed(6),
                lon.toFixed(6),
                alt.toFixed(1),
                hdg.toFixed(2),
                pitch.toFixed(2),
                bank.toFixed(2),
            ].join(", ");
            return `        [${t}]`;
        })
        .join(",\n");
    return `{
    "intervalMs": ${data.intervalMs},
    "samples": [
${rows}
    ]
}`;
}
