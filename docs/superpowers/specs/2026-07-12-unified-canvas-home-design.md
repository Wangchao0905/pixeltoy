# Unified Canvas Home Design

Date: 2026-07-12

## Goal

Replace the card-heavy Explore homepage with one Canvas-first surface inspired by the supplied Higgsfield Canvas reference. All primary tools remain reachable from a thin global top bar, while the page body reads as one continuous dark spatial canvas.

## Layout

- A 44px top bar contains Pixel Toys, Explore, Script, Image, Video, Storyboard, Canvas, Assets, and Productions.
- Canvas is the default active home item. Script, Image, Video, Storyboard, and Assets open the corresponding mutually exclusive workspace mode.
- The upper body is a full-width dotted canvas preview with connected visual nodes and a centered Pixel Toys Canvas title.
- The lower body contains a compact segmented filter and one canvas library grid.
- The library combines new-canvas entry, saved blank canvases, and production projects without separate feature, tool, and project sections.

## Interaction

- All Canvases shows blank canvases and productions.
- Productions shows production projects only.
- Quick Start shows creation entries only.
- Clicking a saved blank canvas opens `/canvas.html?canvas=<id>`.
- Clicking a production opens its existing production workspace.
- No action on this page triggers image or video generation.

## Visual Rules

- Use the existing dark navy tokens, subtle point grid, fine blue connection lines, and fluorescent green active navigation.
- Keep typography compact and avoid explanatory paragraphs.
- Use existing local Pixel Toys artwork for visual nodes; do not copy Higgsfield assets or text.
- Cards use restrained 6px radii and stable aspect ratios.

## Validation

- The previous feature grid and creative-tool matrix are absent.
- The top bar and canvas library are keyboard accessible.
- Empty and populated canvas lists render without blank states.
- Existing mode routing, project opening, blank-canvas creation, authentication, and paid-generation guards remain unchanged.
