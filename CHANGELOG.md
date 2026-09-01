## 4.1.14 (2026-09-01)

- Fixed the card crossing its Home Assistant Sections row boundary when the help panel or dynamic content makes it taller than six grid rows.
- Sections now use the card's natural content height while retaining full-width and half-width resize options.
- Added a regression check that rejects fixed row constraints for this dynamic card.

## 4.1.13 (2026-08-28)

- Isolation: Bento CSS is component-local and cannot be captured from `window.HAToolsBentoCSS` by load order.
- Security: remove the suite-wide DOM/shadow-root injector; the support footer now renders only inside this card.
- Security: normalize localStorage keys and editor values before inherited escaping; restore the editor's scoped escape helper.
- Layout/lifecycle: make the action grid respect narrow card boundaries and cancel delayed reload on disconnect.
- Accuracy: report the public card registry exactly, or N/A when unavailable; remove the fabricated minimum and document scan.
- Test: add foreign-card isolation, no-document-observer and hostile-array runtime checks.

## 4.1.12 (2026-07-18)

- Fix: "Clear EVERYTHING" now hard-reloads the page, as the README documents. Previously the reload only happened via the separate Hard reload button.

## 4.1.11 (2026-07-18)

- Fix (UI): the small accent dot before section titles no longer detaches from the title text (it was pushed to the opposite edge by the header's flex space-between); it is now pinned next to the title.

# Changelog — Purge Cache

## [4.1.8] - 2026-06-15

- Theme: dark/light now follows the active Home Assistant theme (luminance of --card-background-color) instead of OS prefers-color-scheme.


## [4.1.7] - 2026-06-15

- Theme: dark/light now follows the active Home Assistant theme (luminance of --card-background-color) instead of OS prefers-color-scheme.


## [4.1.6] - 2026-06-15

- Theme: dark/light now follows the active Home Assistant theme (luminance of --card-background-color) instead of OS prefers-color-scheme.


## [4.1.3] - 2026-05-12

### Fixed
- Removed Google Fonts CDN @import (1 occurrence(s)); now uses system font stack with Inter as the preferred locally-installed face.
- Normalized bare `font-family: "Inter", sans-serif` declarations to a complete cross-platform system stack.
- Privacy section in README: claim now matches behaviour (no CDN dependencies).

All notable changes to **Purge Cache** are documented here.

## [4.0.0] - 2026-05-10

### Major
- **Split from `MacSiem/ha-tools` monorepo** into a dedicated standalone HACS plugin.
- Bundled Bento Design System CSS inline — no shared dependency required.
- Inlined `_haToolsEsc` XSS sanitizer.
- Persistence keys migrated to per-tool namespace `ha-purge-cache-…` (clean break — old data under `ha-tools-…` is **not** migrated automatically).
- Donation/support footer added to the panel.
- Cross-tool discovery banner removed; each tool stands on its own.

### Compatibility

- Home Assistant ≥ 2024.1.0
