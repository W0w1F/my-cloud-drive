# Tasks: 云盘文件管理系统——完整技术实施

**Input**: Design documents from `specs/002-frontend-ux/`

**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/, research.md, quickstart.md

**Tests**: Playwright E2E smoke tests included (Phase 6). No unit test tasks — stored procedure testing via quickstart.md validation.

**Organization**: Tasks grouped by user story (US1–US4). Backend SQL tasks in Foundational phase (Phase 2) support all stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Backend SQL: `backend/sql/`
- Frontend: `frontend/src/` (CSS in `css/`, JS in `js/`)
- Tests: `frontend/tests/e2e/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, database creation

- [x] T001 Create project directory structure per plan.md: `backend/sql/`, `backend/api/`, `frontend/src/css/`, `frontend/src/js/`, `frontend/src/assets/fonts/`, `frontend/tests/e2e/`, `backups/`
- [x] T002 [P] Create MySQL database `cloud_drive` with `utf8mb4` charset and enable Event Scheduler (`SET GLOBAL event_scheduler = ON`) — create `backend/sql/000-init.sql`
- [x] T003 [P] Download and self-host Source Serif 4 font (SIL OFL) into `frontend/src/assets/fonts/source-serif-4/` with `@font-face` declarations in `frontend/src/css/fonts.css`
- [x] T004 [P] Configure Playwright for E2E testing in `frontend/tests/e2e/playwright.config.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, DCL, stored procedures, functions, triggers, events, indexes, and frontend design tokens. ALL user stories depend on this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Backend: Schema & DCL

- [x] T005 Create DDL schema `backend/sql/001-schema.sql`: `users`, `file_nodes` (with self-ref FK `parent_id`), `physical_blocks` (with UNIQUE `sha1_hash` + CHECK `ref_count >= 0`), all columns per data-model.md
- [x] T006 Create DCL scripts `backend/sql/002-dcl.sql`: `CREATE USER drive_admin@localhost` (DDL+maintenance), `CREATE USER drive_app@'%'` (SELECT/INSERT/UPDATE/EXECUTE only), `audit_logs` table (INSERT-only per Constitution V), GRANT/REVOKE per contracts/dcl-scripts.sql
- [x] T007 [P] Create composite indexes `backend/sql/007-indexes.sql`: `idx_parent_status (parent_id, status)`, `idx_owner_status (owner_id, status)`, `idx_name_search (name(255), status)`, `idx_audit_created (created_at)`

### Backend: Stored Procedures (Constitution VI)

- [x] T008 Create `sp_upload_file` in `backend/sql/003-stored-procedures.sql`: full dedup upload flow — SHA-1 lookup → SELECT...FOR UPDATE on physical_blocks → INSERT or UPDATE ref_count → INSERT file_nodes — all in one transaction with explicit BEGIN/COMMIT/ROLLBACK
- [x] T009 [P] Create `sp_soft_delete_node` in `backend/sql/003-stored-procedures.sql`: recursive CTE cascading status UPDATE to `deleted` for target node + all descendants, single-transaction, decrement physical_blocks.ref_count for file-type nodes
- [x] T010 [P] Create `sp_restore_node` in `backend/sql/003-stored-procedures.sql`: restore a soft-deleted node to `active`, increment ref_count for file-type nodes, insert audit_log record
- [x] T011 [P] Create `sp_move_node` in `backend/sql/003-stored-procedures.sql`: validate no cycle (new parent is not a descendant of node), UPDATE parent_id, insert audit_log with operation_type MOVE_FILE/MOVE_DIRECTORY

### Backend: Functions (Constitution III)

- [x] T012 Create `fn_get_node_full_path(node_id INT)` in `backend/sql/004-functions.sql`: recursive CTE traversing parent_id chain upward, GROUP_CONCAT with ORDER BY depth DESC SEPARATOR '/', returns VARCHAR(4096)

### Backend: Triggers (Constitution V)

- [x] T013 Create `tg_audit_node_change` in `backend/sql/005-triggers.sql`: AFTER UPDATE on file_nodes — when status changes → INSERT audit_logs (operation_type DELETE_FILE/RESTORE_FILE, old_value/new_value JSON); when parent_id changes → INSERT audit_logs (operation_type MOVE_FILE/MOVE_DIRECTORY)
- [x] T014 [P] Create `tg_after_node_physical_delete` in `backend/sql/005-triggers.sql`: AFTER DELETE on file_nodes — decrement physical_blocks.ref_count for file-type nodes, INSERT audit_logs with operation_type PHYSICAL_DELETE

### Backend: Event Scheduler (Constitution VI)

- [x] T015 Create `evt_clean_recycle_bin` in `backend/sql/006-events.sql`: daily 02:00, DELETE file_nodes WHERE status='deleted' AND modified_at < NOW() - INTERVAL 30 DAY, trigger cascades to ref_count update via tg_after_node_physical_delete

### Frontend: Design Tokens & Shell

- [x] T016 [P] Create CSS design tokens `frontend/src/css/tokens.css`: oklch() custom properties for light theme (bg oklch(95% 0 0), text oklch(15% 0 0), accent #C04A1A) and dark theme (bg oklch(10% 0 0), text oklch(90% 0 0), same accent), skeleton colors, spacing scale (4/8/12/16/20/24/32px)
- [x] T017 [P] Create API client `frontend/src/js/api.js`: fetch wrapper with base URL `/api/v1`, structured error handling (console.error format per FR-008), window.onerror global capture, XSS sanitization helper (stripHTML for file/directory names per FR-022)
- [x] T018 [P] Create HTML entry shell `frontend/src/index.html`: DOCTYPE, meta viewport, CSP meta tag (`default-src 'self'; script-src 'self'` per FR-022), link all CSS files, script all JS files (defer), theme toggle button placeholder in header, dual-pane container (#app > #tree-panel + #grid-panel)

### Frontend: State & Theme

- [x] T019 [P] Create client state manager `frontend/src/js/state.js`: current directory ID, selected node ID, file list cache, upload queue, event emitter pattern for cross-component communication
- [x] T020 [P] Create theme manager `frontend/src/js/theme.js`: read `prefers-color-scheme`, manual toggle (persist to localStorage), apply `data-theme` attribute to `<html>`, 200ms CSS transition on switch per dark mode edge case

**Checkpoint**: Foundation ready — database fully operational with all SPs/functions/triggers/events, frontend shell with design tokens loads. User story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - 双栏布局 (Priority: P1) 🎯 MVP

**Goal**: Left fixed-width (260px) directory tree + right adaptive file grid, responsive breakpoints, zero AI Slop decorations

**Independent Test**: Open index.html in browser; verify tree on left (260px), grid on right (fills remaining width). Click directory node to select it. Resize to 768px — tree collapses to hamburger menu.

### Implementation for User Story 1

- [x] T021 [P] [US1] Create directory tree CSS `frontend/src/css/tree.css`: recursive indent (20px/level), node height 32px, expand/collapse arrow (6×6 CSS triangle or Unicode ▶/▼), selected highlight (accent background 15% opacity), hover 10% opacity, NO file type icons, NO color tags, NO border accents per FR-002
- [x] T022 [P] [US1] Create file grid CSS `frontend/src/css/grid.css`: CSS Grid with `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`, gap 16px, card padding 12px, card border-radius 8px (subtle, no accent border), file name single-line truncation, human-readable file size, relative time display per FR-003
- [x] T023 [US1] Create directory tree component `frontend/src/js/tree.js`: fetch tree from API GET /api/v1/tree, render recursive `<ul>` with lazy-load children on expand, cache rendered nodes, emit 'directory-selected' event on click, highlight selected node, support 255-level depth
- [x] T024 [US1] Create file grid component `frontend/src/js/grid.js`: fetch file list from API GET /api/v1/files?parent_id=X, render card grid, auto-refresh on 'directory-selected' event from tree, virtual scrolling via CSS `content-visibility: auto` (>40 items per research.md), lazy thumbnail loading via IntersectionObserver
- [x] T025 [US1] Create layout CSS `frontend/src/css/layout.css`: dual-pane flexbox (#tree-panel flex: 0 0 260px, #grid-panel flex: 1), 1px neutral divider between panes, responsive breakpoints (≥1024px: 260px tree; 768-1023px: 220px tree; <768px: tree hidden, hamburger overlay)
- [x] T026 [US1] Wire tree+grid into `frontend/src/index.html`: tree-panel mounts tree.js, grid-panel mounts grid.js, initial load shows root directory contents, connect state.js for current directory tracking
- [x] T027 [US1] Implement hamburger menu for mobile: <768px shows ☰ button, tapping opens tree as full-height overlay drawer, backdrop click closes, CSS transition 250ms
- [x] T028 [US1] Implement dark mode in tree+grid: all tree.css and grid.css colors reference tokens.css custom properties (via `var(--color-*)`), toggle via theme.js updates `<html data-theme>` seamlessly

**Checkpoint**: User Story 1 fully functional — directory tree navigation + file grid rendering at all breakpoints, light+dark themes, zero AI Slop. Independently testable.

---

## Phase 4: User Story 2 - 骨架屏与状态显性化 (Priority: P1)

**Goal**: High-fidelity skeleton screens for ALL API-driven UI regions, honest empty/error states, min 300ms display, shimmer animation

**Independent Test**: Throttle network to 3G in DevTools, click a directory node. Verify skeleton cards appear instantly (≤100ms), match final card layout structure, shimmer animation plays, transition to real content is smooth. Navigate to empty directory — verify only "此目录为空" text, no illustrations.

### Implementation for User Story 2

- [x] T029 [P] [US2] Create skeleton CSS `frontend/src/css/skeleton.css`: `.skeleton-card` (180×135 thumbnail rect + two text bars 140px×14px + 80px×12px), `.skeleton-tree-row` (indent spacer + 12×12 arrow + 120px×14px bar), shimmer `@keyframes` (left-to-right gradient sweep 1.5s infinite), light/dark color tokens via `var()`
- [x] T030 [US2] Create skeleton state manager `frontend/src/js/skeleton.js`: SkeletonState class with states `loading`/`loaded`/`empty`/`error`, 300ms minimum display timer (prevents flash on fast responses), renderSkeleton(container, layoutType) method, transition to real content via crossfade (opacity 0→1 over 200ms)
- [x] T031 [US2] Integrate skeleton into tree component: on 'directory-selected' event, grid.js calls skeleton.renderSkeleton(gridContainer, 'grid'), then fetches API, on response skeleton.replaceWithReal(cards). On API error, skeleton shows error state "加载失败" + retry button per FR-008
- [x] T032 [US2] Integrate skeleton into search: on search submit, clear old grid content immediately, show skeleton matching grid layout (no fake filenames per FR-005), on response transition to results or empty state
- [x] T033 [US2] Create upload progress card in `frontend/src/js/upload.js`: skeleton card variant showing real file name + `<progress>` bar, updates with XMLHttpRequest upload.onprogress, emits 'upload-complete' or 'upload-error' event
- [x] T034 [US2] Implement empty state: when API returns `items: []`, skeleton transitions to single `<p>` "此目录为空" centered in grid area — no illustrations, no guidance text, no placeholder icons per FR-007
- [x] T035 [US2] Implement error state: when API fails or timeout (10s), skeleton transitions to error card "加载失败" + retry button, console.error structured log per FR-008

**Checkpoint**: User Stories 1 AND 2 both functional — skeleton screens cover every API call, empty/error states handled honestly. Independently testable together.

---

## Phase 5: User Story 4 - 反 AI Slop 视觉约束 (Priority: P1, cross-cutting)

**Goal**: Enforce all anti-AI-Slop rules defined in FR-014–FR-019. This phase is an audit pass on all existing frontend code plus final constraint implementations.

**Independent Test**: Run SC-008 audit checklist — DevTools inspection confirms zero hits on: purple gradients, emoji icons, rounded card+border accent, fake stats, SVG hand-drawn images, Inter/Roboto as display font, neon glow effects, Drop-in UI component library imports.

### Implementation for User Story 4

- [x] T036 [P] [US4] Audit and fix CSS for FR-014 violations: grep all `frontend/src/css/*.css` for purple hex values (`#7C3AED`, `#A855F7`, etc.), gradient backgrounds without brand provenance, neon glow (`box-shadow: 0 0 *` with saturated colors), border-left accent on cards — replace with neutral alternatives from tokens.css
- [x] T037 [P] [US4] Audit and fix font usage for FR-016 compliance: ensure all display text (headings, file names, tree nodes) uses `var(--font-display)` (Source Serif 4), body text uses `var(--font-body)` (system font stack), verify NO Inter/Roboto/Arial in `font-family` declarations
- [x] T038 [P] [US4] Audit color provenance for FR-015/SC-009: scan all `frontend/src/css/*.css` for hardcoded color values, replace with tokens.css custom property references, ensure only accent color (#C04A1A) and oklch() neutral scale values exist outside tokens.css
- [x] T039 [US4] Implement file type labels for non-image files (FR-014 sub-item): when `thumbnailUrl === null`, render plain text label "PDF"/"DOCX"/etc. in `<span>` with muted color — NO SVG hand-drawn icons, NO emoji file type indicators
- [x] T040 [US4] Implement Chinese typography compliance (FR-017): replace all English straight quotes `""` with Chinese corner brackets `「」` in Snackbar messages, error texts, empty state prompts across all JS files
- [x] T041 [US4] Final FR-018/FR-019 audit: verify `frontend/src/index.html` has zero `<script src="...unpkg.com...">` or `<link href="...cdn.jsdelivr...">` imports, verify no Drop-in UI library is referenced, remove any decorative filler elements (fake dividers, meaningless stats, icon-per-title patterns)

**Checkpoint**: Anti-Slop audit complete — all 6 FR-014 sub-items pass, SC-008 zero-hit, SC-009 color provenance verified. Frontend is visibly "authored by intent" not AI-default.

---

## Phase 6: User Story 3 - 动效反馈 (Priority: P2)

**Goal**: Hero Reveal animation for instant upload (400ms expo-out), damped slide-out for delete (350ms), Snackbar undo, frame-rate validated at 60fps

**Independent Test**: Upload a duplicate file (triggering instant upload) — verify Hero Reveal animation plays (80%→100% scale + 0.5→1.0 opacity, 400ms). Delete a file — verify card slides right 8px then accelerates out, adjacent cards batch-reflow smoothly. Check DevTools Performance panel for 60fps.

### Implementation for User Story 3

- [x] T042 [P] [US3] Create animation CSS `frontend/src/css/animations.css`: `@keyframes hero-reveal` (scale 0.8→1.0, opacity 0.5→1.0, expo-out cubic-bezier), `@keyframes damped-slide-out` (translateX 0→8px ease-in 150ms, then translateX 8px→100% + opacity 1→0 ease-out 200ms), `@keyframes slide-in-restore` (reverse of slide-out), `@keyframes card-reflow` (grid gap animation 250ms)
- [x] T043 [US3] Create animation orchestrator `frontend/src/js/animations.js`: queue manager for concurrent animations (click events queue during Hero Reveal per FR-013), batch reflow merger (multiple consecutive deletes → single card-reflow pass), AnimationIntent model per data-model.md
- [x] T044 [US3] Implement Hero Reveal: in upload.js, on 'upload-complete' with `instant_upload: true` response, add `hero-reveal` class to upload progress card, after animation end (animationend event) replace with final FileCard, ensure no other entrance animations fire per FR-009
- [x] T045 [US3] Implement damped slide-out delete: in grid.js, on delete action confirmed, add `damped-slide-out` class to card, on animation end remove card DOM, call orchestrator.scheduleReflow() for batch card repositioning, then call API POST /api/v1/files/{id}/delete
- [x] T046 [US3] Implement Snackbar undo: after delete animation completes, show Snackbar at page bottom "已删除「filename」" with "撤销" button, 5s timer, on click-undo call API POST /api/v1/files/{id}/restore and insert card back with `slide-in-restore` animation per FR-012
- [x] T047 [US3] Implement delete via long-press on mobile: touchstart/touchend timing (≥600ms = long-press), show action sheet "删除「filename」?", confirm triggers same slide-out flow, touch feedback via `:active` state per edge case

**Checkpoint**: All animations working — Hero Reveal at 60fps, damped slide-out smooth, Snackbar undo functional on desktop+mobile. US1+US2+US4 already complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Database maintenance, performance optimization, monitoring, backup, E2E testing

### Database Maintenance & Performance (from user directive §3, §4)

- [x] T048 [P] Create maintenance script `backend/sql/008-maintenance.sql`: `ANALYZE TABLE file_nodes, physical_blocks` for statistics update, `EXPLAIN` example with DENSE_RANK() for large file space analysis, slow query log enable/config, error log location query, connection processlist check
- [x] T049 [P] Create backup script `backend/sql/008-maintenance.sql` (appendix): `mysqldump` command template with `--routines --events --triggers --single-transaction`, timestamped output path `backups/cloud_drive_YYYYMMDD_HHMMSS.sql`
- [x] T050 [P] Verify all composite indexes from T007 are applied: run `SHOW INDEX FROM file_nodes`, confirm idx_parent_status and idx_name_search appear in EXPLAIN output for common queries per quickstart.md §6
- [x] T051 [P] Verify Event Scheduler: run `SHOW EVENTS FROM cloud_drive`, confirm evt_clean_recycle_bin is ENABLED, interval 1 DAY, starts 02:00:00

### E2E Testing

- [x] T052 [P] Write Playwright E2E smoke test `frontend/tests/e2e/smoke.spec.js`: page load → tree visible → click directory → skeleton appears → grid loads → upload file → Hero Reveal on dedup → delete file → slide-out → Snackbar → undo → dark mode toggle → mobile breakpoint hamburger
- [x] T053 [P] Write Playwright E2E anti-slop audit test `frontend/tests/e2e/anti-slop.spec.js`: scan page for purple hex colors, emoji characters in UI elements, Inter/Roboto font usage, SVG-as-icon patterns, verify CSP header present per SC-008

### Documentation & Delivery

- [x] T054 Run quickstart.md §1-§9 validation steps sequentially, document any failures, fix before delivery
- [x] T055 Verify Constitution compliance: run AI-generated code audit (scan all .sql for DELETE FROM without approval comments, scan for root/postgres/sa in connection strings per Constitution IV), document all findings

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001-T004) — BLOCKS all user stories
- **US1 Layout (Phase 3)**: Depends on Foundational (T005-T020) — T016-T020 specifically
- **US2 Skeleton (Phase 4)**: Depends on US1 Layout (T021-T028) — skeleton replaces grid/tree content
- **US4 Anti-Slop (Phase 5)**: Can start after US1+US2 (T021-T035) — audit pass on existing code
- **US3 Animations (Phase 6)**: Depends on US1+US2 — animations overlay on existing grid/upload
- **Polish (Phase 7)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — No dependencies on other stories
- **US2 (P1)**: Depends on US1 (needs grid/tree components to add skeleton overlay)
- **US4 (P1)**: Depends on US1+US2 (audits existing frontend code)
- **US3 (P2)**: Depends on US1+US2 (animations on grid cards + upload progress)

### Within Each Phase

- Backend SQL tasks (T005-T015): All [P] tasks can run in parallel (different files)
- Frontend CSS tasks: All [P] tasks can run in parallel (different files)
- Frontend JS tasks: Sequential within each story (state → components → wiring)

### Parallel Opportunities

- T002 (MySQL init), T003 (fonts), T004 (Playwright) — all parallel in Setup
- T007 (indexes) parallel with T008-T011 (stored procedures) — different files
- T013 (audit trigger), T014 (physical delete trigger) — parallel, different triggers
- T016 (tokens.css), T017 (api.js), T018 (index.html), T019 (state.js), T020 (theme.js) — all parallel, different files
- T021 (tree.css), T022 (grid.css) — parallel CSS files
- T029 (skeleton.css) parallel with US1 implementation
- T036-T038 (anti-slop audit CSS files) — all parallel
- T042 (animations.css) parallel with US1/US2 development
- T048-T051 (maintenance) — all parallel
- T052, T053 (E2E tests) — parallel

---

## Parallel Example: Foundational Frontend (Phase 2)

```bash
# Launch all frontend foundation tasks together:
Task: "Create CSS design tokens in frontend/src/css/tokens.css"
Task: "Create API client in frontend/src/js/api.js"
Task: "Create HTML entry shell in frontend/src/index.html"
Task: "Create client state manager in frontend/src/js/state.js"
Task: "Create theme manager in frontend/src/js/theme.js"
```

## Parallel Example: User Story 1 CSS

```bash
# Launch layout CSS tasks together:
Task: "Create directory tree CSS in frontend/src/css/tree.css"
Task: "Create file grid CSS in frontend/src/css/grid.css"
Task: "Create layout CSS in frontend/src/css/layout.css"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T020) — CRITICAL
3. Complete Phase 3: US1 Layout (T021-T028)
4. **STOP and VALIDATE**: Open index.html, verify tree+grid work at all breakpoints
5. Deploy/demo backend + frontend shell

### Incremental Delivery

1. Setup + Foundational → Database operational, design tokens ready
2. Add US1 Layout → Tree navigation + file grid → Demo (MVP!)
3. Add US2 Skeleton → Every API call shows honest skeleton → Demo
4. Add US4 Anti-Slop → Zero AI Slop audit pass → Demo
5. Add US3 Animations → Hero Reveal + damped slide-out → Demo
6. Polish → Maintenance scripts, E2E tests → Ship

### Parallel Team Strategy

With multiple developers after Foundational completes:

- **Developer A**: US1 Layout (tree.js, grid.js, layout.css) → then US3 Animations
- **Developer B**: US2 Skeleton (skeleton.css, skeleton.js) → then US4 Anti-Slop audit
- **Developer C**: Backend maintenance + E2E tests (Phase 7) — can start after US1 complete

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- All SQL files MUST pass Constitution AI audit (no unapproved DELETE, no root connections, explicit BEGIN/COMMIT/ROLLBACK)
- All CSS MUST use tokens.css custom properties (no hardcoded colors outside tokens.css)
- Commit after each task or logical group
