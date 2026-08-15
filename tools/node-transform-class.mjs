import {Matrix4, Quaternion, Vector3} from 'three';

/**
 * What a glTF's parent node transforms actually do to its meshes.
 *
 * The S4 merge fix bakes `matrixWorld` instead of `matrix`, so whatever the
 * parent nodes contribute now reaches the geometry. How much of that needs a
 * human to look at it depends entirely on *which kind* of transform it is, and
 * bounding boxes cannot tell you: an axis-aligned box changes shape under a
 * rotation just as readily as under a squash, so comparing before/after bounds
 * reports "resized" for models whose shape is untouched.
 *
 * Reading it off the matrices instead gives the real answer. The classes are
 * ordered by severity and only the strongest is reported, because a translation
 * rides along with almost all of them:
 *
 *   translate    parts move; no rotation, no scale
 *   rotate       parts move and turn; rigid
 *   uniform      as above, plus one scale factor applied to every axis
 *   nonuniform   the mesh is genuinely stretched
 *
 * The line that matters is between the first three and the last. A translation,
 * a rotation and a uniform scale are all similarity transforms, so each
 * individual mesh keeps its shape exactly; only `nonuniform` deforms geometry.
 *
 * That is not the same as "the model looks identical". Where a model is
 * assembled from several meshes, the fix moves them relative to each other -
 * bedBunk.glb had its mattress displaced sideways and now sits on the frame.
 * That is the bug being fixed, and it shows up under `uniform` as readily as
 * under `translate`.
 *
 * Shared by tools/merge-transform-ab.html and tests/model-conversion.test.js so
 * the page's labels and the test's assertions cannot disagree. Browser-safe:
 * imports nothing but three.
 *
 * @param {Object3D} root A loaded glTF scene, with world matrices up to date.
 * @returns {'translate'|'rotate'|'uniform'|'nonuniform'} The strongest effect
 *          any parent chain in the scene has.
 */
export function classifyNodeTransform(root)
{
	root.updateMatrixWorld(true);

	var spread = 0;
	var maxScale = 1;
	var minScale = 1;
	var rotated = false;

	var position = new Vector3();
	var quaternion = new Quaternion();
	var scale = new Vector3();

	root.traverse(function (child)
	{
		if (!child.isMesh) { return; }

		// worldMatrix * inverse(localMatrix) is exactly the parents' contribution
		// - the part the old merge threw away.
		var parentOnly = new Matrix4().copy(child.matrixWorld)
			.multiply(new Matrix4().copy(child.matrix).invert());
		parentOnly.decompose(position, quaternion, scale);

		maxScale = Math.max(maxScale, scale.x, scale.y, scale.z);
		minScale = Math.min(minScale, scale.x, scale.y, scale.z);
		spread = Math.max(spread, Math.max(scale.x, scale.y, scale.z) - Math.min(scale.x, scale.y, scale.z));
		// |w| = 1 is the identity rotation; anything else turns the mesh.
		if (Math.abs(quaternion.w) < 0.99999) { rotated = true; }
	});

	if (spread > 1e-4) { return 'nonuniform'; }
	if (Math.abs(maxScale - 1) > 1e-4 || Math.abs(minScale - 1) > 1e-4) { return 'uniform'; }
	if (rotated) { return 'rotate'; }
	return 'translate';
}

/** How much attention each class deserves, for labelling the A/B page. */
export const TRANSFORM_LABELS = {
	translate: {tag: 'moved', hint: 'parts move into place; each mesh unchanged'},
	rotate: {tag: 'rotated', hint: 'moved and turned; rigid, each mesh unchanged'},
	uniform: {tag: 'rescaled', hint: 'plus one scale factor on every axis; each mesh keeps its shape'},
	nonuniform: {tag: 'stretched', hint: 'genuinely non-uniform - geometry is deformed'},
};
