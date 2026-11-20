// Geodesy and quaternion helpers.

export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface LatLon {
    latitude: number;
    longitude: number;
}

const DEG2RAD = Math.PI / 180;
const WGS84_A = 6378137; // equatorial radius, meters
/**
 * Below this step length the arrival-heading formula is ill-conditioned (it loses
 * its significant digits), so the caller's heading is kept; the real change is
 * negligible anyway.
 */
const HEADING_STEP_MIN_M = 1;

export function degToRad(deg: number): number {
    return deg * DEG2RAD;
}

/**
 * Great-circle step of `distanceMeters` along `headingRad` (clockwise from North),
 * returning the heading on arrival: a straight line on a sphere does not keep its
 * heading, and over a pole north becomes south.
 */
export function stepPosition(
    pos: LatLon,
    headingRad: number,
    distanceMeters: number,
): LatLon & { headingRad: number } {
    if (distanceMeters === 0) {
        return { latitude: pos.latitude, longitude: pos.longitude, headingRad };
    }
    // A negative distance steps backwards: step forward the other way, then turn
    // the reported heading back round so it stays in the caller's sense.
    if (distanceMeters < 0) {
        const back = stepPosition(pos, headingRad + Math.PI, -distanceMeters);
        return {
            ...back,
            headingRad: (back.headingRad + Math.PI) % (Math.PI * 2),
        };
    }
    const delta = distanceMeters / WGS84_A; // angular distance
    const lat = pos.latitude * DEG2RAD;
    const lon = pos.longitude * DEG2RAD;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinDelta = Math.sin(delta);
    const cosDelta = Math.cos(delta);

    const sinLat2 =
        sinLat * cosDelta + cosLat * sinDelta * Math.cos(headingRad);
    const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
    const dLon = Math.atan2(
        Math.sin(headingRad) * sinDelta * cosLat,
        cosDelta - sinLat * sinLat2,
    );
    const lon2 = lon + dLon;
    // Heading on arrival: the bearing back the way it came, turned round.
    const heading2 =
        distanceMeters < HEADING_STEP_MIN_M
            ? headingRad
            : Math.PI +
              Math.atan2(
                  Math.sin(-dLon) * cosLat,
                  Math.cos(lat2) * sinLat -
                      Math.sin(lat2) * cosLat * Math.cos(dLon),
              );
    return {
        latitude: lat2 / DEG2RAD,
        longitude: ((((lon2 / DEG2RAD + 180) % 360) + 360) % 360) - 180,
        headingRad: ((heading2 % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    };
}

/**
 * Horizontal distance (m) and bearing (rad clockwise from North, in [0, 2π)) from
 * `from` to `to`. Flat-earth approximation, enough for navigation readouts.
 */
export function geoDelta(
    from: LatLon,
    to: LatLon,
): { distanceM: number; bearingRad: number } {
    const meanLat = ((from.latitude + to.latitude) / 2) * DEG2RAD;
    const dNorth = (to.latitude - from.latitude) * DEG2RAD * WGS84_A;
    const dEast =
        (to.longitude - from.longitude) * DEG2RAD * WGS84_A * Math.cos(meanLat);
    const distanceM = Math.hypot(dNorth, dEast);
    const bearingRad =
        (Math.atan2(dEast, dNorth) + Math.PI * 2) % (Math.PI * 2);
    return { distanceM, bearingRad };
}

/** Quaternion for a rotation of `angle` radians about a unit axis. */
function quatFromAxisAngle(
    ax: number,
    ay: number,
    az: number,
    angle: number,
): Quat {
    const h = angle * 0.5;
    const s = Math.sin(h);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}

/** Hamilton product a * b. */
function quatMul(a: Quat, b: Quat): Quat {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
}

/**
 * Build the model's orientation quaternion in the engine's default local frame
 * (Z up, Y front/North, X right/East, right-handed).
 *
 * Intrinsic yaw -> pitch -> roll:
 *   - heading: clockwise from North, so yaw is negative about +Z (up).
 *   - pitch:   nose up is positive about +X (right/East).
 *   - roll:    bank about +Y (nose/North).
 */
export function orientationFromAttitude(
    headingRad: number,
    pitchRad: number,
    rollRad: number,
): Quat {
    const yaw = quatFromAxisAngle(0, 0, 1, -headingRad);
    const pitch = quatFromAxisAngle(1, 0, 0, pitchRad);
    const roll = quatFromAxisAngle(0, 1, 0, rollRad);
    return quatMul(yaw, quatMul(pitch, roll));
}

/** Frame-rate independent exponential easing toward a target. */
export function easeToward(
    current: number,
    target: number,
    responsePerSec: number,
    dt: number,
): number {
    const t = 1 - Math.exp(-responsePerSec * dt);
    return current + (target - current) * t;
}
