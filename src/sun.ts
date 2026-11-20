// Sun direction at a latitude, day and local solar time, for a sun pinned in
// space: the engine eases between successive solar times, so a time crossing
// midnight would sweep the sun backwards through a day, whereas angles don't wrap.
//
// Low-precision solar position, good to a fraction of a degree.

const DEG = Math.PI / 180;

export interface SunAngles {
    /** Radians clockwise from north. */
    azimuth: number;
    /** Radians above the horizon; negative when the sun is down. */
    altitude: number;
}

/** The sun's declination for a day of the year: its latitude, ±23.44°. */
function declination(dayOfYear: number): number {
    return 23.44 * DEG * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
}

/** Sun azimuth and altitude; the hour angle is 15° per hour from local solar noon. */
export function sunAngles(
    latitudeDeg: number,
    dayOfYear: number,
    localSolarTime: number,
): SunAngles {
    const dec = declination(dayOfYear);
    const hourAngle = (localSolarTime - 12) * 15 * DEG;
    const lat = latitudeDeg * DEG;
    const sinAlt =
        Math.sin(lat) * Math.sin(dec) +
        Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
    const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    // From north, turning east, as in the engine's local frame.
    const azimuth = Math.atan2(
        -Math.sin(hourAngle) * Math.cos(dec),
        Math.sin(dec) * Math.cos(lat) -
            Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle),
    );
    return { azimuth, altitude };
}
