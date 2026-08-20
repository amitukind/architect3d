// @ts-check
import {onBeforeUnmount, onMounted} from 'vue';

/**
 * One keyboard map for the whole application.
 *
 * ## Why one place
 *
 * A shortcut has to know things no single component knows: that `W` means
 * "draw walls" only when the 2D pane is on screen, that `Delete` means "remove
 * the selected item" but must not fire while a name is being typed into the
 * inspector, that `Cmd+Z` outranks whatever the focused widget would do with it.
 * Spreading `@keydown` handlers across components produces exactly the bugs
 * that implies - two handlers for one key, and a Backspace in a text field
 * deleting the sofa.
 *
 * ## Typing wins
 *
 * Every binding except the explicitly-marked ones is suppressed while focus is
 * in a text field or a contenteditable region. This is the single most
 * important rule in the file: without it the app is unusable the moment an
 * inspector field has focus, which is most of the time.
 *
 * Escape is the exception, because Escape's job in a text field is to leave it.
 */

/**
 * @typedef {Object} Binding
 * @property {string} keys A single combination, e.g. 'w', 'mod+z', 'shift+?'.
 * `mod` is Cmd on Apple platforms and Ctrl everywhere else, which is what makes
 * a map portable without two tables.
 * @property {string} group The section it appears under in the shortcuts sheet.
 * @property {string} label What it does, as the sheet shows it.
 * @property {function(KeyboardEvent): void} run
 * @property {boolean} [whileTyping] Fire even when a field has focus.
 * @property {boolean} [repeats] Fire again while the key is held. Off by
 * default, because a shortcut that adds a wall or toggles a pane should happen
 * once per press; on for the arrow keys that walk the plan cursor, where
 * holding the key IS the gesture (RM-014 L4).
 * @property {function(): boolean} [enabled] Checked before firing.
 * @property {boolean} [yieldWhenDisabled] When `enabled()` is false, let the
 * key through instead of claiming it. Off by default - see the note in
 * `onKeydown` about why a disabled binding normally still counts as claimed.
 * The plan cursor's arrow keys turn it on (RM-014 L4): they are live only while
 * the plan canvas has focus, and the same four keys pan the 3D camera, scroll a
 * panel and drive the pane splitter when it does not.
 * @property {boolean} [alias] A second key for a binding already listed. It
 * works identically; it is omitted from the shortcuts sheet, because a
 * reference that lists "Redo" twice is a reference someone has to read twice.
 */

/**
 * Whether the event's target is somewhere text is being entered.
 *
 * `isContentEditable` covers rich-text hosts; the tag check covers the rest.
 * A checkbox or a button is deliberately NOT treated as typing - space and
 * enter still activate them because the browser handles those before us, and a
 * focused tool button should not swallow `W`.
 */
function isTyping(event)
{
	var target = event.target;
	if (!target)
	{
		return false;
	}
	if (target.isContentEditable)
	{
		return true;
	}
	var tag = (target.tagName || '').toLowerCase();
	if (tag === 'textarea' || tag === 'select')
	{
		return true;
	}
	if (tag === 'input')
	{
		var type = (target.type || 'text').toLowerCase();
		return ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].indexOf(type) === -1;
	}
	return false;
}

/**
 * True on platforms where the accelerator is Cmd rather than Ctrl.
 *
 * `navigator.platform` is deprecated but `userAgentData` is Chromium-only, so
 * both are consulted and neither is required - getting this wrong costs a
 * shortcut, not a boot.
 */
function isApple()
{
	try
	{
		// userAgentData is Chromium-only and absent from the DOM lib, so it is
		// read off a widened alias rather than off Navigator. The optional
		// chaining in the guard below is what makes that safe everywhere else.
		var uaData = /** @type {{userAgentData?: {platform?: string}}} */ (/** @type {unknown} */ (navigator)).userAgentData;
		if (uaData && uaData.platform)
		{
			return /mac|ios/i.test(uaData.platform);
		}
		return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
	}
	catch
	{
		// Neither API is required; getting this wrong costs a shortcut, not a boot.
		return false;
	}
}

export const IS_APPLE = isApple();

/** The accelerator's name, for display. */
export const MOD_LABEL = IS_APPLE ? '⌘' : 'Ctrl';

/**
 * Normalise an event into the same string form the bindings use.
 *
 * Order is fixed - mod, alt, shift, key - so 'shift+mod+z' in a binding table
 * would never match. That is deliberate: one canonical spelling per
 * combination means a duplicate binding is visible in the table rather than
 * discovered at runtime.
 */
function describe(event)
{
	var parts = [];
	if (IS_APPLE ? event.metaKey : event.ctrlKey)
	{
		parts.push('mod');
	}
	if (event.altKey)
	{
		parts.push('alt');
	}
	if (event.shiftKey)
	{
		parts.push('shift');
	}

	var key = event.key;
	if (key === ' ')
	{
		key = 'space';
	}
	else if (key.length === 1)
	{
		key = key.toLowerCase();
	}
	else
	{
		key = key.toLowerCase();
	}

	parts.push(key);
	return parts.join('+');
}

/**
 * Render a binding's `keys` for display: 'mod+shift+z' to '⌘ ⇧ Z'.
 *
 * @param {string} keys
 * @returns {Array<string>} one chip per key, in press order.
 */
export function keyChips(keys)
{
	var NAMES = {
		mod: MOD_LABEL,
		shift: IS_APPLE ? '⇧' : 'Shift',
		alt: IS_APPLE ? '⌥' : 'Alt',
		escape: 'Esc',
		delete: 'Del',
		backspace: IS_APPLE ? '⌫' : 'Backspace',
		arrowup: '↑',
		arrowdown: '↓',
		arrowleft: '←',
		arrowright: '→',
		space: 'Space',
	};

	return keys.split('+').map(function (part)
	{
		if (NAMES[part])
		{
			return NAMES[part];
		}
		return part.length === 1 ? part.toUpperCase() : part;
	});
}

/**
 * Install a keyboard map for the lifetime of the calling component.
 *
 * @param {function(): Array<Binding>} bindings Called on every keystroke, so the
 * map can depend on live state - which pane is showing, whether anything is
 * selected - without being rebuilt by a watcher.
 */
export function useShortcuts(bindings)
{
	function onKeydown(event)
	{
		var typing = isTyping(event);
		var combination = describe(event);
		var map = bindings();

		for (var i = 0; i < map.length; i += 1)
		{
			var binding = map[i];
			if (binding.keys !== combination)
			{
				continue;
			}
			if (typing && !binding.whileTyping)
			{
				continue;
			}
			// A held key repeats; a shortcut that adds a wall or toggles a pane
			// should fire once per press. This check used to sit above the lookup
			// and return before it, with a comment saying arrow-key nudging would
			// opt out here if it existed. RM-014 L4 is that arrow-key nudging, so
			// the check moved inside the loop and became per-binding.
			//
			// Returning WITHOUT preventDefault is deliberate and is exactly what
			// the early return did: a repeat of a claimed key was never claimed
			// before, and making it so now would be a behaviour change smuggled in
			// beside a feature.
			if (event.repeat && !binding.repeats)
			{
				return;
			}
			if (binding.enabled && !binding.enabled())
			{
				// A disabled binding still counts as claimed: Cmd+Z with an empty
				// undo stack must not fall through to the browser's own undo.
				//
				// Unless it says otherwise. That rule is about *browser* defaults,
				// and it is right for every binding that names a combination nothing
				// else wants. An arrow key is the opposite case: three other things
				// on this page want it, and a binding that is inactive because the
				// plan does not have focus must not silently eat the key on their
				// behalf (RM-014 L4).
				if (binding.yieldWhenDisabled)
				{
					continue;
				}
				event.preventDefault();
				return;
			}
			event.preventDefault();
			binding.run(event);
			return;
		}
	}

	onMounted(function () {window.addEventListener('keydown', onKeydown);});
	onBeforeUnmount(function () {window.removeEventListener('keydown', onKeydown);});

	return {isTyping, describe};
}
