// "About" dialog: what the app is (a Horizon demonstrator), its limits, privacy,
// data sources and licences, links and contact. Opens by itself on the first
// visit; `open("sources")` scrolls to the data sources (credit line).

import { t, type Text } from "../i18n";
import { LINKS } from "../links";
import { h } from "./dom";
import { SIRADEL_LOGO } from "./siradel-logo";

const SEEN_KEY = "horizon-demo-flight-simulator:about-seen";

const a = (href: string, text: string) =>
    h("a", { href, target: "_blank", rel: "noopener" }, text);

/** A paragraph mixing text and links: string parts are { en, fr } pairs. */
const p = (...parts: (Text | Node)[]) =>
    h("p", {}, ...parts.map((x) => (x instanceof Node ? x : t(x))));

interface Source {
    producer: string;
    datasets: Text;
    licence: [string, string];
}

const SOURCES: Source[] = [
    {
        producer: "IGN, Géoplateforme",
        datasets: {
            en: "Orthophotos (France, and world imagery seen from orbit), RGE ALTI relief (Chamonix), place search (geocoding)",
            fr: "Orthophotos (France, et imagerie mondiale vue d'orbite), relief RGE ALTI (Chamonix), recherche de lieux (géocodage)",
        },
        licence: [
            "Licence Ouverte 2.0",
            "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
        ],
    },
    {
        producer: "Mapzen, AWS",
        datasets: {
            en: "Terrain Tiles (Terrarium) worldwide elevation, under the Chamonix relief outside France, from SRTM, GMTED, ETOPO1 and national sources",
            fr: "Altimétrie mondiale Terrain Tiles (Terrarium), sous le relief de Chamonix hors de France, issue de SRTM, GMTED, ETOPO1 et de sources nationales",
        },
        licence: [
            "Attribution",
            "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
        ],
    },
    {
        producer: "OpenMapTiles, OpenStreetMap",
        datasets: {
            en: "Place names, peaks, passes, lakes and the minimap, © OpenMapTiles © OpenStreetMap contributors (tiles served by data.gouv.fr)",
            fr: "Noms de lieux, sommets, cols, lacs et mini-carte, © OpenMapTiles © contributeurs OpenStreetMap (tuiles servies par data.gouv.fr)",
        },
        licence: ["ODbL 1.0", "https://www.openstreetmap.org/copyright"],
    },
    {
        producer: "Siradel",
        datasets: {
            en: "Rennes buildings (LOD1), an extract of central Rennes bundled with the demo",
            fr: "Bâtiments (LOD1) de Rennes, un extrait du centre de Rennes livré avec la démo",
        },
        licence: ["© Siradel", "https://www.siradel.com"],
    },
    {
        producer: "CesiumJS",
        datasets: {
            en: "Plane model: Cesium Air, © CesiumJS contributors, repainted with the Horizon logo",
            fr: "Modèle d'avion : Cesium Air, © contributeurs CesiumJS, repeint aux couleurs d'Horizon",
        },
        licence: ["Apache 2.0", "licenses/Apache-2.0.txt"],
    },
    {
        producer: "amvlab",
        datasets: {
            en: "Drone model (drone_nologo) from amvlab/aircraft-models (github.com/amvlab/aircraft-models), © 2026 amvlab; modified: rotors split out, spin animation added",
            fr: "Modèle de drone (drone_nologo) issu d'amvlab/aircraft-models (github.com/amvlab/aircraft-models), © 2026 amvlab ; modifié : hélices séparées, animation de rotation ajoutée",
        },
        licence: ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
    },
    {
        producer: "NASA",
        datasets: {
            en: "Space Shuttle (D) model, NASA/Johnson Space Center, from NASA 3D Resources (science.nasa.gov/3d-resources/space-shuttle-d); payload bay doors (same resource) added closed, NASA insignia and US flags painted out. NASA does not endorse this demo.",
            fr: "Modèle Space Shuttle (D), NASA/Johnson Space Center, issu de NASA 3D Resources (science.nasa.gov/3d-resources/space-shuttle-d) ; portes de soute (même ressource) ajoutées fermées, insignes NASA et drapeaux américains effacés. La NASA ne cautionne pas cette démo.",
        },
        licence: [
            "NASA media usage guidelines",
            "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        ],
    },
    {
        producer: "Google",
        datasets: {
            en: "Roboto font for map labels",
            fr: "Police Roboto des étiquettes",
        },
        licence: ["Apache 2.0", "licenses/Apache-2.0.txt"],
    },
];

export function createAbout(): { open(section?: "sources"): void } {
    const close = h(
        "button",
        {
            class: "about-close",
            "aria-label": t({ en: "Close", fr: "Fermer" }),
            onclick: () => dialog.close(),
        },
        "✕",
    );

    const sources = h(
        "section",
        { id: "about-sources" },
        h(
            "h3",
            {},
            t({
                en: "Data sources and licences",
                fr: "Sources des données et licences",
            }),
        ),
        h(
            "ul",
            { class: "about-sources" },
            ...SOURCES.map((s) =>
                h(
                    "li",
                    {},
                    h("strong", {}, s.producer),
                    h("span", {}, t(s.datasets)),
                    a(s.licence[1], s.licence[0]),
                ),
            ),
        ),
    );

    const dialog = h(
        "dialog",
        { class: "about", "aria-labelledby": "about-title" },
        h(
            "div",
            { class: "about-head" },
            h("h2", { id: "about-title" }, "Flight Simulator"),
            close,
        ),
        h(
            "div",
            { class: "about-body" },
            p({
                en: "A tour of France in three scenes, right in your browser: a plane over the Chamonix valley, a drone over the city of Rennes, and the Space Shuttle in low orbit over the Mediterranean. Each scene plays a recorded flight: take the controls whenever you like, or skip to the next scene.",
                fr: "Un tour de France en trois scènes, directement dans le navigateur : un avion au-dessus de la vallée de Chamonix, un drone au-dessus de Rennes et la navette spatiale en orbite basse au-dessus de la Méditerranée. Chaque scène rejoue un vol enregistré : prenez les commandes quand vous voulez, ou passez à la scène suivante.",
            }),
            h(
                "h3",
                {},
                t({
                    en: "A demonstrator of the Horizon engine",
                    fr: "Un démonstrateur du moteur Horizon",
                }),
            ),
            p(
                {
                    en: "This application is a demonstrator of ",
                    fr: "Cette application est un démonstrateur de ",
                },
                a(LINKS.horizon, "Horizon"),
                {
                    en: ", Siradel's open source geospatial 3D engine, which grew out of the ",
                    fr: ", le moteur 3D géospatial open source de Siradel, issu de l'écosystème ",
                },
                a(LINKS.sce, "SCE"),
                {
                    en: " ecosystem. The flight models, the instruments and the camera run in the page; Horizon streams and draws the relief, the imagery, the city and the planet.",
                    fr: ". Les modèles de vol, les instruments et la caméra tournent dans la page ; Horizon charge et dessine le relief, l'imagerie, la ville et la planète.",
                },
            ),
            h(
                "h3",
                {},
                t({
                    en: "A game, not a real simulator",
                    fr: "Un jeu, pas un vrai simulateur",
                }),
            ),
            p({
                en: "The flight models are deliberately simple and are not real ones: no takeoff or landing, no weather, no navigation data, and a shuttle far faster than any orbit. Do not use it to learn or prepare a flight.",
                fr: "Les modèles de vol sont volontairement simples et n'ont rien de réaliste : ni décollage ni atterrissage, ni météo, ni données de navigation, et une navette bien plus rapide qu'en orbite. Ne vous en servez pas pour apprendre à piloter ni pour préparer un vol.",
            }),
            h("h3", {}, t({ en: "Controls", fr: "Commandes" })),
            p({
                en: "Keyboard: arrows to roll and pitch the plane, or to move the drone and the shuttle; Q / W for the throttle, or to climb and descend; P to pause, R to resume the demo, N for the next scene, V to change view, F to search a place, M for the minimap, C to switch between assisted and manual control, G to clear the course; + / − or the mouse wheel to zoom, drag to look around. Touch screen: the stick on the left, the throttle (or climb) lever on the right, two fingers to zoom.",
                fr: "Clavier : flèches pour le roulis et le tangage de l'avion, ou pour déplacer le drone et la navette ; Q / W pour les gaz, ou pour monter et descendre ; P pour la pause, R pour reprendre la démo, N pour la scène suivante, V pour changer de vue, F pour chercher un lieu, M pour la mini-carte, C pour passer du pilotage assisté au manuel, G pour effacer le cap ; + / − ou la molette pour zoomer, glisser pour regarder autour. Écran tactile : le manche à gauche, la manette des gaz (ou de montée) à droite, deux doigts pour zoomer.",
            }),
            h("h3", {}, t({ en: "Privacy", fr: "Vie privée" })),
            p({
                en: "No account, no cookies, no analytics. Map tiles and place searches go directly from your browser to their providers (IGN Géoplateforme, AWS, data.gouv.fr).",
                fr: "Ni compte, ni cookies, ni mesure d'audience. Les tuiles et les recherches de lieux sont demandées directement par votre navigateur à leurs fournisseurs (Géoplateforme de l'IGN, AWS, data.gouv.fr).",
            }),
            sources,
            h(
                "footer",
                { class: "about-links" },
                h("a", {
                    href: LINKS.siradel,
                    target: "_blank",
                    rel: "noopener",
                    class: "about-logo",
                    "aria-label": "Siradel",
                }),
                a(LINKS.repo, t({ en: "Source code", fr: "Code source" })),
                a(`mailto:${LINKS.contactEmail}`, LINKS.contactEmail),
            ),
        ),
    );
    dialog.querySelector(".about-logo")!.innerHTML = SIRADEL_LOGO;
    // Clicking the backdrop (outside the dialog box) closes it.
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    document.getElementById("brand-logo")!.innerHTML = SIRADEL_LOGO;

    const open = (section?: "sources") => {
        if (!dialog.open) dialog.showModal();
        if (section) sources.scrollIntoView({ block: "start" });
    };

    let seen = false;
    try {
        seen = localStorage.getItem(SEEN_KEY) === "1";
        localStorage.setItem(SEEN_KEY, "1");
    } catch {
        // Storage blocked: show it every time, which is harmless.
    }
    if (!seen) open();

    return { open };
}
