// @ts-check

/**
 * The one thing that still has to be written synchronously (RM-003 A5, K-6).
 *
 * ## The problem moving to IndexedDB creates
 *
 * `pagehide` is the last moment a page reliably gets, and **it cannot await a
 * promise**. Whatever a handler starts, the browser is entitled to discard the
 * document before it finishes. Web Storage was immune to this by being
 * synchronous, which is the one thing it was good at and the reason autosave
 * used it; IndexedDB is not.
 *
 * In practice a transaction opened during `pagehide` usually does complete -
 * the document is not torn down instantly - but "usually" is not a property to
 * build a recovery story on, and the case autosave exists for is precisely the
 * one where the page went away unexpectedly.
 *
 * ## What a pointer buys, and what it does not
 *
 * It does **not** rescue the write. Nothing can: a document-sized synchronous
 * write is what M-9 exists to remove, so writing the body to `localStorage` as
 * a fallback would give the metric back to get the guarantee back.
 *
 * What it does is make the loss **detectable**. The pointer is written
 * synchronously *before* the body write is started, and records the timestamp
 * that write is going to carry. On the next load:
 *
 * - pointer absent, body present  - a draft from a clean session.
 * - pointer and body agree        - the last write landed.
 * - pointer NEWER than the body   - the tail was lost. The draft is still
 *                                   offered, and the offer can say how old it
 *                                   really is instead of implying it is current.
 * - pointer present, body absent  - the store was cleared underneath us, or the
 *                                   very first write never landed. Nothing to
 *                                   restore, and now we know why.
 *
 * A recovery prompt that says "recovered a draft from 4 minutes ago" when the
 * design on screen was current 4 seconds ago is a prompt that loses work
 * quietly. This is what lets it be honest instead.
 *
 * ## Why the write ordering is pointer-first
 *
 * The pointer is the *intent*, not the receipt. Written after the body it would
 * only ever agree, and would detect nothing.
 *
 * ## The size rule
 *
 * Three numbers and a string. M-9's acceptance line is that the recovery
 * pointer is under 1 kB, so {@link POINTER_LIMIT_BYTES} is asserted on every
 * write rather than assumed - and the pointer is dropped rather than allowed to
 * grow past it, because a pointer big enough to matter has stopped being one.
 */

import {byteLength} from './draft_repository.js';

/** Separate from the draft's own key: the two have different lifetimes. */
export const POINTER_KEY = 'architect3d.draft-pointer';

/**
 * The ceiling M-9's acceptance criterion names. A pointer that grows past this
 * is a design mistake, not a tight fit, so it is enforced rather than watched.
 */
export const POINTER_LIMIT_BYTES = 1024;

/**
 * @typedef {Object} RecoveryPointer
 * @property {number} savedAt The timestamp the body write was going to carry.
 * @property {number} bytes How large that body was.
 * @property {string} store Which repository was asked to hold it.
 */

/**
 * Record that a write is about to be attempted. Synchronous, tiny, and safe to
 * call from `pagehide`.
 *
 * @param {RecoveryPointer} pointer
 * @param {Storage} [storage] Defaults to `window.localStorage`.
 * @returns {number} the number of bytes written, or 0 if it could not be.
 */
export function writePointer(pointer, storage)
{
	var store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
	if (!store)
	{
		return 0;
	}

	var body = JSON.stringify({
		savedAt: pointer.savedAt,
		bytes: pointer.bytes,
		store: pointer.store,
	});
	var size = byteLength(body);
	if (size > POINTER_LIMIT_BYTES)
	{
		// Unreachable with the three fields above, and checked anyway: the whole
		// justification for keeping a synchronous write is that it is small, and a
		// guarantee nobody checks is a comment.
		console.warn(`architect3d: refusing to write a ${size}-byte recovery pointer; the limit is ${POINTER_LIMIT_BYTES}.`);
		return 0;
	}

	try
	{
		store.setItem(POINTER_KEY, body);
		return size;
	}
	catch
	{
		// No pointer means no discrepancy detection, which is a degradation and
		// not a failure. The draft itself is unaffected.
		return 0;
	}
}

/**
 * @param {Storage} [storage]
 * @returns {?RecoveryPointer}
 */
export function readPointer(storage)
{
	var store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
	if (!store)
	{
		return null;
	}
	try
	{
		var raw = store.getItem(POINTER_KEY);
		if (!raw)
		{
			return null;
		}
		var parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.savedAt !== 'number')
		{
			return null;
		}
		return {
			savedAt: parsed.savedAt,
			bytes: typeof parsed.bytes === 'number' ? parsed.bytes : 0,
			store: typeof parsed.store === 'string' ? parsed.store : 'unknown',
		};
	}
	catch
	{
		return null;
	}
}

/**
 * @param {Storage} [storage]
 */
export function clearPointer(storage)
{
	var store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
	if (!store)
	{
		return;
	}
	try {store.removeItem(POINTER_KEY);} catch { /* it will be overwritten */ }
}

/** A write was started and its result is unknown. */
export const RECOVERY_LOST_TAIL = 'lost-tail';
/** The pointer and the body agree, or there is no pointer to disagree. */
export const RECOVERY_COMPLETE = 'complete';
/** A pointer with nothing behind it. */
export const RECOVERY_MISSING = 'missing';
/** Nothing was ever written. */
export const RECOVERY_NONE = 'none';

/**
 * Compare what was intended with what arrived.
 *
 * The tolerance is not a fudge: `useAutosave` writes the pointer and then hands
 * the same timestamp to the repository, so a landed write matches exactly. It
 * exists so that a pointer written by one code path and a body written by
 * another - a future caller, or a clock read twice - does not read as data loss
 * over a millisecond.
 *
 * @param {?RecoveryPointer} pointer
 * @param {?import('./draft_repository.js').Draft} draft
 * @returns {{state: string, lostMs: number}} `lostMs` is how much later the
 *          intended write was than the one that actually landed - zero unless
 *          the state is {@link RECOVERY_LOST_TAIL}.
 */
export function compareRecovery(pointer, draft)
{
	if (!pointer && !draft)
	{
		return {state: RECOVERY_NONE, lostMs: 0};
	}
	if (pointer && !draft)
	{
		return {state: RECOVERY_MISSING, lostMs: 0};
	}
	if (!pointer)
	{
		return {state: RECOVERY_COMPLETE, lostMs: 0};
	}

	var gap = pointer.savedAt - /** @type {import('./draft_repository.js').Draft} */(draft).savedAt;
	if (gap > 1)
	{
		return {state: RECOVERY_LOST_TAIL, lostMs: gap};
	}
	return {state: RECOVERY_COMPLETE, lostMs: 0};
}
