// Flight models. The aeroplane is a point mass in the vertical plane of travel
// with a stalling lift curve (see FLIGHT) and a coordinated turn from bank;
// pitch is nose-up positive, bank right-wing-down positive. Hovering vehicles
// use updateHover.

import { FLIGHT, START } from "./config";
import type { InputState } from "./input";
import { degToRad, easeToward, stepPosition } from "./math";
import type { FlightModel } from "./vehicles";

export interface PlaneState {
    latitude: number;
    longitude: number;
    /** Meters above the WGS84 ellipsoid. */
    altitude: number;
    /** Radians, clockwise from North. */
    heading: number;
    /** Body pitch attitude, radians, nose-up positive. */
    pitch: number;
    /** Bank, radians, right-wing-down positive. */
    bank: number;
    /** Engine throttle, 0..1. */
    throttle: number;
    /** Airspeed magnitude, m/s. */
    speed: number;
    /** Climb angle of the velocity vector, radians. */
    flightPathAngle: number;
    /** True while the wing is stalled (angle of attack past critical). */
    stalled: boolean;

    /** Horizontal airspeed along the heading, m/s. Negative when reversing. */
    vh: number;
    /** Sideways speed, m/s, positive to the right (hovering vehicles only). */
    vRight: number;
    /** Vertical speed (climb positive), m/s. */
    vv: number;
}

/** Where a flight begins: a position plus the compass heading to point at. */
export interface StartPose {
    latitude: number;
    longitude: number;
    /** Metres above the WGS84 ellipsoid. */
    altitude: number;
    /** Degrees clockwise from North. */
    headingDeg: number;
}

/** A plane at the start of a leg: `start`'s pose, cruise speed, cruise throttle. */
export function createPlane(start: StartPose = START): PlaneState {
    return {
        latitude: start.latitude,
        longitude: start.longitude,
        altitude: start.altitude,
        heading: degToRad(start.headingDeg),
        pitch: 0,
        bank: 0,
        throttle: FLIGHT.startThrottle,
        speed: FLIGHT.startSpeedMps,
        flightPathAngle: 0,
        stalled: false,
        vh: FLIGHT.startSpeedMps,
        vRight: 0,
        vv: 0,
    };
}

/** Reset the plane to a start pose in place (the object is shared). */
export function resetPlane(plane: PlaneState, start: StartPose = START): void {
    Object.assign(plane, createPlane(start));
}

/** Teleport, levelled at `altitude`, keeping heading, throttle and speed. */
export function flyTo(
    plane: PlaneState,
    latitude: number,
    longitude: number,
    altitude: number,
): void {
    plane.latitude = latitude;
    plane.longitude = longitude;
    plane.altitude = altitude;
    plane.pitch = 0;
    plane.bank = 0;
    plane.vv = 0;
    plane.vh = plane.speed;
    plane.flightPathAngle = 0;
    plane.stalled = false;
}

/**
 * Hovering vehicle: forward/back and left/right on the arrows, up/down on the
 * thrust keys, braking to a standstill on release. Velocity is in the vehicle's
 * frame; the nose turns toward the direction of travel only while moving forward.
 * Pitch and bank are cosmetic.
 */
export function updateHover(
    v: PlaneState,
    input: InputState,
    dt: number,
    flight: Extract<FlightModel, { kind: "hover" }>,
): void {
    // Keys give full deflection, the stick a proportional one; the lever commands
    // the climb rate around mid-travel while held.
    const forward = clamp(
        (input.up ? 1 : 0) - (input.down ? 1 : 0) - input.stickY,
        -1,
        1,
    );
    const side = clamp(
        (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.stickX,
        -1,
        1,
    );
    const lever =
        input.throttleSet === null ? 0 : (input.throttleSet - 0.5) * 2;
    const climb = clamp(
        (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0) + lever,
        -1,
        1,
    );

    // Each axis brakes on its own when released.
    const norm = Math.max(1, Math.hypot(forward, side)); // no diagonal speed bonus
    v.vh = easeToward(
        v.vh,
        (flight.maxSpeed * forward) / norm,
        forward !== 0 ? flight.accelResponse : flight.brakeResponse,
        dt,
    );
    v.vRight = easeToward(
        v.vRight,
        (flight.maxSpeed * side) / norm,
        side !== 0 ? flight.accelResponse : flight.brakeResponse,
        dt,
    );
    v.vv = easeToward(v.vv, climb * flight.maxClimb, flight.climbResponse, dt);

    // Turn toward the direction of travel only while the input asks for forward
    // and the vehicle moves forward, weighted by forward speed so mostly sideways
    // motion doesn't whip the nose round. The velocity is then rotated into the
    // new body frame, or the vehicle would keep turning after release.
    if (forward > 0 && v.vh > 0.05 * flight.maxSpeed) {
        const before = v.heading;
        const chase = flight.turnResponse * Math.min(1, v.vh / flight.maxSpeed);
        turnToward(v, v.heading + Math.atan2(v.vRight, v.vh), chase, dt);
        let turned = (v.heading - before) % (Math.PI * 2);
        if (turned > Math.PI) turned -= Math.PI * 2;
        if (turned < -Math.PI) turned += Math.PI * 2;
        const cos = Math.cos(turned);
        const sin = Math.sin(turned);
        const forwardSpeed = v.vh;
        v.vh = forwardSpeed * cos + v.vRight * sin;
        v.vRight = -forwardSpeed * sin + v.vRight * cos;
    }

    // Cosmetic attitude: lean into the run, roll into the slide.
    v.pitch = easeToward(
        v.pitch,
        (-flight.leanRad * v.vh) / flight.maxSpeed,
        3,
        dt,
    );
    v.bank = easeToward(
        v.bank,
        (flight.leanRad * v.vRight) / flight.maxSpeed,
        3,
        dt,
    );

    const groundSpeed = Math.hypot(v.vh, v.vRight);
    v.throttle = Math.min(1, groundSpeed / flight.maxSpeed); // for the lever readout
    v.speed = Math.hypot(groundSpeed, v.vv);
    v.flightPathAngle = Math.atan2(v.vv, Math.max(groundSpeed, 0.01));
    v.stalled = false;

    // Cancel the descent when the floor clamp bites, so no fall builds up.
    const wanted = v.altitude + v.vv * dt;
    v.altitude = clamp(wanted, FLIGHT.minAltitude, flight.ceilingM);
    if (v.altitude !== wanted) v.vv = 0;
    // Forward, then sideways, each carrying the heading change of the sphere.
    const ahead = stepPosition(v, v.heading, v.vh * dt);
    v.latitude = ahead.latitude;
    v.longitude = ahead.longitude;
    v.heading = ahead.headingRad;
    const across = stepPosition(v, v.heading + Math.PI / 2, v.vRight * dt);
    v.latitude = across.latitude;
    v.longitude = across.longitude;
    v.heading = wrapAngle(across.headingRad - Math.PI / 2);
}

/** Ease a heading toward a target, the shortest way round the compass. */
function turnToward(
    v: PlaneState,
    target: number,
    responsePerSec: number,
    dt: number,
): void {
    let delta = (target - v.heading) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    v.heading = wrapAngle(
        v.heading + delta * (1 - Math.exp(-responsePerSec * dt)),
    );
}

/** Lift coefficient vs. angle of attack: linear up to the stall, then collapses. */
function liftCoefficient(alpha: number): number {
    const clMax = FLIGHT.clAlphaPerRad * FLIGHT.alphaStallRad;
    if (alpha <= FLIGHT.alphaStallRad) return FLIGHT.clAlphaPerRad * alpha;
    return Math.max(
        FLIGHT.clMin,
        clMax - FLIGHT.postStallSlope * (alpha - FLIGHT.alphaStallRad),
    );
}

/**
 * Advance the aeroplane by `dt` seconds. `holdAttitude` false ("assist"): pitch
 * and bank follow the input and self-centre on release; true ("manual"): input
 * sets a rate and the attitude holds on release.
 */
export function updatePlane(
    plane: PlaneState,
    input: InputState,
    dt: number,
    holdAttitude: boolean,
): void {
    const g = FLIGHT.gravity;

    const throttleCmd =
        (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0);
    plane.throttle = clamp(
        plane.throttle + throttleCmd * FLIGHT.throttleRate * dt,
        0,
        1,
    );
    if (input.throttleSet !== null)
        plane.throttle = clamp(input.throttleSet, 0, 1);

    // Yoke convention: Up = nose down. Keys give full deflection, the stick a
    // proportional one.
    const pitchCmd = clamp(
        (input.down ? 1 : 0) - (input.up ? 1 : 0) + input.stickY,
        -1,
        1,
    );
    const bankCmd = clamp(
        (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.stickX,
        -1,
        1,
    );

    // Roll first: bank sets the axis the elevator rotates the nose about.
    if (holdAttitude) {
        plane.bank = clamp(
            plane.bank + bankCmd * FLIGHT.bankRateRadPerSec * dt,
            -FLIGHT.maxBankRad,
            FLIGHT.maxBankRad,
        );
    } else {
        const bankResp =
            bankCmd !== 0 ? FLIGHT.bankResponse : FLIGHT.bankCenterResponse;
        plane.bank = easeToward(
            plane.bank,
            bankCmd * FLIGHT.maxBankRad,
            bankResp,
            dt,
        );
    }

    // The elevator acts about the body's lateral axis: banked by φ, it splits into
    // pitch (cos φ) and heading (tan φ of the pitch change actually applied, so the
    // turn stops when pitch hits its clamp).
    const pitchResp =
        pitchCmd !== 0 ? FLIGHT.pitchResponse : FLIGHT.pitchCenterResponse;
    const pitchBodyRate = holdAttitude
        ? pitchCmd * FLIGHT.pitchRateRadPerSec
        : (pitchCmd * FLIGHT.maxPitchRad - plane.pitch) * pitchResp;
    const prevPitch = plane.pitch;
    plane.pitch = clamp(
        prevPitch + pitchBodyRate * Math.cos(plane.bank) * dt,
        -FLIGHT.maxPitchRad,
        FLIGHT.maxPitchRad,
    );
    plane.heading = wrapAngle(
        plane.heading + (plane.pitch - prevPitch) * Math.tan(plane.bank),
    );

    // Aerodynamics in the vertical plane of travel.
    const v = Math.hypot(plane.vh, plane.vv);
    const gamma = Math.atan2(plane.vv, plane.vh);
    const alpha = plane.pitch - gamma + FLIGHT.alphaTrimRad;
    plane.stalled = alpha > FLIGHT.alphaStallRad;

    const density = Math.exp(-plane.altitude / FLIGHT.densityScaleHeightM);

    const maxLift = FLIGHT.maxLiftG * g;
    const lift = clamp(
        density * FLIGHT.liftK * v * v * liftCoefficient(alpha),
        -maxLift,
        maxLift,
    );
    const drag = density * FLIGHT.dragK * v * v;
    const thrust = density * plane.throttle * FLIGHT.thrustAccelMax;
    const cosBank = Math.cos(plane.bank);

    // Lift perpendicular to velocity (its vertical-plane share when banked), drag
    // against it, thrust along the nose.
    const ax =
        -lift * cosBank * Math.sin(gamma) -
        drag * Math.cos(gamma) +
        thrust * Math.cos(plane.pitch);
    const ay =
        lift * cosBank * Math.cos(gamma) -
        drag * Math.sin(gamma) +
        thrust * Math.sin(plane.pitch) -
        g;

    plane.vh = Math.max(FLIGHT.minForwardSpeed, plane.vh + ax * dt);
    plane.vv += ay * dt;

    plane.speed = Math.hypot(plane.vh, plane.vv);
    plane.flightPathAngle = Math.atan2(plane.vv, plane.vh);

    // Coordinated turn from the horizontal component of lift.
    plane.heading = wrapAngle(
        plane.heading +
            ((lift * Math.sin(plane.bank)) / Math.max(plane.speed, 1)) * dt,
    );

    plane.altitude = clamp(
        plane.altitude + plane.vv * dt,
        FLIGHT.minAltitude,
        FLIGHT.maxAltitude,
    );
    const next = stepPosition(plane, plane.heading, plane.vh * dt);
    plane.latitude = next.latitude;
    plane.longitude = next.longitude;
    plane.heading = next.headingRad;
}

function wrapAngle(a: number): number {
    const twoPi = Math.PI * 2;
    return ((a % twoPi) + twoPi) % twoPi;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
