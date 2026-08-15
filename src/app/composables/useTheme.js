import {ref, watch} from 'vue';
import {setFloorplannerPalette} from '../../scripts/blueprint.js';

/**
 * Light and dark, for the chrome and for the canvas.
 *
 * ## Two halves of one decision
 *
 * The application shell is CSS, and CSS themes itself: `app.css` declares both
 * palettes as custom properties and `data-theme` on <html> picks one. The 2D
 * floorplanner is a canvas, which cannot read a stylesheet - it needs colour
 * *strings* at draw time. So a theme change is two writes: stamp the attribute,
 * and push a palette into the library.
 *
 * The canvas palettes live here rather than as `--canvas-*` custom properties
 * read back with `getComputedStyle`. That was the other option and it is worse
 * in both directions: it makes every draw depend on the document having laid
 * out, and it puts values in CSS that no CSS rule consumes.
 *
 * They are, however, drawn from the same palette as the chrome - the hex values
 * below are the tokens in app.css, and the two must be edited together. A
 * canvas whose grid is a different grey from the panel beside it is the tell
 * that they drifted.
 *
 * ## Module scope, not per-caller
 *
 * Like useDisplayUnit: `document.documentElement` really is one global, and two
 * components disagreeing about the theme is a bug rather than a feature.
 */

export const THEME_DARK = 'dark';
export const THEME_LIGHT = 'light';

const STORAGE_KEY = 'architect3d.theme';

/** Shared by both palettes: the measurement face, matching `.num` in app.css. */
const CANVAS_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * The 2D view's colours, per theme.
 *
 * Room fills carry their alpha in the eighth and ninth hex digits, which is
 * what the original `#fedaff66` did - canvas accepts 8-digit hex.
 */
const CANVAS_PALETTES = {
	[THEME_DARK]: {
		background: '#0e1116',
		grid: '#181d26',
		gridMajor: '#232a37',
		gridMajorEvery: 4,

		room: '#4cc2ff1a',
		roomHover: '#ff8a3d33',
		roomSelected: '#4cc2ff3d',

		wall: '#4a5464',
		wallHover: '#ff8a3d',
		wallSelected: '#4cc2ff',

		edge: '#68738a',
		edgeHover: '#ffa063',

		corner: '#6b768c',
		cornerHover: '#ff8a3d',
		cornerSelected: '#4cc2ff',

		delete: '#ff5c63',

		label: '#c8d0de',
		labelHalo: '#0b0d11',
		area: '#ff8a3d',
		roomName: '#e7eaf0',
		labelFont: CANVAS_FONT,

		angleGuide: '#ff8a3d',
		cornerAngle: '#8d97a9',

		originPrimary: '#4cc2ff',
		originSecondary: '#ff8a3d',

		curveHandle: '#38414f',
		curveGuide: '#4cc2ff',
		curveGuideShadow: '#0b0d11',
		curveCasing: '#1a1f29',
		wallControl: '#ff8a3d',
	},

	[THEME_LIGHT]: {
		background: '#f7f8fa',
		grid: '#e6eaf0',
		gridMajor: '#ccd4e0',
		gridMajorEvery: 4,

		room: '#0a7fcc14',
		roomHover: '#d9601a26',
		roomSelected: '#0a7fcc2e',

		wall: '#aab3c0',
		wallHover: '#d9601a',
		wallSelected: '#0a7fcc',

		edge: '#8b93a3',
		edgeHover: '#ef7526',

		corner: '#949db0',
		cornerHover: '#d9601a',
		cornerSelected: '#0a7fcc',

		delete: '#cf3239',

		label: '#141821',
		labelHalo: '#ffffff',
		area: '#d9601a',
		roomName: '#141821',
		labelFont: CANVAS_FONT,

		angleGuide: '#d9601a',
		cornerAngle: '#5c6577',

		originPrimary: '#0a7fcc',
		originSecondary: '#d9601a',

		curveHandle: '#d8dde6',
		curveGuide: '#0a7fcc',
		curveGuideShadow: '#ffffff',
		curveCasing: '#c2cad6',
		wallControl: '#d9601a',
	},
};

/**
 * The theme to boot into.
 *
 * A stored choice wins. With none, the system preference decides - which is
 * also what the `prefers-color-scheme` block in app.css assumes, so the first
 * painted frame and the first JS-driven frame agree and there is no flash.
 *
 * Wrapped because both `localStorage` and `matchMedia` throw or go missing in
 * enough environments - private mode, jsdom, an embedder's sandboxed iframe -
 * that a theme lookup is not worth failing a boot over.
 */
function initialTheme()
{
	try
	{
		var stored = window.localStorage.getItem(STORAGE_KEY);
		if (stored === THEME_DARK || stored === THEME_LIGHT)
		{
			return stored;
		}
	}
	catch
	{
		// No storage. Fall through to the system preference.
	}

	try
	{
		if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
		{
			return THEME_LIGHT;
		}
	}
	catch
	{
		// No matchMedia either.
	}

	// A design tool is a dark-room instrument; dark is the default, not the
	// fallback.
	return THEME_DARK;
}

const theme = ref(initialTheme());

/**
 * Stamp the attribute and push the canvas palette.
 *
 * Exported so `main.js` can run it before the app mounts. Doing it at mount
 * time instead would paint one frame of the wrong theme into the canvas, which
 * the CSS media query cannot cover because the canvas is not CSS.
 *
 * @param {?import('./useBlueprint.js').BlueprintStore} [store] Redrawn if given.
 */
export function applyTheme(store)
{
	var value = theme.value;

	if (typeof document !== 'undefined' && document.documentElement)
	{
		document.documentElement.setAttribute('data-theme', value);
	}

	setFloorplannerPalette(CANVAS_PALETTES[value]);

	if (store && store.floorplanner && store.floorplanner.value)
	{
		store.floorplanner.value.redraw();
	}
}

/**
 * @param {?import('./useBlueprint.js').BlueprintStore} [store]
 */
export function useTheme(store)
{
	function setTheme(next)
	{
		theme.value = (next === THEME_LIGHT) ? THEME_LIGHT : THEME_DARK;
	}

	function toggleTheme()
	{
		setTheme(theme.value === THEME_DARK ? THEME_LIGHT : THEME_DARK);
	}

	watch(theme, function (value)
	{
		applyTheme(store);
		try
		{
			window.localStorage.setItem(STORAGE_KEY, value);
		}
		catch
		{
			// Not persisting is survivable; not theming is not.
		}
	});

	return {theme, setTheme, toggleTheme, isDark: () => theme.value === THEME_DARK};
}
