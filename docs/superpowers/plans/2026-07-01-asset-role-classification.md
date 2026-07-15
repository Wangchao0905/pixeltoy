# Asset Role Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent scene props, locations, production notes, and insert details from being kept as Character assets.

**Architecture:** Add a deterministic post-merge role classifier in `server.js`. It will run after rule/model asset merging and after coverage additions, correcting high-confidence type mistakes before writing the asset manifest.

**Tech Stack:** Node.js, existing `npm test`, existing `scripts/self-check.mjs`.

---

### Task 1: Add Guard Tests

**Files:**
- Modify: `scripts/self-check.mjs`

- [ ] Add self-check assertions that require a role classifier, type correction call sites, and concrete misclassification guards.
- [ ] Run `npm test` and verify it fails before implementation.

### Task 2: Implement Deterministic Type Correction

**Files:**
- Modify: `server.js`

- [ ] Add label/evidence classifiers for non-character, location, prop, insert, and character evidence.
- [ ] Add `correctAssetRoleFromEvidence()` and `correctAssetRolesFromEvidence()`.
- [ ] Apply correction after `mergeAnalyzerAssets()` and after coverage additions.
- [ ] Preserve locked manual assets.

### Task 3: Verify

**Files:**
- Test: `scripts/self-check.mjs`

- [ ] Run `npm test`.
- [ ] Confirm self-check passes and syntax checks pass.
