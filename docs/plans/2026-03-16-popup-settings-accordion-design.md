# Popup Settings Accordion Design

**Date:** 2026-03-16

## Goal

Collapse the popup `SETTINGS` section by default so recent download cards are visible sooner, while keeping every existing setting and its behavior unchanged once expanded.

## User-Facing Behavior

- The `SETTINGS` heading becomes a clickable accordion trigger.
- Every time the popup opens, the settings body starts collapsed.
- Clicking the heading expands the full existing settings form.
- Clicking it again collapses the form.
- `AUTHENTICATION` and `RECENT DOWNLOADS` stay visible at all times.

## Architecture

### Popup Markup

- Wrap the existing settings controls in a dedicated accordion panel.
- Use a button-style section header with `aria-expanded` and `hidden` so the control remains accessible and easy to style.

### Popup Controller

- Initialize the accordion in the collapsed state on popup load.
- Toggle only the panel visibility and `aria-expanded` value.
- Do not persist accordion state in storage.

### Styling

- Add a lightweight accordion trigger style that matches the current popup theme.
- Use a simple chevron-like indicator that flips between collapsed and expanded states.

## Testing

- Extend the popup smoke test to assert that:
  - the accordion exists
  - the settings panel is hidden by default
  - clicking the accordion reveals the settings controls
