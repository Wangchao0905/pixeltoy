# Pixel Toys Skills Applied

Last updated: 2026-07-01

## Installed Skills

The following GitHub skills were installed into `~/.codex/skills`:

| Skill | Source | Applied to Pixel Toys |
| --- | --- | --- |
| `last30days` | `mvanhorn/last30days-skill` | Use for current-market research before product direction, prompt strategy, or provider selection decisions. Not run automatically because it may call external research APIs. |
| `taste-skill` | `leonxlnx/taste-skill` | Use as a frontend quality gate for canvas/studio UI work. Pixel Toys is an operational tool, so apply only the anti-slop audit principles, not landing-page hero rules. |
| `create-prd` | `phuryn/pm-skills` | Applied in `docs/PRD-long-form-production.md`. |
| `test-scenarios` | `phuryn/pm-skills` | Applied in `docs/TEST_SCENARIOS-long-form-production.md`. |
| `intended-vs-implemented` | `phuryn/pm-skills` | Applied in `docs/INTENT-vs-IMPLEMENTATION.md`. |
| `pre-mortem` | `phuryn/pm-skills` | Applied in `docs/PREMORTEM-long-form-production.md`. |

Restart Codex to pick up newly installed skills as invocable skills.

## GitHub Repos Checked But Not Installed As Skills

These repositories match the names in the screenshot, but they are not standard Codex skill directories with a directly installable `SKILL.md` at the relevant top level:

| Name | Source | Reason |
| --- | --- | --- |
| Headroom | `headroomlabs-ai/headroom` | Tool/library/MCP/proxy for token compression, not a Codex skill package. Can be evaluated later as infrastructure, but should not be wrapped into this app without a separate integration decision. |
| Open Notebook | `lfnovo/open-notebook` | Full knowledge-base application, not a Codex skill. Could inspire a future project knowledge module, but not a direct install. |
| MarkItDown | `microsoft/markitdown` | Python document-conversion tool, not a Codex skill. Pixel Toys already has `.docx` extraction in `server.js`; adding this should be a separate dependency decision with security review. |

## Project Rules Adopted From The Skills

1. Do not add frontend visual changes without first stating a design read for the specific surface.
2. Treat Pixel Toys as a dense production tool, not a marketing landing page.
3. Every new production-flow feature needs a PRD or scoped spec before code.
4. Every production-flow feature needs acceptance test scenarios before deployment.
5. Risky launch changes need a pre-mortem before production reload.
6. Audits must compare documented intent to implementation evidence, not just scan code.
7. Market/current-trend research should be explicit and cited; do not silently browse or call paid APIs.

## Frontend Taste Gate For Pixel Toys

For `/`, `/canvas.html`, and production/admin surfaces:

- Prefer dense, readable, operational layouts over decorative hero or marketing composition.
- Avoid generic AI-purple gradients and generic glass-card overload.
- Keep typography legible for Chinese UI labels; pixel font is an accent, not an excuse for overflow.
- Do not use cards inside cards.
- Icon/button controls should be compact and predictable.
- Every visible control needs loading, disabled, empty, and error states when it triggers async work.
- Before shipping UI changes, run `npm test` and visually inspect the changed surface when feasible.

