import {EventDispatcher} from 'three';
import {EVENT_UPDATED} from '../core/events.js';
import {Floor} from './floor.js';
import {Edge} from './edge.js';


export class Floorplan3D extends EventDispatcher
{
	constructor(scene, floorPlan, controls)
	{
		super();
		this.scene = scene;
		this.floorplan = floorPlan;
		this.controls = controls;
		this.floors = [];
		this.edges = [];
		var scope = this;
		this.updatedroomsevent = () => {scope.redraw();};
		this.floorplan.addEventListener(EVENT_UPDATED, this.updatedroomsevent);
	}

	switchWireframe(flag)
	{
		this.floors.forEach((floor)=>{
			floor.switchWireframe(flag);
		});
		this.edges.forEach((edge)=>{
			edge.switchWireframe(flag);
		});
	}

	redraw()
	{
		var scope = this;
		// clear scene
		//
		// dispose(), not removeFromScene(): the floors being dropped here are
		// never used again, and removeFromScene only takes them out of the scene
		// graph. It left each one still subscribed to its room's EVENT_CHANGED and
		// still holding a texture, so every edit that rebuilt the plan added a
		// listener and a GPU texture that nothing would ever release (RM-002 R-04).
		this.floors.forEach((floor) => {
			floor.dispose();
		});

		this.edges.forEach((edge) => {
			edge.remove();
		});
		this.floors = [];
		this.edges = [];

		// draw floors
		this.floorplan.getRooms().forEach((room) => {
			var threeFloor = new Floor(this.scene, room);
			this.floors.push(threeFloor);
			threeFloor.addToScene();
		});

		var eindex = 0;
		// draw edges
		this.floorplan.wallEdges().forEach((edge) => {
			var threeEdge = new Edge(scope.scene, edge, scope.controls);
			threeEdge.name = 'edge_'+eindex;
			this.edges.push(threeEdge);
			eindex+=1;
		});
	}

	showRoof(flag)
	{
		// draw floors
		this.floors.forEach((threeFloor) => {
			threeFloor.showRoof(flag);
		});
	}

	/**
	 * Release the floors, the edges and the floorplan subscription.
	 *
	 * There was no dispose() here at all, so tearing a viewer down left this
	 * object subscribed to the model's EVENT_UPDATED - redrawing a scene it no
	 * longer belonged to - with every Floor and Edge it had built still holding
	 * their own listeners and textures. Mount and unmount a viewer repeatedly,
	 * as the lifecycle suite does, and the cost was cumulative.
	 */
	dispose()
	{
		this.floorplan.removeEventListener(EVENT_UPDATED, this.updatedroomsevent);
		this.floors.forEach((floor) => {floor.dispose();});
		this.edges.forEach((edge) => {edge.remove();});
		this.floors = [];
		this.edges = [];
	}
}
