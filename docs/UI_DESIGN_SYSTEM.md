# Industrial Precision Workstation

The light interface prioritizes the drawing and camera image over decoration. It
uses flat surfaces, restrained borders, and Japanese-capable system fonts with
IBM Plex Sans for Latin text and numbers.

## Tokens

| Purpose | Color |
| --- | --- |
| Primary / hover / soft | `#2C5F4A` / `#214B3A` / `#EAF2ED` |
| Background / surface / secondary surface | `#F3F6F5` / `#FFFFFF` / `#F7F9F8` |
| Text / secondary / border | `#21312D` / `#64746F` / `#D6DFDA` |
| Selection / selection background | `#2563EB` / `#EFF6FF` |
| Success / warning / danger | `#18794E` / `#A45A00` / `#B42318` |
| Camera / PDF surroundings | `#1F2926` / `#E6E9EB` |

These are UI colors only. Saved contour colors and line styles are independent
of the theme and must never be replaced by theme defaults.

## Layout and controls

Use 4, 8, 12, 16, 24 and 32 px spacing; 14 px body text, 12–13 px
secondary text, 16 px panel titles, and a 20 px application title. Controls
have a common minimum height and clear primary, secondary, destructive,
disabled and focus states. Use compact, flat sections rather than nested cards.

The desktop workspace has resizable camera, drawing and inspector panes.
The drawing takes the remaining space. At 1400 px and below, the inspector
opens as a dismissible drawer over the two primary panes; controls remain
available. Widths are clamped to the viewport, saved locally, keyboard
adjustable, and resettable. Individual panels scroll rather than the whole
application.

## Interaction and accessibility

Keep all labels in Japanese and English, including status and resize controls.
Use semantic buttons and labeled form controls, visible keyboard focus,
textual state indicators and live feedback. Dialogs contain keyboard focus,
close on Escape and restore focus. The camera remains contained and unzoomed;
PDF viewing controls must not mutate persisted sample placement. Physical
calibration is not implied by the overlay scale or display pixels.
