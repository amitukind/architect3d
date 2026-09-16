# Drawing a plan

Everything structural is drawn in the 2D view. Press <kbd>1</kbd> to fill the
window with it, or <kbd>2</kbd> to keep the 3D view beside you.

## Walls and rooms

Press <kbd>W</kbd> and drag to draw a wall. Keep dragging from the end of the
last one and the walls join at a shared corner — close the loop back to where
you started and the space inside becomes a room, with a floor, a ceiling and an
area.

Press <kbd>R</kbd> and drag to draw a rectangular room in one gesture, which is
what you want for most rooms.

Press <kbd>V</kbd> to go back to selecting and moving. This is the tool you will
spend most of your time in: drag a corner to move it, drag a wall to move both
of its corners, and click either to see its measurements.

Press <kbd>X</kbd> to delete walls by clicking them. To remove something you
have selected, <kbd>Delete</kbd> works everywhere.

## Getting the length right

While you are drawing, the length of the wall you are dragging is shown in a
box you can type into. **Type a number and press <kbd>Enter</kbd>** and the wall
becomes exactly that long. Press <kbd>Tab</kbd> instead and the length is
committed without ending the run, so you can walk around a room typing each
side.

Two more things help:

- **Snapping.** <kbd>S</kbd> turns snap-to-grid on and off, and holding
  <kbd>Shift</kbd> snaps while you hold it. The status bar along the bottom
  shows whether snapping is on.
- **The display unit.** The top bar switches between metres, centimetres,
  millimetres, inches, and feet and inches. It changes what you read and type,
  never what is stored.

## Measuring and labelling

Press <kbd>D</kbd> and drag between two points to leave a dimension line. It
stays with the design and updates if what it measures moves.

Press <kbd>T</kbd> and click to leave a text label — a room name, a note to
yourself, anything you want on a printed plan.

## Corners, walls and rooms have settings

Click any of them and the panel on the right fills with what you can change.
Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>.</kbd> to show or hide that panel.

- **A corner** carries an elevation, which is how you get a room with a
  different ceiling height.
- **A wall** carries its thickness, its height, and a material on each face —
  so a feature wall is one wall with one face changed.
- **A room** carries its name, its floor and its ceiling.

## More than one storey

Use the level switcher at the edge of the plan to add a storey above or below.
Each storey has its own plan and its own furniture, and the storey underneath
shows as a faint outline so you can line walls up.

Stairs come from the furniture catalog and are drawn from numbers — the number
of treads and the rise of each — rather than being a fixed model.

## If you make a mistake

<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> undoes, and
<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> redoes. The
history covers everything, including opening a different design — so opening
the wrong file is one keystroke away from being fixed.

<kbd>Esc</kbd> stops whatever you are drawing and closes whatever is open.
