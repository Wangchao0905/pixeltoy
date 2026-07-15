# Context

goal: Replan Pixel Toys UI into a focused production-tool interface that makes the screenplay-to-assets-to-storyboard-to-video workflow easier to scan, safer to operate, and ready for 70-90 second episode units plus later server assembly.

user: Solo creator or small production operator making AI-assisted short drama on desktop web. The user repeats the workflow often, cares about prompt quality, generation cost, task recovery, and clear production state.

JTBD: Start from a script, verify parsed assets, generate or upload references, build Production Boards, create video clips, and understand what is ready or blocked without hunting through disconnected panels.

constraints:
- stack: Node server with static main UI, standalone canvas, React + Vite admin island.
- deployment: local test, rsync to server without production data, remote test, PM2 reload.
- safety: no paid image or video generation without explicit user action.
- product style: dense operational studio, not a landing page.
- current pages: project home, studio, canvas, admin.
- visual constraints: keep Pixel Toys identity, but avoid overdone glass, generic blue/purple gradients, text overflow, and unreadable pixel typography.

success:
- primary workflow state is visible within 2 seconds on project open.
- paid actions are visually separated from read-only/edit actions.
- each page has one obvious primary task and stable secondary controls.
- asset, storyboard, and video readiness are represented with consistent statuses.
- mobile can inspect status, but full production remains desktop-first.
- implementation can be shipped incrementally without rewriting the whole app.

scope v1:
- product design plan only.
- define UI direction, information architecture, page layout, component rules, and rollout order.
- cover project home, studio, canvas, admin, and future assembly entry points.

non-goals:
- no code changes in this design step.
- no paid generation test.
- no full React rewrite of the main studio in the first UI pass.
- no marketing landing page.
- no new backend production feature unless needed for UI state visibility.

open assumptions:
- desktop production is the primary use case.
- React migration should stay incremental until the main flow has a stable design.
- long-form production should surface as package/assembly readiness, not a giant single canvas.

risks:
- If visual work happens before workflow hierarchy is simplified, the UI can become prettier but still confusing.
- If all pages are redesigned at once, deployment risk rises because the app is currently a mixed static/React codebase.
- If pixel typography is used broadly for Chinese labels, readability and overflow will regress.
