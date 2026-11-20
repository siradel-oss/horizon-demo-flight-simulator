// Flight input: keyboard state plus the stick and lever (ui/touch-controls.ts).

export interface InputState {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    zoomIn: boolean;
    zoomOut: boolean;
    throttleUp: boolean;
    throttleDown: boolean;
    /** Touch stick, -1..1: right banks right, down (pulled) raises the nose. 0 at rest. */
    stickX: number;
    stickY: number;
    /** Throttle lever position 0..1 while it is held, null otherwise. */
    throttleSet: number | null;
}

/**
 * Key token: the lowercased character (event.key), or the key name ("ArrowLeft").
 * Matching characters rather than physical keys keeps the shortcuts on their
 * printed letters on AZERTY, QWERTZ and other layouts.
 */
export function normalizedKey(e: KeyboardEvent): string {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/** The on/off (keyboard) fields of InputState. */
type KeyField = {
    [K in keyof InputState]: InputState[K] extends boolean ? K : never;
}[keyof InputState];

const KEY_MAP: Record<string, KeyField> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    "+": "zoomIn",
    "=": "zoomIn",
    "-": "zoomOut",
    _: "zoomOut",
    q: "throttleUp",
    w: "throttleDown",
};

// Disabled, flight keys pass through to focused UI (the search field), and held
// keys are released.
let enabled = true;
let releaseAll: (() => void) | null = null;
export function setInputEnabled(value: boolean): void {
    enabled = value;
    if (!value) releaseAll?.();
}

export function createInput(): InputState {
    const state: InputState = {
        left: false,
        right: false,
        up: false,
        down: false,
        zoomIn: false,
        zoomOut: false,
        throttleUp: false,
        throttleDown: false,
        stickX: 0,
        stickY: 0,
        throttleSet: null,
    };

    const set = (key: string, pressed: boolean) => {
        const target = KEY_MAP[key];
        if (target) state[target] = pressed;
    };
    const clear = () => {
        state.left = state.right = state.up = state.down = false;
        state.zoomIn = state.zoomOut = false;
        state.throttleUp = state.throttleDown = false;
        state.stickX = state.stickY = 0;
        state.throttleSet = null;
    };
    releaseAll = clear;

    window.addEventListener("keydown", (e) => {
        if (!enabled) return;
        const key = normalizedKey(e);
        if (key in KEY_MAP) {
            e.preventDefault(); // stop the page from scrolling on arrow keys
            set(key, true);
        }
    });
    window.addEventListener("keyup", (e) => {
        if (!enabled) return;
        const key = normalizedKey(e);
        if (key in KEY_MAP) set(key, false);
    });
    window.addEventListener("blur", clear);

    return state;
}
