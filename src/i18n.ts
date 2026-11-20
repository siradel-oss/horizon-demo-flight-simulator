// EN/FR interface. Strings are { en, fr } pairs resolved once: switching
// language reloads the page. Static HTML is tagged with data-i18n="<key>"
// (text) or data-i18n-<attr>="<key>" (attribute).

export type Lang = "en" | "fr";
export type Text = { en: string; fr: string };

const STORAGE_KEY = "horizon-demo-flight-simulator:lang";

function initialLang(): Lang {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl === "en" || fromUrl === "fr") return fromUrl;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "en" || stored === "fr") return stored;
    } catch {
        // Storage blocked (private mode): fall back to the browser language.
    }
    return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const LANG: Lang = initialLang();
document.documentElement.lang = LANG;

/** Resolve a { en, fr } pair in the current language. */
export const t = (s: Text): string => s[LANG];

/** Persist the choice and reload. */
export function setLang(lang: Lang): void {
    if (lang === LANG) return;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // Not persisted: the URL parameter still carries it.
    }
    const url = new URL(location.href);
    url.searchParams.set("lang", lang);
    location.assign(url);
}

/** Text of the static HTML (index.html), by data-i18n key. */
const STATIC: Record<string, Text> = {
    restartIn: { en: "Restarting the demo in", fr: "Reprise de la démo dans" },
    keepFlying: {
        en: "— touch the controls to keep flying",
        fr: "— touchez les commandes pour continuer",
    },
    map: { en: "MAP", fr: "CARTE" },
    crashText: {
        en: "You flew into the ground.",
        fr: "Vous avez percuté le relief.",
    },
    crashReset: { en: "↻ Reset (R)", fr: "↻ Repartir (R)" },
    loading: { en: "Loading…", fr: "Chargement…" },
    throttle: { en: "Throttle", fr: "Gaz" },
};

const ATTRS: Record<string, Text> = {
    searchPlaceholder: {
        en: "Search…  town, mountain, lake",
        fr: "Rechercher…  ville, sommet, lac",
    },
    searchLabel: { en: "Search for a place", fr: "Rechercher un lieu" },
    hideMinimap: { en: "Hide minimap (M)", fr: "Masquer la mini-carte (M)" },
    clearDestination: {
        en: "Clear destination (G)",
        fr: "Effacer la destination (G)",
    },
    about: { en: "About", fr: "À propos" },
    language: { en: "Français", fr: "English" },
    actDemo: { en: "Resume the demo", fr: "Reprendre la démo" },
    actNext: { en: "Next scene", fr: "Scène suivante" },
    actView: { en: "Change view", fr: "Changer de vue" },
    sources: {
        en: "Data sources and licences",
        fr: "Sources des données et licences",
    },
    actSearch: { en: "Fly to a place", fr: "Voler vers un lieu" },
    actMap: { en: "Minimap", fr: "Mini-carte" },
    actPause: { en: "Pause", fr: "Pause" },
    stick: {
        en: "Flight stick: roll and pitch",
        fr: "Manche : roulis et tangage",
    },
};

/** Fill the static HTML: data-i18n sets the text, data-i18n-<attr> an attribute. */
export function translatePage(): void {
    for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
        const s = STATIC[el.dataset.i18n!];
        if (s) el.textContent = t(s);
    }
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
        for (const attr of el.getAttributeNames()) {
            if (!attr.startsWith("data-i18n-")) continue;
            const s = ATTRS[el.getAttribute(attr)!];
            if (s) el.setAttribute(attr.slice("data-i18n-".length), t(s));
        }
    }
}
