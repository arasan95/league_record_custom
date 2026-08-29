# Site Templates

This directory holds the single source for `site/` pages.

- `base.html` - shared layout with placeholders `{{lang}}`, `{{title}}`, `{{description}}`, `{{canonical}}`, `{{content}}`, `{{version}}`
- Content is in `site/content/en/*.html` and `site/content/ja/*.html` (extracted `<main>` blocks)

Build: `node scripts/build-site.cjs` generates `site/*.html` and `site/ja/*.html` from templates.
`package.json:build` runs this before `bun build` so `firebase.json:public` (`site`) stays in sync.

Future: move `site/content` to JSON for easier i18n and add `dist/site` output if needed.
