# Attendance Web Agent Guide

- Project: local-first attendance/payroll UI (`attendance-web`), backed by PocketBase.
- Skills are installed in `.opencode/skills`.
- This file is loaded through `opencode.json > instructions`.

## Best-fit skill routing

| Skill | When to use |
| --- | --- |
| `impeccable` | First choice for UI/UX design, polish, redesign, hierarchy, layout, copy, accessibility, and component-level design review. |
| `dashboard-design` | Best for data-heavy screens, tables, reports, and dashboard-style layouts. |
| `ui-ux-pro-max` | Secondary UI/UX guide with broad style, typography, charts, and responsive details. |
| `frontend-ui-engineering` | Building new pages/components and meeting production-quality/front-end standards. |
| `ui-styling` | Styling, theming, and design-system consistency work. |
| `browser-testing-with-devtools` | Debugging DOM, network, console, and rendering behavior in the browser. |
| `test-driven-development` | Changing payroll, scoring, or any business logic with tests first. |
| `code-simplification` | Simplifying overly complex screens or dead/duplicate code. |
| `code-review-and-quality` | Reviewing larger changes before accepting them. |
| `planning-and-task-breakdown` | Large multi-file features or when estimates are needed. |
| `shipping-and-launch` | Pre-launch checks, deployment/rollback planning. |
| `git-workflow-and-versioning` | Commits, PRs, branching, and clean change organization. |

## How to use

1. Default to `impeccable` for any UI/UX task in this app.
2. Use `dashboard-design` for report-heavy or tabular dashboard work.
3. Use `frontend-ui-engineering` or `ui-styling` when you are implementing instead of reviewing design.
4. For logic changes, prefer `test-driven-development` before editing.
5. If a task is substantial, start with `planning-and-task-breakdown`, then use the implementation/review skills.
6. For deployment, use `shipping-and-launch` before shipping.
7. When unsure which skill fits, use `using-agent-skills`.

## Notes
- Prefer `impeccable` and `dashboard-design` for project-specific UI quality.
- Avoid adding new global skills unless explicitly requested.
- Keep changes focused and avoid unrelated rewrites.
