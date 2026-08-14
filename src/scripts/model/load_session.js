// @ts-check

/**
 * Which document asked for this model file (RM-003 A1).
 *
 * ## The race this closes
 *
 * `Scene.addItem`'s loader callback closed over the scene and pushed into it,
 * with nothing recording which document had asked. Open a design with thirty
 * items and then open another - or press New, or Undo, or unmount the viewer -
 * while they are in flight, and thirty callbacks resolve into whatever exists
 * when they return. Design A's furniture appears in design B, thirty
 * EVENT_ITEM_LOADED are dispatched into a count that is now measuring two
 * documents at once, and `useHistory`'s settle gate can no longer tell when the
 * restore it is waiting for has finished.
 *
 * ## A generation, not a cancellation
 *
 * A load cannot always be stopped - an embedder's own `Scene.setItemLoader` is
 * arbitrary code under no obligation to honour anything - so the primitive here
 * is *identity* rather than interruption. Every load carries the generation it
 * was started in, and a callback whose generation is no longer current is
 * discarded. That works whatever the loader does.
 *
 * Interruption is still worth having where it is available, and since r185 it
 * is: `LoadingManager.abort()` composes into `FileLoader` through
 * `AbortSignal.any`, so a superseded session can stop the fetches it started
 * rather than merely ignore them. `Scene` owns the manager and calls it; this
 * class owns the bookkeeping. The two are separate because the bookkeeping has
 * to be right even when the abort does nothing.
 *
 * ## Why the counts are here
 *
 * `useHistory` currently counts EVENT_ITEM_LOADING against EVENT_ITEM_LOADED to
 * decide when a restore has settled, and keeps an eight-second timer in case the
 * count never comes back down. A count that belongs to a session cannot be
 * confused by a second document, and `settled` is the question the history gate
 * actually wants to ask.
 */

/**
 * @typedef {Object} LoadSessionStats
 * @property {number} generation Which load is current. Monotonic.
 * @property {number} inFlight How many loads this session started and is waiting on.
 * @property {number} aborted How many were abandoned by a later session, ever.
 * @property {number} failed How many resolved as a failure, ever.
 * @property {boolean} settled Whether the current session is waiting on nothing.
 */

export class LoadSession
{
	constructor()
	{
		this._generation = 0;
		this._inFlight = 0;
		this._aborted = 0;
		this._failed = 0;
	}

	/**
	 * Start a new load. Everything in flight becomes stale.
	 *
	 * @returns {number} the new generation.
	 */
	begin()
	{
		// Whatever the previous session was waiting on will still call back, and
		// those callbacks will be discarded. Counting them as aborted now rather
		// than when they arrive is what makes `settled` true immediately - the new
		// session is not waiting on them, and it is the new session the caller is
		// asking about.
		this._aborted += this._inFlight;
		this._inFlight = 0;
		this._generation += 1;
		return this._generation;
	}

	/** The generation a caller should stamp onto work it is starting. */
	get generation()
	{
		return this._generation;
	}

	/**
	 * @param {number} generation
	 * @returns {boolean} whether work started in `generation` is still wanted.
	 */
	isCurrent(generation)
	{
		return generation === this._generation;
	}

	/** Whether the current session is waiting on nothing. */
	get settled()
	{
		return this._inFlight === 0;
	}

	/**
	 * Record that a load has started, and get the token to stamp it with.
	 *
	 * @returns {number} the generation to pass back to {@link finished}.
	 */
	started()
	{
		this._inFlight += 1;
		return this._generation;
	}

	/**
	 * Record that a load has come back.
	 *
	 * @param {number} generation The token {@link started} returned.
	 * @param {boolean} [ok=true] False if it resolved as a failure.
	 * @returns {boolean} whether the result is still wanted. False means the
	 *          caller must discard whatever it was handed - including disposing
	 *          any geometry or material, which nothing else will now do.
	 */
	finished(generation, ok)
	{
		if (generation !== this._generation)
		{
			// Already counted as aborted by begin(); decrementing here would take
			// inFlight negative and make a settled session look unsettled.
			return false;
		}
		this._inFlight = Math.max(0, this._inFlight - 1);
		if (ok === false)
		{
			this._failed += 1;
		}
		return true;
	}

	/** @returns {LoadSessionStats} */
	stats()
	{
		return {
			generation: this._generation,
			inFlight: this._inFlight,
			aborted: this._aborted,
			failed: this._failed,
			settled: this._inFlight === 0,
		};
	}
}
