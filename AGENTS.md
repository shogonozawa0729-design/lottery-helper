# LATIAS — Codex instructions

## Project identity

This repository is the source of truth for **LATIAS**, a Chrome extension that assists with lottery-entry forms.
The goal is to reduce repetitive form entry while keeping final human control.

## Non-negotiable safety / product rules

- Never automatically click or trigger the final application, submit, purchase, order, payment, or confirmation action.
- Never bypass CAPTCHA, login, identity verification, SMS/email verification, queueing, rate limits, or other anti-abuse/security controls.
- Login, CAPTCHA, identity verification, and receipt/pickup date selection remain manual unless the user explicitly changes the product specification.
- Personal information (name, address, phone, email, account IDs, etc.) must not be committed to GitHub, hard-coded in rules, or logged remotely.
- Personal profile data belongs in each Chrome profile's `chrome.storage.local` only.
- Do not add telemetry or transmit personal data to external services.
- When multiple eligible products/quantities can safely be selected, prefer the maximum selectable quantity / all eligible products, but never finalize the application.
- Required consent/agreement controls may be selected automatically only when the option clearly represents affirmative consent. Never select negative/refusal options.

## Normal user flow

1. User opens a Chrome profile associated with one member.
2. User opens multiple lottery URLs (often from clipboard).
3. User manually completes any required login / CAPTCHA / identity verification.
4. LATIAS fills profile fields and safe selectable options.
5. LATIAS selects required affirmative agreement items where unambiguous.
6. LATIAS stops before the final submit/application/purchase/confirmation action.

## Repository map

- `README.md` — product rules and rule-authoring policy.
- `extension/popup.js` — popup/controller logic, remote rule loading, tab orchestration, and some universal form handling.
- `extension/question_mapper.js` — question/field interpretation helpers.
- `extension/rule_enhancer.js` — rule application/enhancement helpers.
- `rules/index.json` — active adapter registry and rule version.
- `rules/profile-fields.json` — supported profile field definitions.
- `rules/*.json` — reusable site/service adapters and form rules.

Important: the GitHub repository may not yet contain every file from the locally installed Chrome extension. Do not invent missing files or assume their implementation. If a task depends on `manifest.json`, `content.js`, popup HTML, options UI, service worker/background scripts, or other missing files, first inspect the local working tree when available and reconcile it with GitHub.

## Rule design principles

- Prefer reusable detection based on domain, stable paths, labels, accessible names, DOM/form structure, and semantic context.
- Avoid hard-coding one-off event URLs, form IDs, question IDs, or event IDs unless no safer reusable discriminator exists.
- If an exact ID is temporarily required, isolate it so it can later be replaced by a reusable rule.
- Prefer conservative behavior when intent is ambiguous: leave the field for manual handling rather than guess.
- Existing filled values should not be overwritten unless the task explicitly requires replacement.
- Preserve compatibility with previously working sites when changing universal logic.

## Change workflow

Before editing:

1. Read `README.md`.
2. Read `rules/index.json`.
3. Inspect the relevant adapter(s) and extension code before changing behavior.
4. Identify whether the fix belongs in universal logic or a site-specific adapter. Prefer universal fixes only when they are demonstrably safe across sites.

After editing:

1. Check that no final-submit automation was introduced.
2. Check that no personal information or secrets were added.
3. Validate JSON syntax for all changed rule files.
4. Verify that changed adapters are still registered correctly in `rules/index.json` when applicable.
5. If rule behavior changes, increment `rulesVersion` in `rules/index.json` so clients can refresh the remote bundle.
6. Summarize exactly what changed, which files changed, and what the user should manually test in Chrome.

## Debugging expectations

- Prefer evidence from the actual DOM/page structure over brittle guesses.
- When a site fails, capture or inspect labels, roles, names, input types, surrounding text, and relevant DOM structure.
- Distinguish between a rule-download/cache issue and a field-detection/click issue.
- Do not fix one form by broadly clicking every checkbox/radio button on all sites.
- For affirmative consent detection, explicitly exclude refusal/negative language.

## Naming

Use **LATIAS** as the product/project name in new documentation and developer-facing descriptions unless compatibility requires retaining the repository name `lottery-helper`.
