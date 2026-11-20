// Vehicles: the model, how it answers the controls, and its instruments.
//
// Two flight models: `aircraft`, the arcade aeroplane in plane.ts (lift, stall),
// and `hover`, damped 6-way translation that stops when released (the drone, and
// the orbiter with the numbers scaled up).

/** Axis names as declared to the engine (HrzProtocol.Axis keys). */
type AxisName = "POS_X" | "NEG_X" | "POS_Y" | "NEG_Y" | "POS_Z" | "NEG_Z";

/** How a vehicle answers the controls. */
export type FlightModel =
    | { kind: "aircraft" }
    | {
          kind: "hover";
          /** Top horizontal speed, m/s. */
          maxSpeed: number;
          /** Top climb/descent rate, m/s. */
          maxClimb: number;
          /** Ease rate toward the commanded speed (1/s). */
          accelResponse: number;
          /** Ease rate to a standstill on release (1/s). */
          brakeResponse: number;
          /** Ease rate toward the commanded climb rate (1/s). */
          climbResponse: number;
          /** Rate the nose turns toward the direction of travel (1/s). */
          turnResponse: number;
          /** Cosmetic lean into the movement, radians at full stick. */
          leanRad: number;
          /** Ceiling, metres above the ellipsoid. */
          ceilingM: number;
      };

export interface Vehicle {
    id: string;
    /** Layer name in the engine's dev UI. */
    name: string;
    /** Same-origin path to the glTF model. */
    modelUrl: string;
    /** Credit line; the engine passes it to the attributions bar while visible. */
    attribution: string;
    /**
     * The model's own axes, aligned by the engine with the local tangent frame
     * (front → North, up → Up at heading 0). Measure them from the file rather than
     * assuming a convention, and always set `handedness`: unset means LEFT, which
     * mirrors the model and inverts every rotation.
     */
    frame: { up: AxisName; front: AxisName; handedness: "LEFT" | "RIGHT" };
    /** Uniform scale applied to the model. */
    scale: number;
    /** glTF clips to run (propellers/rotors), and how fast. */
    animations: string[];
    animationSpeed: number;
    /** Render-only corrections. */
    headingOffsetDeg: number;
    pitchRenderSign: number;
    bankRenderSign: number;
    flight: FlightModel;
    /** Chase camera: distances (m) and tilt (0 = straight down, PI/2 = horizon). */
    camera: {
        distance: number;
        minDistance: number;
        maxDistance: number;
        tiltRad: number;
    };
    /** Hitting the ground: `crash` ends the flight, `block` stops the descent. */
    collision: "crash" | "block";
    /** Instrument panel. */
    hud: "pfd" | "drone";
    /** Readout units: `low` is m/s and m, `high` is km/s and km. */
    hudUnits: "low" | "high";
}

export const VEHICLES = {
    plane: {
        id: "plane",
        name: "Cessna",
        modelUrl: "models/plane.glb",
        attribution: "Plane: Cesium Air © CesiumJS contributors (Apache-2.0)",
        // Measured: the nose is +Z, not the glTF default -Z.
        frame: { up: "POS_Y", front: "POS_Z", handedness: "RIGHT" },
        scale: 1,
        animations: ["Prop__2_Action_Prop", "PropAction_Prop__2_"],
        animationSpeed: 4,
        headingOffsetDeg: 0,
        pitchRenderSign: 1,
        bankRenderSign: 1,
        flight: { kind: "aircraft" },
        collision: "crash",
        camera: {
            distance: 130,
            minDistance: 35,
            maxDistance: 400,
            tiltRad: 1.2,
        },
        hud: "pfd",
        hudUnits: "low",
    },
    drone: {
        id: "drone",
        name: "Quadcopter",
        modelUrl: "models/drone-anim.glb",
        attribution: "Drone model © amvlab (CC BY 4.0), modified",
        // Symmetric model, Y up: the nose is the glTF default -Z.
        frame: { up: "POS_Y", front: "NEG_Z", handedness: "RIGHT" },
        // ~4× real size, or it is a speck from any useful camera distance.
        scale: 4,
        // One one-revolution clip per rotor, so the speed is in rev/s. Kept low:
        // faster, the blade passes alias with the frame rate and look frozen.
        animations: ["RotorSpin0", "RotorSpin1", "RotorSpin2", "RotorSpin3"],
        animationSpeed: 1.5,
        headingOffsetDeg: 0,
        pitchRenderSign: 1,
        bankRenderSign: 1,
        flight: {
            kind: "hover",
            maxSpeed: 45, // ~160 km/h, faster than a real quadcopter
            maxClimb: 15,
            accelResponse: 2.0,
            brakeResponse: 2.6,
            climbResponse: 2.8,
            turnResponse: 2.0,
            leanRad: 0.28,
            ceilingM: 6000,
        },
        collision: "block",
        camera: {
            distance: 16,
            minDistance: 6,
            maxDistance: 90,
            tiltRad: 1.15,
        },
        hud: "drone",
        hudUnits: "low",
    },
    orbiter: {
        id: "orbiter",
        name: "Orbiter",
        modelUrl: "models/shuttle.glb",
        attribution: "Space Shuttle (D) model: NASA/JSC, NASA 3D Resources",
        frame: { up: "POS_Z", front: "POS_X", handedness: "RIGHT" },
        scale: 0.0253,
        animations: [],
        animationSpeed: 0,
        headingOffsetDeg: 0,
        pitchRenderSign: 1,
        bankRenderSign: 1,
        flight: {
            kind: "hover",
            // 1500 km/s, ~200× orbital velocity: a lap every ~28 s so the globe
            // visibly turns. Much faster and imagery can't stream, and day and
            // night strobe. Not orbital mechanics: the drone's controls, scaled.
            maxSpeed: 1500000,
            maxClimb: 250000,
            accelResponse: 0.6,
            brakeResponse: 0.8,
            climbResponse: 1.0,
            turnResponse: 0.35,
            leanRad: 0.15,
            ceilingM: 20000000,
        },
        collision: "block",
        // From 400 km the limb is 70° off nadir: a 63° tilt frames the ground with
        // the limb across the top third.
        camera: {
            distance: 220,
            minDistance: 80,
            maxDistance: 40000,
            tiltRad: 1.1,
        },
        hud: "drone",
        hudUnits: "high",
    },
} as const satisfies Record<string, Vehicle>;

export type VehicleId = keyof typeof VEHICLES;
