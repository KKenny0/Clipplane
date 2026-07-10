# Clipplane Design Direction

## Visual Theme

Clipplane is an editorial instrument for keeping a local trail, not a cloud dashboard. The interface should feel precise, quiet, and durable: an object for repeated use rather than a marketing surface.

## Palette

- Ink: dark evergreen, used for local-first actions and primary hierarchy.
- Paper: near-white green-tinted canvas, used to keep long sessions calm.
- Moss: restrained success and available states.
- Signal: clay-orange, reserved for attention and externally consequential states.

## Typography

The product uses a system UI face for controls and an available book-serif stack for brand and section titles. Display text is compact, with zero letter spacing; controls stay at a practical 12-14px.

## Components

- Buttons use a 5px radius. Primary actions are ink-filled; secondary actions are quiet outlined surfaces.
- Statuses use a small dot plus text, or a compact pill when they must sit in a data row.
- Tabs are a bottom-rule navigation strip, not floating pills.
- Settings sections use full-width bands and hairline separators. Only repeated history records receive item-level framing.

## Layout

Popup: brand, capture choice, save action, destination status, latest result.

Settings: workspace identity, tabs, one focused operational band at a time.

Onboarding: one clear Host requirement followed by one clear first-capture step.

## Motion

Use 120ms transform and opacity transitions with a cubic-bezier ease-out. The status dot breathes slowly. Reduced-motion users receive no nonessential animation.

## Guardrails

- No gradients, glass panels, decorative blobs, or generic card grids.
- External sync never looks more prominent than the local save path.
- Labels and status text never truncate in fixed slots.
- The logo must remain legible at 16px and use no remote asset.
