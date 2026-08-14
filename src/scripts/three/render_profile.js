/**
 * How the 3D view is shaded, as data.
 *
 * ## Why there are two profiles and not one
 *
 * Everything the viewer draws was tuned against three r98 and then carried
 * across ten migration sprints with its appearance deliberately frozen. Two
 * whole test suites exist to keep it that way: `color-pipeline.test.js` pins
 * the sRGB tags and the pi that cancels the basic material's lightmap term,
 * and `npm run parity` renders eleven scenes through r98 and r185 side by side.
 * That work is worth keeping. It is also why the walls are unlit
 * MeshBasicMaterial and the floors are Phong - decisions from 2014 that no
 * amount of light tuning can make look modern, because unlit geometry has no
 * light to tune.
 *
 * So: two profiles.
 *
 *   classic  Exactly what shipped through 1.0.0, down to the constants. This
 *            is the DEFAULT, so an embedder who upgrades gets no surprise, the
 *            parity grid stays meaningful, and the colour suite keeps testing
 *            the thing it was written for.
 *
 *   studio   Physically-based walls and floors, an image-based environment,
 *            filmic tone mapping, softer and larger shadows, and distance fog.
 *            The application turns this on at boot.
 *
 * The split is a switch on a plain object rather than two class hierarchies
 * because the difference really is a handful of numbers and one material
 * constructor. `Edge` and `Floor` each read it once while building.
 *
 * ## When it can be changed
 *
 * Materials are built during construction, so the mode has to be set before
 * `new BlueprintJS(...)` for it to apply cleanly - which is what the app does.
 * Changing it later is supported through `Main.applyRenderProfile()`, which
 * reconfigures the renderer and then throws away and rebuilds every Edge and
 * Floor. Setting `renderProfile.mode` by hand does neither, and will leave the
 * scene half in each look.
 */

export const RENDER_CLASSIC = 'classic';
export const RENDER_STUDIO = 'studio';

/**
 * Build a profile of one's own (RM-002 R-02, P7).
 *
 * Two `Main` instances on a page used to share this object, so a comparison
 * view showing classic beside studio was not expressible: whichever profile
 * was applied last was the one both viewers drew with. Pass the result of this
 * to `new BlueprintJS({renderProfile})` - or to `new Main(..., {renderProfile})`
 * - for a viewer with its own look.
 *
 * The module-level `renderProfile` below is still the default, still the same
 * object it always was, and still what every drawing class falls back to. That
 * matters more here than anywhere else in P7: `npm run parity` renders eleven
 * scenes against frozen r98 goldens through the default resolution path, and
 * this change leaves that path identical rather than merely equivalent.
 *
 * @param {string} [mode] RENDER_CLASSIC (the default) or RENDER_STUDIO.
 * @param {Object} [overrides]
 * @returns {Object} a new profile
 */
export function createRenderProfile(mode, overrides)
{
	var profile = Object.assign({mode: RENDER_CLASSIC}, CLASSIC_PROFILE);
	return setRenderProfile(mode || RENDER_CLASSIC, overrides, profile);
}

/**
 * The live profile. Read by any drawing class that was not given one of its
 * own; written through `setRenderProfile`.
 */
export const renderProfile = {
	mode: RENDER_CLASSIC,

	// --- renderer ---------------------------------------------------------

	/** Filmic highlight rolloff. Without it a white wall under a hemisphere
	 * light clips to flat #ffffff and every corner in the room disappears. */
	toneMappingExposure: 1.0,

	// --- lights -----------------------------------------------------------
	//
	// All three are written as multiples of pi, which is a unit conversion
	// rather than a fudge - see the long note in lights.js. What matters here is
	// that the CLASSIC numbers were chosen for a scene in which almost nothing
	// was lit: the walls, roof, sky and ground were all MeshBasicMaterial, so
	// 1.1 of hemisphere reached the Phong floors and the loaded furniture and
	// stopped there. Turn the walls into lit surfaces without touching these and
	// the room is a white box with no corners - every surface clips at 1.0.
	//
	// So studio rebalances rather than adds: much less ambient, because the
	// environment map is now providing most of it, and a genuinely bright key so
	// there is something for the shadows to be a shadow *of*.

	/** Ambient sky/ground fill. */
	hemisphereIntensity: 1.1,
	hemisphereSky: 0xffffff,
	hemisphereGround: 0x888888,

	/** The shadow-casting key. */
	keyIntensity: 0.5,

	/** How far off vertical the key sits, as a fraction of the plan's larger
	 * dimension. Zero is straight overhead, which is where it has always been
	 * and is the worst possible angle for walls: every vertical surface receives
	 * it at a grazing angle and they all come out the same value. */
	keyOffset: 0,
	/** Key height, as a multiple of Lights.height. */
	keyHeight: 1,

	/** Shadow map edge, per side. 1024 in classic; a 2048 map on the same
	 * frustum halves the size of the stair-step on a long wall. */
	shadowMapSize: 2048,

	/** Blur radius in texels, for the soft shadow filter. */
	shadowRadius: 2.4,

	// --- image-based lighting ---------------------------------------------

	/** Whether to build a PMREM environment and hang it on the scene.
	 *
	 * This is the single largest visible change and it costs one render at
	 * startup. `scene.environment` only reaches physically-based materials, so
	 * in classic it would light nothing at all: the walls are Basic and the
	 * floors are Phong, and the only PBR surfaces in a classic scene are the
	 * loaded glTF models - which is, admittedly, most of what fills a room. It
	 * is still gated, because an environment that lights the furniture and not
	 * the room it stands in looks worse than one that lights neither. */
	environment: true,

	/** Multiplier applied to the environment on walls and floors. Below 1 so
	 * the room reads as interior light rather than an outdoor HDRI. */
	environmentIntensity: 0.5,

	// --- surfaces ---------------------------------------------------------

	/** Walls: near-matte emulsion paint. Metalness stays at zero - a painted
	 * wall is a dielectric, and any metalness at all turns the environment
	 * reflection into a sheen that reads as wet plastic. */
	wallRoughness: 0.94,
	wallMetalness: 0.0,

	/** The lightmap is a hand-painted vignette, and under a lit material it no
	 * longer needs the pi that cancels the basic material's RECIPROCAL_PI (see
	 * edge.js). At full strength it fights the real lighting, so it is dialled
	 * back to a hint of ambient occlusion. */
	wallLightMapIntensity: 0.4,

	/** Floors: a satin finish. Rougher than a polished floor, smooth enough to
	 * pick up a soft gradient from the environment across a large room. */
	floorRoughness: 0.72,
	floorMetalness: 0.0,

	/** Ceilings. Classic paints them 0xe5e5e5 flat; studio drops them a shade
	 * so the roof plane reads as being in shadow rather than as a hole. */
	roofColor: 0xd8dce2,

	// --- atmosphere -------------------------------------------------------

	/** Distance fog, matched to the sky. The ground plane is 10000 units
	 * across and meets the sky sphere at a hard line; fog is what turns that
	 * line into a horizon. It also quietly solves the far-shadow problem, by
	 * washing out the region where the shadow frustum ends. */
	fog: true,
	fogColor: 0xdbe4ee,
	fogNear: 700,
	fogFar: 4600,

	/** Sky gradient. The classic pair is a pale blue over white; studio warms
	 * the horizon so the gradient reads as air rather than as a ramp. */
	skyTopColor: 0x7ea6cc,
	skyBottomColor: 0xeef2f6,

	/** Ground tint, multiplied into the gravel photograph. Classic is 0xEAEAEA,
	 * which leaves the gravel at nearly full contrast right up to the horizon. */
	groundColor: 0xb9bfc6,

	/** Whether the ground plane carries the gravel photograph at all.
	 *
	 * Off under studio, and this is a judgement about the asset rather than about
	 * texturing. `Ground_4K.jpg` has a strong regular structure, so at every
	 * tiling frequency it reads as a lattice rather than as ground - fine at 40
	 * where it aliases into noise, unmistakable at 18 where it resolves. A flat
	 * plane fading into fog is the honest studio backdrop, and it is also what
	 * keeps the eye on the model rather than on the floor around it.
	 *
	 * Classic keeps it, because a photographed ground is what this app has always
	 * stood on. */
	groundTexture: true,

	/** How many times the ground photograph tiles across its 10000-unit plane.
	 *
	 * 40 in classic. At that frequency the gravel is finer than a pixel over most
	 * of the frame, and a texture sampled below one texel per pixel does not read
	 * as gravel - it reads as a shimmering dot screen, which is what the ground
	 * has always actually looked like at any distance. Studio drops it to a
	 * frequency the mip chain can actually resolve. (Anisotropic filtering is
	 * applied in both profiles, because sampling a ground plane correctly is not
	 * a stylistic choice.) */
	groundRepeat: 18,
};

/**
 * Snapshot of the shipped-through-1.0.0 values, so `setRenderProfile` can put
 * every knob back rather than only the mode. Frozen because it is a record,
 * not a working copy.
 */
export const CLASSIC_PROFILE = Object.freeze({
	toneMappingExposure: 1.0,
	hemisphereIntensity: 1.1,
	hemisphereSky: 0xffffff,
	hemisphereGround: 0x888888,
	keyIntensity: 0.5,
	keyOffset: 0,
	keyHeight: 1,
	shadowMapSize: 1024,
	shadowRadius: 1,
	environment: false,
	environmentIntensity: 1.0,
	wallRoughness: 1.0,
	wallMetalness: 0.0,
	wallLightMapIntensity: Math.PI,
	floorRoughness: 1.0,
	floorMetalness: 0.0,
	roofColor: 0xe5e5e5,
	fog: false,
	fogColor: 0xffffff,
	fogNear: 1400,
	fogFar: 6500,
	skyTopColor: 0x92b2ce,
	skyBottomColor: 0xffffff,
	groundColor: 0xeaeaea,
	groundTexture: true,
	groundRepeat: 40,
});

/**
 * Snapshot of the studio values, for the same reason.
 */
export const STUDIO_PROFILE = Object.freeze({
	toneMappingExposure: 0.82,
	hemisphereIntensity: 0.38,
	hemisphereSky: 0xdfe9f5,
	hemisphereGround: 0x59606b,
	keyIntensity: 0.8,
	keyOffset: 0.75,
	keyHeight: 1.7,
	shadowMapSize: 2048,
	shadowRadius: 2.4,
	environment: true,
	environmentIntensity: 0.32,
	wallRoughness: 0.94,
	wallMetalness: 0.0,
	wallLightMapIntensity: 0.4,
	floorRoughness: 0.72,
	floorMetalness: 0.0,
	roofColor: 0xd8dce2,
	fog: true,
	fogColor: 0xdbe4ee,
	fogNear: 700,
	fogFar: 4600,
	skyTopColor: 0x7ea6cc,
	skyBottomColor: 0xeef2f6,
	groundColor: 0x8f97a3,
	groundTexture: false,
	groundRepeat: 18,
});

/**
 * Switch profile, optionally overriding individual knobs.
 *
 * Only replaces keys the profile already has, so a typo is ignored rather than
 * silently added as a key nothing reads - the same contract as
 * `setFloorplannerPalette`.
 *
 * @param {string} mode RENDER_CLASSIC or RENDER_STUDIO.
 * @param {Object} [overrides]
 * @param {Object} [profile] Which profile to write. Defaults to the shared one,
 * which is what every caller did before P7.
 * @returns {Object} the profile that was written
 */
export function setRenderProfile(mode, overrides, profile)
{
	var target = profile || renderProfile;
	var base = (mode === RENDER_STUDIO) ? STUDIO_PROFILE : CLASSIC_PROFILE;
	target.mode = (mode === RENDER_STUDIO) ? RENDER_STUDIO : RENDER_CLASSIC;

	Object.keys(base).forEach(function (key)
	{
		target[key] = base[key];
	});

	if (overrides)
	{
		Object.keys(overrides).forEach(function (key)
		{
			if (Object.prototype.hasOwnProperty.call(target, key) && key !== 'mode')
			{
				target[key] = overrides[key];
			}
		});
	}

	return target;
}

/**
 * @param {Object} [profile] Defaults to the shared profile.
 * @returns {boolean} true when the studio profile is active.
 */
export function isStudio(profile)
{
	return (profile || renderProfile).mode === RENDER_STUDIO;
}
