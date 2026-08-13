<script setup>
/**
 * The icon set, inline (sprint S7).
 *
 * Replaces Bootstrap's glyphicon font, which cost 220 KB of webfont in four
 * formats to draw sixteen shapes. These are hand-authored 24x24 stroke paths
 * on a single grid, so they scale, they take the surrounding `currentColor`,
 * and they need no network request or font-loading flash.
 *
 * The names describe the *shape*, not the action, so `save` is a floppy disk
 * wherever it appears. The demo's glyph choices did not always line up with
 * what the button did - "New Layout" was a floppy disk, the same glyph family
 * as Save - and the buttons now carry the icon their tooltip describes. The
 * tooltips themselves are unchanged.
 */

const props = defineProps({
	name: {type: String, required: true},
	size: {type: Number, default: 16},
});

/**
 * Every path is stroked, none filled, so weight stays even across the set.
 * Coordinates are in a 24x24 box with a 2px safe margin.
 */
const PATHS = {
	// --- file actions ---
	'file-plus': ['M6 2h8l5 5v15H6z', 'M14 2v6h5', 'M12 12v6', 'M9 15h6'],
	save: ['M4 4h13l3 3v13H4z', 'M8 4v6h7V4', 'M8 20v-6h8v6'],
	'folder-open': ['M3 6h6l2 3h9v3', 'M3 6v14h18l-2-8H5z'],
	cube: ['M12 2 3 7v10l9 5 9-5V7z', 'M3 7l9 5 9-5', 'M12 12v10'],
	share: ['M12 16V3', 'M7 8l5-5 5 5', 'M4 14v6h16v-6'],

	// --- 2D editor modes ---
	move: ['M12 3v18', 'M3 12h18', 'M12 3 9 6M12 3l3 3', 'M12 21l-3-3M12 21l3-3', 'M3 12l3-3M3 12l3 3', 'M21 12l-3-3M21 12l-3 3'],
	pencil: ['M4 20h4L20 8l-4-4L4 16z', 'M14 6l4 4'],
	x: ['M5 5l14 14', 'M19 5 5 19'],
	info: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M12 11v6', 'M12 7.5v.5'],

	// --- camera presets: the plan seen from each side ---
	'align-left': ['M4 3v18', 'M8 7h11v4H8z', 'M8 15h7v4H8z'],
	'align-right': ['M20 3v18', 'M5 7h11v4H5z', 'M9 15h7v4H9z'],
	'align-top': ['M3 4h18', 'M7 8h4v11H7z', 'M15 8h4v7h-4z'],
	'align-bottom': ['M3 20h18', 'M7 5h4v11H7z', 'M15 9h4v7h-4z'],

	// --- viewer toggles ---
	camera: ['M3 8h4l2-3h6l2 3h4v12H3z', 'M12 17a4 4 0 100-8 4 4 0 000 8z'],
	grid: ['M4 4h16v16H4z', 'M4 12h16', 'M12 4v16', 'M4 4l16 16'],
	plus: ['M12 5v14', 'M5 12h14'],
	eye: ['M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'],

	// --- inspector chrome ---
	sliders: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 4v6', 'M8 14v6'],
	cursor: ['M5 3l14 8-6 1.5L10 19z'],
	trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
	lock: ['M6 11h12v9H6z', 'M9 11V7a3 3 0 016 0v4'],
	link: ['M10 8H7a4 4 0 000 8h3', 'M14 8h3a4 4 0 010 8h-3', 'M9 12h6'],
};
</script>

<template>
	<svg
		class="icon" :width="props.size" :height="props.size" viewBox="0 0 24 24"
		fill="none" stroke="currentColor" stroke-width="1.6"
		stroke-linecap="round" stroke-linejoin="round"
		aria-hidden="true" focusable="false">
		<path v-for="(d, index) in PATHS[props.name]" :key="index" :d="d" />
	</svg>
</template>

<style scoped>
.icon
{
	display: inline-block;
	vertical-align: -0.15em;
	flex: none;
}
</style>
