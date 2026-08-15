<script setup>
import {computed, ref, watch} from 'vue';
import TexturePicker from './TexturePicker.vue';
import CheckField from './fields/CheckField.vue';
import textures from '../../catalog/textures.json';
import {SELECTION_WALL} from '../composables/useSelection.js';

/**
 * Wall and floor surfaces.
 *
 * Sprint S7, replacing the dat.GUI "Wall and Floor (3D)" folder.
 *
 * The demo showed both dropdowns whichever you clicked, and each acted only if
 * it had something to act on - so with a wall selected the Floor dropdown did
 * nothing, and "All Walls In Room" did nothing either, since it is the Room
 * that knows its walls. Here the panel shows the picker that applies to what
 * you actually clicked, and the room-wide toggle appears with a floor, which is
 * the only time it does anything.
 *
 * The behaviour underneath is unchanged: `HalfEdge.setTexture` for a wall,
 * `Room.setTexture` for a floor, `Room.setRoomWallsTexture` for all of a room's
 * walls at once.
 */

const props = defineProps({
	selection: {type: Object, required: true},
});

const forAllWalls = ref(false);

const isWall = computed(() => props.selection.type === SELECTION_WALL);
const target = computed(() => props.selection.object);

/**
 * Bumped after every change so the "current" highlight re-reads. The model has
 * no event for a texture change - `setTexture` writes the wall's front/back
 * texture object and returns.
 */
const revision = ref(0);

const currentTexture = computed(() =>
{
	// Touch the counter so this recomputes after a pick.
	void revision.value;
	return target.value.getTexture ? target.value.getTexture() : null;
});

function applyWall(texture)
{
	target.value.setTexture(texture.url, texture.stretch, texture.scale);
	revision.value++;
}

function applyFloor(texture)
{
	target.value.setTexture(texture.url, texture.stretch, texture.scale);
	revision.value++;
}

function applyRoomWalls(texture)
{
	target.value.setRoomWallsTexture(texture.url, texture.stretch, texture.scale);
	revision.value++;
}

function pickWallTexture(texture)
{
	if (isWall.value)
	{
		applyWall(texture);
		return;
	}
	// A floor is selected: this picker is offering to retexture the room's walls.
	applyRoomWalls(texture);
}

watch(() => props.selection, () => {forAllWalls.value = false; revision.value++;});
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">{{ isWall ? 'Wall surface' : 'Room surfaces' }}</h3>

		<template v-if="isWall">
			<TexturePicker
				label="Wall" :textures="textures.wall" :current="currentTexture"
				@select="pickWallTexture" />
		</template>

		<template v-else>
			<TexturePicker
				label="Floor" :textures="textures.floor" :current="currentTexture"
				@select="applyFloor" />
			<CheckField v-model="forAllWalls" label="Also retexture this room's walls" />
			<TexturePicker
				label="Walls in this room" :textures="textures.wall"
				:disabled="!forAllWalls" :current="null"
				@select="pickWallTexture" />
		</template>
	</section>
</template>
