/// <reference path="../lib/three.d.ts" />
/// <reference path="../lib/jQuery.d.ts" />
declare module BP3D.Core {
    /** Collection of utility functions. */
    class Utils {
        /** Determines the distance of a point from a line.
         * @param x Point's x coordinate.
         * @param y Point's y coordinate.
         * @param x1 Line-Point 1's x coordinate.
         * @param y1 Line-Point 1's y coordinate.
         * @param x2 Line-Point 2's x coordinate.
         * @param y2 Line-Point 2's y coordinate.
         * @returns The distance.
         */
        static pointDistanceFromLine(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number;
        /** Gets the projection of a point onto a line.
         * @param x Point's x coordinate.
         * @param y Point's y coordinate.
         * @param x1 Line-Point 1's x coordinate.
         * @param y1 Line-Point 1's y coordinate.
         * @param x2 Line-Point 2's x coordinate.
         * @param y2 Line-Point 2's y coordinate.
         * @returns The point.
         */
        static closestPointOnLine(x: number, y: number, x1: number, y1: number, x2: number, y2: number): {
            x: number;
            y: number;
        };
        /** Gets the distance of two points.
         * @param x1 X part of first point.
         * @param y1 Y part of first point.
         * @param x2 X part of second point.
         * @param y2 Y part of second point.
         * @returns The distance.
         */
        static distance(x1: number, y1: number, x2: number, y2: number): number;
        /**  Gets the angle between 0,0 -> x1,y1 and 0,0 -> x2,y2 (-pi to pi)
         * @returns The angle.
         */
        static angle(x1: number, y1: number, x2: number, y2: number): number;
        /** shifts angle to be 0 to 2pi */
        static angle2pi(x1: number, y1: number, x2: number, y2: number): number;
        /** Checks if an array of points is clockwise.
         * @param points Is array of points with x,y attributes
         * @returns True if clockwise.
         */
        static isClockwise(points: any): boolean;
        /** Creates a Guid.
         * @returns A new Guid.
         */
        static guid(): string;
        /** both arguments are arrays of corners with x,y attributes */
        static polygonPolygonIntersect(firstCorners: any, secondCorners: any): boolean;
        /** Corners is an array of points with x,y attributes */
        static linePolygonIntersect(x1: number, y1: number, x2: number, y2: number, corners: any): boolean;
        /** */
        static lineLineIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean;
        /**
         @param corners Is an array of points with x,y attributes
          @param startX X start coord for raycast
          @param startY Y start coord for raycast
        */
        static pointInPolygon(x: number, y: number, corners: any, startX?: number, startY?: number): boolean;
        /** Checks if all corners of insideCorners are inside the polygon described by outsideCorners */
        static polygonInsidePolygon(insideCorners: any, outsideCorners: any, startX: number, startY: number): boolean;
        /** Checks if any corners of firstCorners is inside the polygon described by secondCorners */
        static polygonOutsidePolygon(insideCorners: any, outsideCorners: any, startX: number, startY: number): boolean;
        static forEach(array: any, action: any): void;
        static forEachIndexed(array: any, action: any): void;
        static map(array: any, func: any): any[];
        /** Remove elements in array if func(element) returns true */
        static removeIf(array: any, func: any): any[];
        /** Shift the items in an array by shift (positive integer) */
        static cycle(arr: any, shift: any): any;
        /** Returns in the unique elemnts in arr */
        static unique(arr: any, hashFunc: any): any[];
        /** Remove value from array, if it is present */
        static removeValue(array: any, value: any): void;
        /** Checks if value is in array */
        static hasValue: (array: any, value: any) => boolean;
        /** Subtracts the elements in subArray from array */
        static subtract(array: any, subArray: any): any[];
    }
}
declare module BP3D.Core {
    /** Dimensioning in Inch. */
    const dimInch: string;
    /** Dimensioning in Meter. */
    const dimMeter: string;
    /** Dimensioning in Centi Meter. */
    const dimCentiMeter: string;
    /** Dimensioning in Milli Meter. */
    const dimMilliMeter: string;
    /** Dimensioning functions. */
    class Dimensioning {
        /** Converts cm to dimensioning string.
         * @param cm Centi meter value to be converted.
         * @returns String representation.
         */
        static cmToMeasure(cm: number): string;
    }
}
declare module BP3D.Core {
    /** The dimensioning unit for 2D floorplan measurements. */
    const configDimUnit: string;
    /** The initial wall height in cm. */
    const configWallHeight: string;
    /** The initial wall thickness in cm. */
    const configWallThickness: string;
    /** Global configuration to customize the whole system.  */
    class Configuration {
        /** Configuration data loaded from/stored to extern. */
        private static data;
        /** Set a configuration parameter. */
        static setValue(key: string, value: string | number): void;
        /** Get a string configuration parameter. */
        static getStringValue(key: string): string;
        /** Get a numeric configuration parameter. */
        static getNumericValue(key: string): number;
    }
}
declare module BP3D.Items {
    /** Meta data for items. */
    interface Metadata {
        /** Name of the item. */
        itemName?: string;
        /** Type of the item. */
        itemType?: number;
        /** Url of the model. */
        modelUrl?: string;
        /** Resizeable or not */
        resizable?: boolean;
    }
}
declare module BP3D.Items {
    /**
     * An Item is an abstract entity for all things placed in the scene,
     * e.g. at walls or on the floor.
     */
    abstract class Item extends THREE.Mesh {
        protected model: Model.Model;
        metadata: Metadata;
        /** */
        private scene;
        /** */
        private errorGlow;
        /** */
        private hover;
        /** */
        private selected;
        /** */
        private highlighted;
        /** */
        private error;
        /** */
        private emissiveColor;
        /** */
        private errorColor;
        /** */
        private resizable;
        /** Does this object affect other floor items */
        protected obstructFloorMoves: boolean;
        /** */
        protected position_set: boolean;
        /** Show rotate option in context menu */
        protected allowRotate: boolean;
        /** */
        fixed: boolean;
        /** dragging */
        private dragOffset;
        /** */
        protected halfSize: THREE.Vector3;
        /** Constructs an item.
         * @param model TODO
         * @param metadata TODO
         * @param geometry TODO
         * @param material TODO
         * @param position TODO
         * @param rotation TODO
         * @param scale TODO
         */
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
        /** */
        remove(): void;
        /** */
        resize(height: number, width: number, depth: number): void;
        /** */
        setScale(x: number, y: number, z: number): void;
        /** */
        setFixed(fixed: boolean): void;
        /** Subclass can define to take action after a resize. */
        protected abstract resized(): any;
        /** */
        getHeight: () => number;
        /** */
        getWidth: () => number;
        /** */
        getDepth: () => number;
        /** */
        abstract placeInRoom(): any;
        /** */
        initObject: () => void;
        /** */
        removed(): void;
        /** on is a bool */
        updateHighlight(): void;
        /** */
        mouseOver(): void;
        /** */
        mouseOff(): void;
        /** */
        setSelected(): void;
        /** */
        setUnselected(): void;
        /** intersection has attributes point (vec3) and object (THREE.Mesh) */
        clickPressed(intersection: any): void;
        /** */
        clickDragged(intersection: any): void;
        /** */
        rotate(intersection: any): void;
        /** */
        moveToPosition(vec3: any, intersection: any): void;
        /** */
        clickReleased(): void;
        /**
         * Returns an array of planes to use other than the ground plane
         * for passing intersection to clickPressed and clickDragged
         */
        customIntersectionPlanes(): any[];
        /**
         * returns the 2d corners of the bounding polygon
         *
         * offset is Vector3 (used for getting corners of object at a new position)
         *
         * TODO: handle rotated objects better!
         */
        getCorners(xDim: any, yDim: any, position: any): {
            x: number;
            y: number;
        }[];
        /** */
        abstract isValidPosition(vec3: any): boolean;
        /** */
        showError(vec3: any): void;
        /** */
        hideError(): void;
        /** */
        private objectHalfSize();
        /** */
        createGlow(color: any, opacity: any, ignoreDepth: any): THREE.Mesh;
    }
}
declare module BP3D.Model {
    /**
     * Corners are used to define Walls.
     */
    class Corner {
        private floorplan;
        x: number;
        y: number;
        id: string;
        /** Array of start walls. */
        private wallStarts;
        /** Array of end walls. */
        private wallEnds;
        /** Callbacks to be fired on movement. */
        private moved_callbacks;
        /** Callbacks to be fired on removal. */
        private deleted_callbacks;
        /** Callbacks to be fired in case of action. */
        private action_callbacks;
        /** Constructs a corner.
         * @param floorplan The associated floorplan.
         * @param x X coordinate.
         * @param y Y coordinate.
         * @param id An optional unique id. If not set, created internally.
         */
        constructor(floorplan: Floorplan, x: number, y: number, id?: string);
        /** Add function to moved callbacks.
         * @param func The function to be added.
        */
        fireOnMove(func: any): void;
        /** Add function to deleted callbacks.
         * @param func The function to be added.
         */
        fireOnDelete(func: any): void;
        /** Add function to action callbacks.
         * @param func The function to be added.
         */
        fireOnAction(func: any): void;
        /**
         * @returns
         * @deprecated
         */
        getX(): number;
        /**
         * @returns
         * @deprecated
         */
        getY(): number;
        /**
         *
         */
        snapToAxis(tolerance: number): {
            x: boolean;
            y: boolean;
        };
        /** Moves corner relatively to new position.
         * @param dx The delta x.
         * @param dy The delta y.
         */
        relativeMove(dx: number, dy: number): void;
        private fireAction(action);
        /** Remove callback. Fires the delete callbacks. */
        remove(): void;
        /** Removes all walls. */
        private removeAll();
        /** Moves corner to new position.
         * @param newX The new x position.
         * @param newY The new y position.
         */
        private move(newX, newY);
        /** Gets the adjacent corners.
         * @returns Array of corners.
         */
        adjacentCorners(): Corner[];
        /** Checks if a wall is connected.
         * @param wall A wall.
         * @returns True in case of connection.
         */
        private isWallConnected(wall);
        /**
         *
         */
        distanceFrom(x: number, y: number): number;
        /** Gets the distance from a wall.
         * @param wall A wall.
         * @returns The distance.
         */
        distanceFromWall(wall: Wall): number;
        /** Gets the distance from a corner.
         * @param corner A corner.
         * @returns The distance.
         */
        distanceFromCorner(corner: Corner): number;
        /** Detaches a wall.
         * @param wall A wall.
         */
        detachWall(wall: Wall): void;
        /** Attaches a start wall.
         * @param wall A wall.
         */
        attachStart(wall: Wall): void;
        /** Attaches an end wall.
         * @param wall A wall.
         */
        attachEnd(wall: Wall): void;
        /** Get wall to corner.
         * @param corner A corner.
         * @return The associated wall or null.
         */
        wallTo(corner: Corner): Wall;
        /** Get wall from corner.
         * @param corner A corner.
         * @return The associated wall or null.
         */
        wallFrom(corner: Corner): Wall;
        /** Get wall to or from corner.
         * @param corner A corner.
         * @return The associated wall or null.
         */
        wallToOrFrom(corner: Corner): Wall;
        /**
         *
         */
        private combineWithCorner(corner);
        mergeWithIntersected(): boolean;
        /** Ensure we do not have duplicate walls (i.e. same start and end points) */
        private removeDuplicateWalls();
    }
}
declare module BP3D.Model {
    /**
     * Half Edges are created by Room.
     *
     * Once rooms have been identified, Half Edges are created for each interior wall.
     *
     * A wall can have two half edges if it is visible from both sides.
     */
    class HalfEdge {
        private room;
        wall: Wall;
        private front;
        /** The successor edge in CCW ??? direction. */
        next: HalfEdge;
        /** The predecessor edge in CCW ??? direction. */
        prev: HalfEdge;
        /** */
        offset: number;
        /** */
        height: number;
        /** used for intersection testing... not convinced this belongs here */
        plane: THREE.Mesh;
        /** transform from world coords to wall planes (z=0) */
        interiorTransform: THREE.Matrix4;
        /** transform from world coords to wall planes (z=0) */
        invInteriorTransform: THREE.Matrix4;
        /** transform from world coords to wall planes (z=0) */
        private exteriorTransform;
        /** transform from world coords to wall planes (z=0) */
        private invExteriorTransform;
        /** */
        redrawCallbacks: JQueryCallback;
        /**
         * Constructs a half edge.
         * @param room The associated room.
         * @param wall The corresponding wall.
         * @param front True if front side.
         */
        constructor(room: Room, wall: Wall, front: boolean);
        /**
         *
         */
        getTexture(): {
            url: string;
            stretch: boolean;
            scale: number;
        };
        /**
         *
         */
        setTexture(textureUrl: string, textureStretch: boolean, textureScale: number): void;
        /**
         * this feels hacky, but need wall items
         */
        generatePlane: () => void;
        interiorDistance(): number;
        private computeTransforms(transform, invTransform, start, end);
        /** Gets the distance from specified point.
         * @param x X coordinate of the point.
         * @param y Y coordinate of the point.
         * @returns The distance.
         */
        distanceTo(x: number, y: number): number;
        private getStart();
        private getEnd();
        private getOppositeEdge();
        interiorEnd(): {
            x: number;
            y: number;
        };
        interiorStart(): {
            x: number;
            y: number;
        };
        interiorCenter(): {
            x: number;
            y: number;
        };
        exteriorEnd(): {
            x: number;
            y: number;
        };
        exteriorStart(): {
            x: number;
            y: number;
        };
        /** Get the corners of the half edge.
         * @returns An array of x,y pairs.
         */
        corners(): {
            x: number;
            y: number;
        }[];
        /**
         * Gets CCW angle from v1 to v2
         */
        private halfAngleVector(v1, v2);
    }
}
declare module BP3D.Model {
    /**
     * A Wall is the basic element to create Rooms.
     *
     * Walls consists of two half edges.
     */
    class Wall {
        private start;
        private end;
        /** The unique id of each wall. */
        private id;
        /** Front is the plane from start to end. */
        frontEdge: HalfEdge;
        /** Back is the plane from end to start. */
        backEdge: HalfEdge;
        /** */
        orphan: boolean;
        /** Items attached to this wall */
        items: Items.Item[];
        /** */
        onItems: Items.Item[];
        /** The front-side texture. */
        frontTexture: {
            url: string;
            stretch: boolean;
            scale: number;
        };
        /** The back-side texture. */
        backTexture: {
            url: string;
            stretch: boolean;
            scale: number;
        };
        /** Wall thickness. */
        thickness: number;
        /** Wall height. */
        height: number;
        /** Actions to be applied after movement. */
        private moved_callbacks;
        /** Actions to be applied on removal. */
        private deleted_callbacks;
        /** Actions to be applied explicitly. */
        private action_callbacks;
        /**
         * Constructs a new wall.
         * @param start Start corner.
         * @param end End corner.
         */
        constructor(start: Corner, end: Corner);
        private getUuid();
        resetFrontBack(): void;
        private snapToAxis(tolerance);
        fireOnMove(func: any): void;
        fireOnDelete(func: any): void;
        dontFireOnDelete(func: any): void;
        fireOnAction(func: any): void;
        fireAction(action: any): void;
        private relativeMove(dx, dy);
        fireMoved(): void;
        fireRedraw(): void;
        getStart(): Corner;
        getEnd(): Corner;
        getStartX(): number;
        getEndX(): number;
        getStartY(): number;
        getEndY(): number;
        remove(): void;
        setStart(corner: Corner): void;
        setEnd(corner: Corner): void;
        distanceFrom(x: number, y: number): number;
        /** Return the corner opposite of the one provided.
         * @param corner The given corner.
         * @returns The opposite corner.
         */
        private oppositeCorner(corner);
    }
}
declare module BP3D.Model {
    /**
     * A Room is the combination of a Floorplan with a floor plane.
     */
    class Room {
        private floorplan;
        corners: Corner[];
        /** */
        interiorCorners: Corner[];
        /** */
        private edgePointer;
        /** floor plane for intersection testing */
        floorPlane: THREE.Mesh;
        /** */
        private customTexture;
        /** */
        private floorChangeCallbacks;
        /**
         *  ordered CCW
         */
        constructor(floorplan: Floorplan, corners: Corner[]);
        private getUuid();
        fireOnFloorChange(callback: any): void;
        private getTexture();
        /**
         * textureStretch always true, just an argument for consistency with walls
         */
        private setTexture(textureUrl, textureStretch, textureScale);
        private generatePlane();
        private cycleIndex(index);
        private updateInteriorCorners();
        /**
         * Populates each wall's half edge relating to this room
         * this creates a fancy doubly connected edge list (DCEL)
         */
        private updateWalls();
    }
}
declare module BP3D.Model {
    /**
     * A Floorplan represents a number of Walls, Corners and Rooms.
     */
    class Floorplan {
        /** */
        private walls;
        /** */
        private corners;
        /** */
        private rooms;
        /** */
        private new_wall_callbacks;
        /** */
        private new_corner_callbacks;
        /** */
        private redraw_callbacks;
        /** */
        private updated_rooms;
        /** */
        roomLoadedCallbacks: JQueryCallback;
        /**
        * Floor textures are owned by the floorplan, because room objects are
        * destroyed and created each time we change the floorplan.
        * floorTextures is a map of room UUIDs (string) to a object with
        * url and scale attributes.
        */
        private floorTextures;
        /** Constructs a floorplan. */
        constructor();
        wallEdges(): HalfEdge[];
        wallEdgePlanes(): THREE.Mesh[];
        private floorPlanes();
        fireOnNewWall(callback: any): void;
        fireOnNewCorner(callback: any): void;
        fireOnRedraw(callback: any): void;
        fireOnUpdatedRooms(callback: any): void;
        /**
         * Creates a new wall.
         * @param start The start corner.
         * @param end he end corner.
         * @returns The new wall.
         */
        newWall(start: Corner, end: Corner): Wall;
        /** Removes a wall.
         * @param wall The wall to be removed.
         */
        private removeWall(wall);
        /**
         * Creates a new corner.
         * @param x The x coordinate.
         * @param y The y coordinate.
         * @param id An optional id. If unspecified, the id will be created internally.
         * @returns The new corner.
         */
        newCorner(x: number, y: number, id?: string): Corner;
        /** Removes a corner.
         * @param corner The corner to be removed.
         */
        private removeCorner(corner);
        /** Gets the walls. */
        getWalls(): Wall[];
        /** Gets the corners. */
        getCorners(): Corner[];
        /** Gets the rooms. */
        getRooms(): Room[];
        overlappedCorner(x: number, y: number, tolerance?: number): Corner;
        overlappedWall(x: number, y: number, tolerance?: number): Wall;
        saveFloorplan(): {
            corners: {};
            walls: any[];
            wallTextures: any[];
            floorTextures: {};
            newFloorTextures: {};
        };
        loadFloorplan(floorplan: any): void;
        getFloorTexture(uuid: string): any;
        setFloorTexture(uuid: string, url: string, scale: number): void;
        /** clear out obsolete floor textures */
        private updateFloorTextures();
        /** */
        private reset();
        /**
         * Update rooms
         */
        update(): void;
        /**
         * Returns the center of the floorplan in the y plane
         */
        getCenter(): any;
        getSize(): any;
        getDimensions(center: any): any;
        private assignOrphanEdges();
        findRooms(corners: Corner[]): Corner[][];
    }
}
declare module BP3D.Items {
    /**
     * A Floor Item is an entity to be placed related to a floor.
     */
    abstract class FloorItem extends Item {
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
        /** */
        placeInRoom(): void;
        /** Take action after a resize */
        resized(): void;
        /** */
        moveToPosition(vec3: any, intersection: any): void;
        /** */
        isValidPosition(vec3: any): boolean;
    }
}
declare namespace BP3D.Items {
    /**
     * A Wall Item is an entity to be placed related to a wall.
     */
    abstract class WallItem extends Item {
        /** The currently applied wall edge. */
        protected currentWallEdge: Model.HalfEdge;
        /** used for finding rotations */
        private refVec;
        /** */
        private wallOffsetScalar;
        /** */
        private sizeX;
        /** */
        private sizeY;
        /** */
        protected addToWall: boolean;
        /** */
        protected boundToFloor: boolean;
        /** */
        protected frontVisible: boolean;
        /** */
        protected backVisible: boolean;
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
        /** Get the closet wall edge.
         * @returns The wall edge.
         */
        closestWallEdge(): Model.HalfEdge;
        /** */
        removed(): void;
        /** */
        private redrawWall();
        /** */
        private updateEdgeVisibility(visible, front);
        /** */
        private updateSize();
        /** */
        resized(): void;
        /** */
        placeInRoom(): void;
        /** */
        moveToPosition(vec3: any, intersection: any): void;
        /** */
        protected getWallOffset(): number;
        /** */
        private changeWallEdge(wallEdge);
        /** Returns an array of planes to use other than the ground plane
         * for passing intersection to clickPressed and clickDragged */
        customIntersectionPlanes(): THREE.Mesh[];
        /** takes the move vec3, and makes sure object stays bounded on plane */
        private boundMove(vec3);
    }
}
declare module BP3D.Items {
    /** */
    abstract class InWallItem extends WallItem {
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
        /** */
        getWallOffset(): number;
    }
}
declare module BP3D.Items {
    /** */
    abstract class InWallFloorItem extends InWallItem {
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
    }
}
declare module BP3D.Items {
    /** */
    abstract class OnFloorItem extends FloorItem {
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
    }
}
declare module BP3D.Items {
    /** */
    abstract class WallFloorItem extends WallItem {
        constructor(model: Model.Model, metadata: Metadata, geometry: THREE.Geometry, material: THREE.MeshFaceMaterial, position: THREE.Vector3, rotation: number, scale: THREE.Vector3);
    }
}
declare module BP3D.Items {
    /** Factory class to create items. */
    class Factory {
        /** Gets the class for the specified item. */
        static getClass(itemType: any): any;
    }
}
declare module BP3D.Model {
    /**
     * The Scene is a manager of Items and also links to a ThreeJS scene.
     */
    class Scene {
        private model;
        private textureDir;
        /** The associated ThreeJS scene. */
        private scene;
        /** */
        private items;
        /** */
        needsUpdate: boolean;
        /** The Json loader. */
        private loader;
        /** */
        private itemLoadingCallbacks;
        /** Item */
        private itemLoadedCallbacks;
        /** Item */
        private itemRemovedCallbacks;
        /**
         * Constructs a scene.
         * @param model The associated model.
         * @param textureDir The directory from which to load the textures.
         */
        constructor(model: Model, textureDir: string);
        /** Adds a non-item, basically a mesh, to the scene.
         * @param mesh The mesh to be added.
         */
        add(mesh: THREE.Mesh): void;
        /** Removes a non-item, basically a mesh, from the scene.
         * @param mesh The mesh to be removed.
         */
        remove(mesh: THREE.Mesh): void;
        /** Gets the scene.
         * @returns The scene.
         */
        getScene(): THREE.Scene;
        /** Gets the items.
         * @returns The items.
         */
        getItems(): Items.Item[];
        /** Gets the count of items.
         * @returns The count.
         */
        itemCount(): number;
        /** Removes all items. */
        clearItems(): void;
        /**
         * Removes an item.
         * @param item The item to be removed.
         * @param dontRemove If not set, also remove the item from the items list.
         */
        removeItem(item: Items.Item, dontRemove?: boolean): void;
        /**
         * Creates an item and adds it to the scene.
         * @param itemType The type of the item given by an enumerator.
         * @param fileName The name of the file to load.
         * @param metadata TODO
         * @param position The initial position.
         * @param rotation The initial rotation around the y axis.
         * @param scale The initial scaling.
         * @param fixed True if fixed.
         */
        addItem(itemType: number, fileName: string, metadata: any, position: THREE.Vector3, rotation: number, scale: THREE.Vector3, fixed: boolean): void;
    }
}
declare module BP3D.Model {
    /**
     * A Model connects a Floorplan and a Scene.
     */
    class Model {
        /** */
        floorplan: Floorplan;
        /** */
        scene: Scene;
        /** */
        private roomLoadingCallbacks;
        /** */
        private roomLoadedCallbacks;
        /** name */
        private roomSavedCallbacks;
        /** success (bool), copy (bool) */
        private roomDeletedCallbacks;
        /** Constructs a new model.
         * @param textureDir The directory containing the textures.
         */
        constructor(textureDir: string);
        private loadSerialized(json);
        private exportSerialized();
        private newRoom(floorplan, items);
    }
}
declare module BP3D.Floorplanner {
    /** */
    const floorplannerModes: {
        MOVE: number;
        DRAW: number;
        DELETE: number;
    };
    /**
     * The View to be used by a Floorplanner to render in/interact with.
     */
    class FloorplannerView {
        private floorplan;
        private viewmodel;
        private canvas;
        /** The canvas element. */
        private canvasElement;
        /** The 2D context. */
        private context;
        /** */
        constructor(floorplan: Model.Floorplan, viewmodel: Floorplanner, canvas: string);
        /** */
        handleWindowResize(): void;
        /** */
        draw(): void;
        /** */
        private drawWallLabels(wall);
        /** */
        private drawWall(wall);
        /** */
        private drawEdgeLabel(edge);
        /** */
        private drawEdge(edge, hover);
        /** */
        private drawRoom(room);
        /** */
        private drawCorner(corner);
        /** */
        private drawTarget(x, y, lastNode);
        /** */
        private drawLine(startX, startY, endX, endY, width, color);
        /** */
        private drawPolygon(xArr, yArr, fill, fillColor, stroke?, strokeColor?, strokeWidth?);
        /** */
        private drawCircle(centerX, centerY, radius, fillColor);
        /** returns n where -gridSize/2 < n <= gridSize/2  */
        private calculateGridOffset(n);
        /** */
        private drawGrid();
    }
}
declare module BP3D.Floorplanner {
    /**
     * The Floorplanner implements an interactive tool for creation of floorplans.
     */
    class Floorplanner {
        private floorplan;
        /** */
        mode: number;
        /** */
        activeWall: any;
        /** */
        activeCorner: any;
        /** */
        originX: number;
        /** */
        originY: number;
        /** drawing state */
        targetX: number;
        /** drawing state */
        targetY: number;
        /** drawing state */
        lastNode: any;
        /** */
        private wallWidth;
        /** */
        private modeResetCallbacks;
        /** */
        private canvasElement;
        /** */
        private view;
        /** */
        private mouseDown;
        /** */
        private mouseMoved;
        /** in ThreeJS coords */
        private mouseX;
        /** in ThreeJS coords */
        private mouseY;
        /** in ThreeJS coords */
        private rawMouseX;
        /** in ThreeJS coords */
        private rawMouseY;
        /** mouse position at last click */
        private lastX;
        /** mouse position at last click */
        private lastY;
        /** */
        private cmPerPixel;
        /** */
        private pixelsPerCm;
        /** */
        constructor(canvas: string, floorplan: Model.Floorplan);
        /** */
        private escapeKey();
        /** */
        private updateTarget();
        /** */
        private mousedown();
        /** */
        private mousemove(event);
        /** */
        private mouseup();
        /** */
        private mouseleave();
        /** */
        private reset();
        /** */
        private resizeView();
        /** */
        private setMode(mode);
        /** Sets the origin so that floorplan is centered */
        private resetOrigin();
        /** Convert from THREEjs coords to canvas coords. */
        convertX(x: number): number;
        /** Convert from THREEjs coords to canvas coords. */
        convertY(y: number): number;
    }
}
declare module BP3D.Three {
    var Controller: (three: any, model: any, camera: any, element: any, controls: any, hud: any) => void;
}
declare module BP3D.Three {
    var Floor: (scene: any, room: any) => void;
}
declare module BP3D.Three {
    var Edge: (scene: any, edge: any, controls: any) => void;
}
declare module BP3D.Three {
    var Floorplan: (scene: any, floorplan: any, controls: any) => void;
}
declare module BP3D.Three {
    var Lights: (scene: any, floorplan: any) => void;
}
declare module BP3D.Three {
    var Skybox: (scene: any) => void;
}
/**
This file is a modified version of THREE.OrbitControls
Contributors:
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 */
declare module BP3D.Three {
    var Controls: (object: any, domElement: any) => void;
}
declare module BP3D.Three {
    /**
     * Drawings on "top" of the scene. e.g. rotate arrows
     */
    var HUD: (three: any) => void;
}
declare module BP3D.Three {
    var Main: (model: any, element: any, canvasElement: any, opts: any) => void;
}
declare module BP3D {
    /** Startup options. */
    interface Options {
        /** */
        widget?: boolean;
        /** */
        threeElement?: string;
        /** */
        threeCanvasElement?: string;
        /** */
        floorplannerElement?: string;
        /** The texture directory. */
        textureDir?: string;
    }
    /** Blueprint3D core application. */
    class Blueprint3d {
        private model;
        private three;
        private floorplanner;
        /** Creates an instance.
         * @param options The initialization options.
         */
        constructor(options: Options);
    }
}
declare module BP3D.Core {
    /** Enumeration of log contexts. */
    enum ELogContext {
        /** Log nothing. */
        None = 0,
        /** Log all. */
        All = 1,
        /** 2D interaction */
        Interaction2d = 2,
        /** Interior items */
        Item = 3,
        /** Wall (connectivity) */
        Wall = 4,
        /** Room(s) */
        Room = 5,
    }
    /** Enumeration of log levels. */
    enum ELogLevel {
        /** An information. */
        Information = 0,
        /** A warning. */
        Warning = 1,
        /** An error. */
        Error = 2,
        /** A fatal error. */
        Fatal = 3,
        /** A debug message. */
        Debug = 4,
    }
    /** The current log context. To be set when initializing the Application. */
    var logContext: ELogContext;
    /** Pre-check if logging for specified context and/or level is enabled.
     * This may be used to avoid compilation of complex logs.
     * @param context The log context to be verified.
     * @param level The log level to be verified.
     * @returns If this context/levels is currently logged.
     */
    function isLogging(context: ELogContext, level: ELogLevel): boolean;
    /** Log the passed message in the context and with given level.
     * @param context The context in which the message should be logged.
     * @param level The level of the message.
     * @param message The messages to be logged.
     */
    function log(context: ELogContext, level: ELogLevel, message: string): void;
}
declare module BP3D.Core {
    /** Version information. */
    class Version {
        /** The informal version. */
        static getInformalVersion(): string;
        /** The technical version. */
        static getTechnicalVersion(): string;
    }
}
