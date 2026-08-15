import {ref} from 'vue';

/**
 * Transient messages.
 *
 * Replaces `useDesignIO.lastError`, which was one string rendered as a red bar
 * that stayed until the next action replaced it. That shape has three problems
 * as soon as the app does more than open files: a second error overwrites the
 * first, there is nowhere to report a *success*, and nothing ever dismisses it.
 *
 * Module scope, so any composable can report without being handed a queue.
 * Errors do not auto-dismiss - an error the user did not see is an error that
 * did not get reported - and everything else does.
 */

export const TOAST_INFO = 'info';
export const TOAST_SUCCESS = 'success';
export const TOAST_ERROR = 'error';

const DEFAULT_TTL_MS = 3200;

/** @type {import('vue').Ref<Array<{id: number, kind: string, message: string, detail: ?string, action: ?Object}>>} */
const toasts = ref([]);

let nextId = 1;

function dismiss(id)
{
	toasts.value = toasts.value.filter((entry) => entry.id !== id);
}

/**
 * @param {string} kind One of the TOAST_* constants.
 * @param {string} message
 * @param {Object} [options]
 * @param {string} [options.detail] A second line, for the technical part.
 * @param {number} [options.ttl] Override the dismiss delay. 0 never dismisses.
 * @param {{label: string, run: function(): void}} [options.action] One button.
 * Used for offers rather than confirmations - "a draft was recovered, restore
 * it?" - so the toast is the whole interaction and nothing has to be dismissed
 * before the app is usable.
 * @returns {number} the toast id, for dismissing it early.
 */
function push(kind, message, options)
{
	var settings = options || {};
	var id = nextId;
	nextId += 1;

	toasts.value = toasts.value.concat([{
		id: id,
		kind: kind,
		message: message,
		detail: settings.detail || null,
		action: settings.action || null,
	}]);

	// Errors stay until dismissed, and so does anything carrying an action - a
	// button that vanishes after three seconds is worse than no button.
	var ttl = (settings.ttl === undefined)
		? ((kind === TOAST_ERROR || settings.action) ? 0 : DEFAULT_TTL_MS)
		: settings.ttl;

	if (ttl > 0)
	{
		setTimeout(function () {dismiss(id);}, ttl);
	}

	return id;
}

export function useToasts()
{
	return {
		toasts,
		dismiss,
		info: (message, options) => push(TOAST_INFO, message, options),
		success: (message, options) => push(TOAST_SUCCESS, message, options),
		error: (message, options) => push(TOAST_ERROR, message, options),
	};
}
