<script setup>
// @ts-check
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';
import TextField from './fields/TextField.vue';
import {EVENT_ANNOTATIONS_CHANGED, ANNOTATION_SIZES} from '../../scripts/blueprint.js';
import {t} from '../i18n/i18n.js';

/**
 * A text label on the plan (RM-008 E3).
 *
 * The text field takes focus on mount, and that is the whole reason the text
 * tool drops back to the pointer after placing one: a label is placed in order
 * to be typed into, so the gesture that starts on the canvas finishes here
 * without a second click. Placing one and having to find the field would make
 * the common case the slow one.
 *
 * Size is offered as four steps rather than a free number. A plan needs a title,
 * a heading and a note, not a hundred and twenty-eight point sizes, and a
 * restricted set is what keeps a drawing looking like one drawing.
 */

const props = defineProps({
	annotation: {type: Object, required: true},
	floorplanner: {type: Object, default: null},
});

const emit = defineEmits(['changed']);

const text = ref('');
const size = ref(0);
/** @type {import('vue').Ref<?HTMLElement>} */
const firstField = ref(null);

function readBack()
{
	text.value = props.annotation.text;
	size.value = props.annotation.size;
}

function setText(next)
{
	props.annotation.setText(next);
	readBack();
	emit('changed');
}

function setSize(next)
{
	props.annotation.setSize(next);
	readBack();
	emit('changed');
}

function remove()
{
	var floorplan = props.annotation.floorplan;
	if (floorplan)
	{
		floorplan.removeAnnotation(props.annotation);
	}
	emit('changed');
}

let attached = null;

function attach(annotation)
{
	detach();
	// A label can also move by being dragged on the plan, which changes nothing
	// this panel shows - but it can be removed by the eraser, and re-reading is
	// how this stays honest when it is.
	attached = {floorplan: annotation.floorplan, onChanged: () => {readBack();}};
	if (attached.floorplan)
	{
		attached.floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, attached.onChanged);
	}
	readBack();
}

function detach()
{
	if (attached)
	{
		if (attached.floorplan)
		{
			attached.floorplan.removeEventListener(EVENT_ANNOTATIONS_CHANGED, attached.onChanged);
		}
		attached = null;
	}
}

onBeforeUnmount(function ()
{
	if (pendingFocus)
	{
		cancelAnimationFrame(pendingFocus);
		pendingFocus = 0;
	}
});

watch(() => props.annotation, attach, {immediate: true});
onBeforeUnmount(detach);

/**
 * Take focus on the NEXT FRAME, not on mount.
 *
 * This panel appears because a click on the canvas created a label, and it
 * appears *during* that click: the mousedown handler creates the annotation, Vue
 * flushes in a microtask, and this component mounts before the browser has
 * finished with the event. So a `focus()` here lands, and the mousedown's own
 * default action then moves focus straight back out again - measured in a real
 * browser as a `focusin` on the input followed immediately by a `focusout`,
 * with `document.activeElement` settling on `<body>`.
 *
 * The visible consequence was worse than a missing focus. Typing the label then
 * went to the global shortcut map instead of the field, so "Living area" pressed
 * a, i, v, n, g, r and e - which opened the furniture catalog and changed the
 * active tool twice.
 *
 * A frame later is after the gesture, and it is the same instrument E2 reached
 * for when App's pointer listener turned out to run before the library's.
 */
var pendingFocus = 0;

onMounted(function ()
{
	pendingFocus = requestAnimationFrame(function ()
	{
		pendingFocus = 0;
		var host = firstField.value;
		if (!host)
		{
			return;
		}
		var input = host.querySelector('input');
		if (input)
		{
			input.focus();
			input.select();
		}
	});
});
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">{{ t('Label') }}</h3>

		<div ref="firstField">
			<TextField label="Text" :model-value="text" @update:model-value="setText" />
		</div>

		<div class="field">
			<span class="field-label">{{ t('Size') }}</span>
			<div class="segmented">
				<button
					v-for="step in ANNOTATION_SIZES" :key="step"
					type="button" class="segment" :class="{'is-active': size === step}"
					:aria-pressed="size === step" @click="setSize(step)">
					{{ step }}
				</button>
			</div>
		</div>

		<p class="inspector-note">
			Drag the label's dot on the plan to move it.
		</p>

		<button type="button" class="btn btn-danger w-full justify-center" @click="remove">
			{{ t('Delete this label') }}
		</button>
	</section>
</template>
