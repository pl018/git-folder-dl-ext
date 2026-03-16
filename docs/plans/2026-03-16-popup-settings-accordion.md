# Popup Settings Accordion Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collapse the popup settings section by default and allow the user to expand it on demand without changing any existing settings behavior.

**Architecture:** The popup HTML wraps the current settings controls in an accordion panel. The popup script owns a tiny expand/collapse controller with no persistence, and the popup smoke test verifies the panel starts hidden and opens when clicked.

**Tech Stack:** Chrome Extension popup HTML/CSS/JavaScript, Puppeteer smoke harness, PowerShell fallback build.

---

### Task 1: Add Accordion Structure

**Files:**
- Modify: `src/popup/popup.html`

**Step 1: Replace the static settings heading**

- Convert the `SETTINGS` label into a button-based accordion trigger.

**Step 2: Wrap the existing settings controls**

- Move the current settings content into a dedicated accordion panel that starts hidden.

### Task 2: Style The Accordion

**Files:**
- Modify: `src/popup/popup.css`

**Step 1: Add trigger styles**

- Make the accordion header span the section width and match the existing popup visual language.

**Step 2: Add panel layout styles**

- Preserve the existing vertical spacing when the settings panel is expanded.

### Task 3: Add Toggle Logic

**Files:**
- Modify: `src/popup/popup.js`

**Step 1: Bind accordion elements**

- Read the trigger and panel elements at startup.

**Step 2: Force the default state**

- Initialize the accordion as collapsed on every popup open.

**Step 3: Toggle on click**

- Flip `aria-expanded` and `hidden` without touching any stored settings values.

### Task 4: Extend Popup Smoke Coverage

**Files:**
- Modify: `test/cdp/harness.js`

**Step 1: Assert default collapse**

- Verify the settings panel is hidden when the popup first loads.

**Step 2: Assert expand behavior**

- Click the accordion trigger and confirm a settings control becomes visible.

### Task 5: Rebuild Dist

**Files:**
- Modify: `dist/popup/popup.html`
- Modify: `dist/popup/popup.css`
- Modify: `dist/popup/popup.js`

**Step 1: Rebuild**

Run: `powershell -File scripts/fallback-build.ps1`

**Step 2: Validate**

- Reload the unpacked extension from `dist/`
- Open the popup and confirm `SETTINGS` starts collapsed every time
- Expand it and verify the existing controls still behave as before
