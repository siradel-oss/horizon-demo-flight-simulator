// Touch flight controls: a virtual stick (roll + pitch) and a throttle lever.
// Both write into the shared InputState read by the flight model each frame.

import type { InputState } from "../input";

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Flight stick: the knob follows the finger within the base's radius and
 * springs back to the centre on release. Deflection maps to -1..1 per axis,
 * with a small dead zone so a resting thumb flies straight.
 */
export function bindFlightStick(base: HTMLElement, input: InputState): void {
    const knob = base.firstElementChild as HTMLElement;
    const DEAD_ZONE = 0.08;
    let pointer: number | null = null;

    const move = (e: PointerEvent): void => {
        const r = base.getBoundingClientRect();
        const radius = r.width / 2;
        let dx = (e.clientX - (r.left + radius)) / radius;
        let dy = (e.clientY - (r.top + radius)) / radius;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
            dx /= len;
            dy /= len;
        }
        knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
        const axis = (v: number): number =>
            Math.abs(v) < DEAD_ZONE ? 0 : clamp1((v - Math.sign(v) * DEAD_ZONE) / (1 - DEAD_ZONE));
        input.stickX = axis(dx);
        input.stickY = axis(dy);
    };
    const release = (e: PointerEvent): void => {
        if (e.pointerId !== pointer) return;
        pointer = null;
        knob.style.transform = "";
        input.stickX = input.stickY = 0;
    };

    base.addEventListener("pointerdown", (e) => {
        if (pointer !== null) return;
        e.preventDefault();
        pointer = e.pointerId;
        base.setPointerCapture(e.pointerId);
        move(e);
    });
    base.addEventListener("pointermove", (e) => {
        if (e.pointerId === pointer) move(e);
    });
    base.addEventListener("pointerup", release);
    base.addEventListener("pointercancel", release);
}

/**
 * Throttle lever: drag up and down along the track. While held it sets the
 * throttle; otherwise it mirrors the current throttle (attract mode, keys).
 */
export function bindThrottleLever(lever: HTMLElement, input: InputState): { show(throttle: number): void } {
    const track = lever.querySelector<HTMLElement>("#throttle-track")!;
    const fill = lever.querySelector<HTMLElement>("#throttle-fill")!;
    const handle = lever.querySelector<HTMLElement>("#throttle-handle")!;
    let pointer: number | null = null;

    const show = (f: number): void => {
        const pct = `${(f * 100).toFixed(1)}%`;
        fill.style.height = pct;
        handle.style.bottom = pct;
        lever.setAttribute("aria-valuenow", (f * 100).toFixed(0));
    };
    const set = (e: PointerEvent): void => {
        const r = track.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height));
        input.throttleSet = f;
        show(f);
    };
    const release = (e: PointerEvent): void => {
        if (e.pointerId !== pointer) return;
        pointer = null;
        input.throttleSet = null;
    };

    lever.addEventListener("pointerdown", (e) => {
        if (pointer !== null) return;
        e.preventDefault();
        pointer = e.pointerId;
        lever.setPointerCapture(e.pointerId);
        set(e);
    });
    lever.addEventListener("pointermove", (e) => {
        if (e.pointerId === pointer) set(e);
    });
    lever.addEventListener("pointerup", release);
    lever.addEventListener("pointercancel", release);

    return {
        show(throttle: number) {
            if (pointer === null) show(throttle);
        },
    };
}
