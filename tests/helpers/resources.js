/**
 * Counting what the library builds and what it gives back (RM-003 A0).
 *
 * ## Why this measures leakage rather than allocation
 *
 * "How many geometries were created" is not the question - a redraw is supposed
 * to create geometries. The question is how many were created, then dropped,
 * without ever being disposed. So a probe tracks three sets:
 *
 *   seen      every geometry, material and texture the walker has ever found
 *   disposed  the ones that fired their `dispose` event
 *   live      the ones still reachable at the moment of asking
 *
 * and `leaked = seen - disposed - live`. That number is the finding: it is 6 per
 * `Floorplan.update()` before A0 and 0 after, and nothing about it changes if a
 * later sprint makes the library allocate more or fewer objects legitimately.
 *
 * ## Why the `dispose` event and not a spy
 *
 * `BufferGeometry`, `Material` and `Texture` all extend `EventDispatcher` and all
 * dispatch `{type: 'dispose'}` from `dispose()` - verified against the installed
 * three@0.185.1 rather than assumed. Listening is therefore free of any patching:
 * the library runs exactly as it ships, and a test that passes here is not
 * passing because the harness rewrote something. Disposal is also idempotent, so
 * a resource disposed twice is counted once and double-dispose is not scored as
 * a defect.
 *
 * ## What the walker deliberately does not reach
 *
 * Only what a design actually owns: the model's hit-test meshes, the 3D view's
 * floors and edges, and loaded items. Not the skybox, lights, ground plane or
 * HUD scaffolding, which are per-viewer and built once. Those are covered by the
 * mount/unmount assertions in `viewer-lifecycle.test.js` instead, where "built
 * once, released once" is the right shape of claim.
 */

/**
 * @typedef {Object} ResourceProbe
 * @property {function(): void} sample Walk the subject now and record what is there.
 * @property {function(): {seen: number, disposed: number, live: number, leaked: number}} count
 * @property {function(): Array<Object>} leakedResources The undisposed, unreachable ones.
 * @property {function(): void} reset Forget everything recorded so far.
 */

/**
 * Every geometry, material and texture hanging off a three object, including its
 * descendants. A material array (multi-material mesh) is flattened.
 *
 * @param {?Object} object
 * @param {Set<Object>} into
 */
function collectFrom(object, into)
{
	if (!object)
	{
		return;
	}

	if (object.geometry)
	{
		into.add(object.geometry);
	}

	if (object.material)
	{
		var materials = Array.isArray(object.material) ? object.material : [object.material];
		materials.forEach(function (material)
		{
			if (!material)
			{
				return;
			}
			into.add(material);
			// A material's maps are textures it points at, not textures it owns -
			// the cache owns those. Recorded anyway, because "the cache handed one
			// out and nobody gave it back" is the same class of defect and
			// textureCacheStats() alone cannot see a texture the cache never made.
			['map', 'lightMap', 'aoMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap'].forEach(function (slot)
			{
				if (material[slot])
				{
					into.add(material[slot]);
				}
			});
		});
	}

	if (object.children)
	{
		object.children.forEach(function (child) {collectFrom(child, into);});
	}
}

/**
 * Everything a floorplan's model layer owns: two meshes per room and one per
 * half-edge. These are the invisible hit-test planes, which is how they escaped
 * being described as GPU resources at all - see RM-003 §16 H-1.
 *
 * @param {Object} floorplan
 * @param {Set<Object>} into
 */
function collectModelResources(floorplan, into)
{
	floorplan.getRooms().forEach(function (room)
	{
		collectFrom(room.floorPlane, into);
		collectFrom(room.roofPlane, into);
	});
	floorplan.getWalls().forEach(function (wall)
	{
		[wall.frontEdge, wall.backEdge].forEach(function (edge)
		{
			if (edge)
			{
				collectFrom(edge.plane, into);
			}
		});
	});
}

/**
 * Everything the 3D projection owns: each Floor's floor and roof planes, and
 * each Edge's six wall meshes.
 *
 * @param {Object} floorplan3d
 * @param {Set<Object>} into
 */
function collectViewResources(floorplan3d, into)
{
	floorplan3d.floors.forEach(function (floor)
	{
		collectFrom(floor.floorPlane, into);
		collectFrom(floor.roofPlane, into);
		if (floor.floorTexture)
		{
			into.add(floor.floorTexture);
		}
	});
	floorplan3d.edges.forEach(function (edge)
	{
		edge.planes.forEach(function (plane) {collectFrom(plane, into);});
		edge.basePlanes.forEach(function (plane) {collectFrom(plane, into);});
		edge.phantomPlanes.forEach(function (plane) {collectFrom(plane, into);});
		if (edge.texture)
		{
			into.add(edge.texture);
		}
		if (edge.lightMap)
		{
			into.add(edge.lightMap);
		}
	});
}

/**
 * Watch a design for resources it builds and never gives back.
 *
 * Call `sample()` after every operation that could allocate - the probe cannot
 * see a resource that was created and dropped between two samples, so a coarse
 * sampling under-reports. It never over-reports, which is the direction that
 * matters for an assertion that something reached zero.
 *
 * @param {Object} subject `{floorplan, floorplan3d, scene}` - any subset.
 * @returns {ResourceProbe}
 */
export function watchResources(subject)
{
	/** @type {Set<Object>} */
	var seen = new Set();
	/** @type {Set<Object>} */
	var disposed = new Set();

	function note(resource)
	{
		if (seen.has(resource))
		{
			return;
		}
		seen.add(resource);
		// Idempotent at the source, so a resource disposed twice lands in the set
		// once and is not mistaken for anything.
		resource.addEventListener('dispose', function () {disposed.add(resource);});
	}

	function walk()
	{
		var found = new Set();
		if (subject.floorplan)
		{
			collectModelResources(subject.floorplan, found);
		}
		if (subject.floorplan3d)
		{
			collectViewResources(subject.floorplan3d, found);
		}
		if (subject.scene)
		{
			subject.scene.getItems().forEach(function (item) {collectFrom(item, found);});
		}
		return found;
	}

	return {
		sample()
		{
			walk().forEach(note);
		},

		count()
		{
			var live = walk();
			var leaked = 0;
			seen.forEach(function (resource)
			{
				if (!disposed.has(resource) && !live.has(resource))
				{
					leaked += 1;
				}
			});
			return {seen: seen.size, disposed: disposed.size, live: live.size, leaked: leaked};
		},

		leakedResources()
		{
			var live = walk();
			var out = [];
			seen.forEach(function (resource)
			{
				if (!disposed.has(resource) && !live.has(resource))
				{
					out.push(resource);
				}
			});
			return out;
		},

		reset()
		{
			seen = new Set();
			disposed = new Set();
		},
	};
}

/**
 * How many of a set of resources are of each three type. For failure messages -
 * "6 leaked" is a number, "3 BufferGeometry, 3 MeshBasicMaterial" is a lead.
 *
 * @param {Array<Object>} resources
 * @returns {Object<string, number>}
 */
export function byType(resources)
{
	var tally = {};
	resources.forEach(function (resource)
	{
		var name = resource.type || resource.constructor.name;
		tally[name] = (tally[name] || 0) + 1;
	});
	return tally;
}
