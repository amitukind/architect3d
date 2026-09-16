// @ts-check

/**
 * The storey below, as the plan needs to see it (RM-010 G1).
 *
 * ## Why this is a projection rather than a reference
 *
 * `Floorplanner2D` is constructed with a `Floorplan` and nothing else. That is
 * deliberate and it is RM-008 T-1: a `Floorplan` has no path to a `Model` or a
 * `Scene`, so the 2D view structurally cannot reach past the plan it was given -
 * which is what stops the drawing layer from acquiring the GPU by accident.
 *
 * A ghosted level below is a second plan on the same canvas, so the view needs
 * something it cannot reach. E1 hit exactly this for furniture and answered it
 * by handing the plan a **description** rather than a reference; this is the
 * same answer for the same reason, and it is why `Model` computes this and sets
 * it, rather than the view walking up to find it.
 *
 * ## What a tracing underlay actually needs
 *
 * Not the plan. A ghost is there to say *where the walls downstairs are* so a
 * wall upstairs can be put over one - so it carries wall centrelines and room
 * outlines and nothing else. No labels, no dimensions, no furniture, no
 * annotations: every one of those would be a second set of words on a drawing
 * that already has its own, and the thing being traced is the structure.
 */

/**
 * @typedef {Object} GhostWall
 * @property {number} ax Centimetres, in plan space.
 * @property {number} ay
 * @property {number} bx
 * @property {number} by
 * @property {number} thickness
 */

/**
 * @typedef {Object} GhostPlan
 * @property {Array<GhostWall>} walls
 * @property {Array<Array<{x: number, y: number}>>} rooms Interior outlines.
 */

/**
 * Describe a plan as the storey above should trace it.
 *
 * Plain numbers, copied - a view may hold this until the next projection, and
 * handing it live corners would let it draw a state the picture was not made
 * from. The same rule `projectItem` follows.
 *
 * @param {?Object} floorplan
 * @returns {?GhostPlan} Null for no plan and for an empty one, because an
 *          underlay with nothing on it is not an underlay.
 */
export function projectPlanOutline(floorplan)
{
	if (!floorplan || typeof floorplan.getWalls !== 'function')
	{
		return null;
	}
	var walls = floorplan.getWalls()
		.filter(function (wall) {return wall.getStart() && wall.getEnd();})
		.map(function (wall)
		{
			return {
				ax: wall.getStart().x,
				ay: wall.getStart().y,
				bx: wall.getEnd().x,
				by: wall.getEnd().y,
				thickness: (typeof wall.thickness === 'number') ? wall.thickness : 10,
			};
		});
	var rooms = (typeof floorplan.getRooms === 'function' ? floorplan.getRooms() : [])
		.map(function (room)
		{
			return (room.interiorCorners || []).map(function (corner)
			{
				return {x: corner.x, y: corner.y};
			});
		})
		.filter(function (outline) {return outline.length > 2;});

	if (!walls.length && !rooms.length)
	{
		return null;
	}
	return {walls: walls, rooms: rooms};
}
