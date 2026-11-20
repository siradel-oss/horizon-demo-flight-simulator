// Device profile, decided once at load.

/** Touch screen as the main pointer. */
export const TOUCH = matchMedia("(pointer: coarse)").matches;

/** A phone: touch screen whose small side is under 600 CSS px. */
export const PHONE = TOUCH && Math.min(screen.width, screen.height) < 600;
