// @ts-check
import {inject, provide} from 'vue';

/**
 * The plumbing behind every `provideX` / `injectX` pair in this directory
 * (RM-020 S-5).
 *
 * ## What this replaced
 *
 * `App.vue` built twenty-two composables and pushed their values into the tree
 * as props: ninety-two prop bindings and seventy-two event handlers, most of
 * them one composable being handed over a field at a time. Twelve of those
 * composables had at least one component taking three or more values from them,
 * and those are the ones that became injections - a component that wants the
 * whole of `useShare` should ask for `useShare`, not be handed seven of its
 * parts and seven callbacks to send them back through.
 *
 * The rest stay props on purpose. A component receiving one value from a
 * composable is not being drilled through, and wrapping that in an injection
 * buys indirection and nothing else.
 *
 * ## Why a helper rather than twenty copies
 *
 * The pattern is four lines of substance - a key, a provide, an inject, a throw
 * when it is missing - and thirty of explanation. Written out per composable it
 * would be six hundred lines of near-identical prose, which is the kind of
 * repetition that stops being read. It is explained once, here.
 *
 * ## The throw
 *
 * `inject` returns undefined when nothing provided, and a component that then
 * reads `.value` off it fails somewhere else entirely, with a message about the
 * wrong thing. Failing at the point of the missing provider names the missing
 * provider.
 *
 * @param {string} name Appears in the Symbol and in the error.
 * @returns {{key: symbol, put: function(*): *, take: function(): *}}
 */
export function createInjection(name)
{
	var key = Symbol('architect3d.' + name);
	return {
		key: key,
		/** Provide `api` to every descendant, and hand it back to the provider. */
		put: function (api)
		{
			provide(key, api);
			return api;
		},
		/** Take it from an ancestor, or say which provider was missing. */
		take: function ()
		{
			var api = inject(key, null);
			if (!api)
			{
				throw new Error('inject' + name + '() called outside a component tree that ran provide' + name + '().');
			}
			return api;
		},
	};
}
