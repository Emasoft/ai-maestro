# Image Generation Prompt — AI Maestro Workflow Road Map

## Style & Format

Create a **top-down road map infographic** in the style of a children's play mat / board game road map (like the reference images of city road play mats with roundabouts). Dark background (#070707). The road surface is dark gray asphalt with white dashed center lines and subtle edge markings. The overall layout is a vertical road that winds from top to bottom, passing through **6 roundabouts** connected by road segments. Each roundabout is a circular traffic circle where 3-4 robot avatars are positioned around the ring, like cars at a roundabout.

The visual style is: **isometric-ish top-down road map** with colorful road signs, glowing robot avatars at each roundabout, and labeled arrows showing the flow of documents (design docs, task docs, PRs) along the road.

Canvas size: approximately 1600px wide × 5000px tall. Portrait orientation, dark mode.

---

## The 6 Robot Agents (recurring characters)

Each agent is a **circular robot avatar portrait** (like a profile picture) with a colored glowing border ring. They appear at different roundabouts in different combinations. Use these exact colors for their borders and labels:

| Agent | Border Color | Avatar Description |
|-------|-------------|-------------------|
| **MANAGER** | Red (#FF4444) | Astronaut-style robot with white/red helmet, visor |
| **CHIEF-OF-STAFF** | Amber (#FFB800) | Blue humanoid robot with orange/gold accents |
| **ORCHESTRATOR** | Purple (#A764F6) | Small red robot with round head, red glowing eyes |
| **ARCHITECT** | Blue (#29B7FF) | Dark armored robot with red circular eye/visor, military look |
| **INTEGRATOR** | Green (#00E88A) | Red-eyed robot with white/tan angular body |
| **MEMBER** | Gray (#6B6B6B) | Small white/red robot with round head, simple design |

Each avatar has: glowing colored ring → circular portrait → title label below in matching color → one-line gray description text below that.

---

## Road Sign Types (use throughout)

**STOP signs** (red octagon with white "STOP" text) — placed at EVERY roundabout exit. These represent "MANAGER APPROVAL REQUIRED." Every roundabout has a STOP sign at its exit because nothing proceeds without the Manager's approval.

**Warning triangle signs** (yellow/amber triangle) — placed at roundabout entries. Specific warnings:
- "ROAD WORK AHEAD" — at Roundabout A (team under construction)
- "BEND AHEAD" — at Roundabout B (design iterations expected)
- "ROAD WORK" — at Roundabout C (tasks under construction)
- "TWO WAY TRAFFIC" — at Roundabout D (constant back-and-forth feedback)
- "SLIPPERY ROAD" — at Roundabout E (hotfixes may be reverted)

**Rectangular info signs** (green or blue rectangle on post):
- "AGENTS CREATED" — at Roundabout C (COS creates 1 programmer per task)
- "BLOCKED" — at Roundabout D (dependency wait column)
- "MERGE" (green, with merge arrow icon) — at Roundabout E exit (PR merged to dev branch)
- "QUALITY GATE" — at Roundabout E entry (all PRs must pass)
- "FINISH LINE" — at Roundabout F (release complete)
- "PARKING" — at Roundabout F (version tagged and stored)

Each sign is on a **visible post** (thin vertical line connecting sign to ground).

---

## The Road Layout (top to bottom)

### START (top of image)
- Green checkered flag banner: **"START — USER PROVIDES REQUIREMENTS"**
- Vertical road segment going down
- Small label next to road: "📄 Requirements posted as GitHub Issue. AMP message carries the URL."

### ROUNDABOUT A — TEAM FORMATION (amber/yellow theme)
- Circular roundabout road with amber-colored center island
- Center island label: **"TEAM FORMATION"**
- 3 agents positioned around the ring (clockwise): **MANAGER** (top-left), **CHIEF-OF-STAFF** (top-right), **ARCHITECT** (bottom, faded/semi-transparent — on standby)
- Entry road from top, exit road from bottom
- Road signs: Warning triangle "ROAD WORK AHEAD" at entry. Red STOP "MANAGER APPROVAL" at exit.
- Small arrows showing clockwise flow on the ring
- Description panel nearby: "Manager creates GitHub repo. COS evaluates project, suggests team, creates agents, assigns role-plugins."

### Road segment down
- Label: "📄 Approved design doc sent to ALL team members"

### ROUNDABOUT B — DESIGN LOOP (blue theme)
- Blue center island labeled **"DESIGN LOOP"**
- 4 agents: **MANAGER** (top-left), **CHIEF-OF-STAFF** (top-right), **ARCHITECT** (right — main actor), **ORCHESTRATOR** (bottom-right)
- **LOOP-BACK ROAD**: A red dashed road curves from the bottom-left of the roundabout back up to the top-left, labeled **"REJECTED → Manager sends detailed WHY + HOW to Architect → REVISE"**
- Signs: Blue triangle "BEND AHEAD" at entry. Red STOP "MANAGER + USER APPROVAL" at exit.
- Description: "Architect creates architecture, modules, specs, ADRs. Posts as GitHub Issue. Orchestrator can order revisions. Manager + User must approve before proceeding."

### Road segment down
- Label: "📋 Task design documents — one per task"

### ROUNDABOUT C — TASK PLANNING LOOP (purple theme)
- Purple center island labeled **"TASK PLANNING"**
- 3 agents: **MANAGER** (top-left), **ORCHESTRATOR** (top-right — main actor), **ARCHITECT** (bottom)
- Loop-back road (red dashed): "REJECTED → Manager explains WHY to Orchestrator → REVISE"
- Signs: Purple triangle "ROAD WORK" at entry. Amber rect "AGENTS CREATED — COS creates 1 Programmer per task". Red STOP at exit.
- Description: "Orchestrator splits design into tasks, creates task-design-docs, populates kanban. Architect provides detailed specs on request. COS creates one MEMBER (Programmer) agent per approved task."

### Road segment down
- Label: "💻 Code on feature branches + 📝 Pull Requests"

### ROUNDABOUT D — IMPLEMENTATION FEEDBACK LOOP (gray theme)
- Gray center island labeled **"IMPLEMENT FEEDBACK"**
- 3 agents: **ORCHESTRATOR** (top-left), **ARCHITECT** (top-right), **MEMBER ×N** (right — main actor)
- **TWO loop-back roads**:
  - Red dashed (left side): "Orchestrator rejects work → Member fixes → resubmit"
  - Blue dashed (right side): "Design flaw found → Orchestrator→Architect fix → Member retries"
- Signs: Yellow triangle "TWO WAY TRAFFIC" at entry. Amber rect "BLOCKED — Dependency wait column". Blue rect "U-TURN — Design flaw → back to Architect".
- Description: "Programmers download task doc from GitHub. Have design doc for reference. Ask Orchestrator for clarifications. Report blockers (kanban 'blocked' column). If design is wrong: Orchestrator→Architect loop to fix architecture."

### Road segment down
- Label: "📝 Unreviewed PR submitted to GitHub"

### ROUNDABOUT E — THE BIG TRINITY (green theme, LARGER than others)
This is the **main development cycle** and should be visually the biggest and most prominent roundabout.
- Green center island labeled **"PLAN → CODE → REVIEW"**
- 4 agents: **MANAGER** (left — "human-review" column handler), **ORCHESTRATOR** (top), **MEMBER ×N** (right), **INTEGRATOR** (bottom-right — "ai-review" column handler)
- **Loop-back road** (red dashed): "INTEGRATOR rejects PR → Member fixes → resubmit"
- **PR evolution badges** below the roundabout showing the PR lifecycle: **📝 UNREVIEWED** → **✅ AI-REVIEWED** → **👤 HUMAN-REVIEWED** → **🏁 MERGED** (connected by arrows)
- Signs: Red octagon "QUALITY GATE — All PRs must pass" at entry. Green rect "MERGE — PR → dev branch" at exit. Amber triangle "SLIPPERY ROAD — Hotfixes may be reverted".
- Additional note: "If ai-review backlog grows → COS creates extra Integrator agents"
- Description: "Integrator handles 'ai-review' kanban column: code review, tests, lint, types, CI/CD. Manager handles 'human-review' column (~90% self, asks user if available). Orchestrator can push hotfixes but Integrator must check and may revert."

### Road segment down
- Label: "🏁 All kanban tasks → completed"

### ROUNDABOUT F — RELEASE & DOCUMENTATION (green theme)
- Green center island labeled **"RELEASE & DOCS"**
- 4 agents: **MANAGER** (top-left), **ORCHESTRATOR** (top-right), **INTEGRATOR** (right), **ARCHITECT** (bottom)
- Signs: Green checkered "FINISH LINE" at entry. Amber rect "PARKING — Version tagged".
- Description: "Manager approves release. Orchestrator orders execution. Integrator merges dev→main, creates version tag, builds packages, runs CI/CD, publishes GitHub release. Architect writes post-release docs (wiki, Mintlify, API docs). Can request Programmers to write usage examples."

### LOOP-BACK (bottom of image)
- A **wide green dashed road** curves from the bottom back up toward Roundabout B
- Big label: **"↺ NEXT RELEASE CYCLE → back to DESIGN LOOP"**
- Note: "Development is cyclic — each release starts a new Design→Plan→Code→Review cycle"

---

## KANBAN COLUMNS (below the road map)

A horizontal strip showing 7 columns with colored top borders:

| Column | Top Border Color | Handler |
|--------|-----------------|---------|
| Backlog | Gray | New issues |
| Pending | Purple | Prioritized |
| In Progress | Blue | Member coding |
| Blocked | Amber | Dependency wait |
| AI-Review | Green | Integrator gate |
| Human-Review | Red | Manager / User |
| Completed | Bright Green | Merged & done |

---

## KEY RULES TO CONVEY VISUALLY

1. **Manager approves EVERYTHING** — Every roundabout has a STOP sign at its exit. The Manager avatar appears in every roundabout.
2. **Rejection = loop back** — Red dashed roads show where rejected work goes back for revision, with the Manager always sending a detailed explanation of WHY.
3. **Documents travel as GitHub Issue URLs** — Small document/envelope icons on the road segments between roundabouts.
4. **One Programmer per task** — The MEMBER avatar at roundabouts D and E has "×N" indicating multiple instances.
5. **The flow is cyclic** — The bottom loops back to the top for the next release.
6. **Each roundabout is a collaboration loop** — The clockwise arrows on the ring road show agents iterating until the exit gate (Manager approval) is passed.

---

## IMPORTANT VISUAL NOTES

- The road should look like actual asphalt — dark gray with white dashed center lines
- Roundabouts should have a visible center island (colored, with text label)
- Agent avatars should be clearly visible and distinguishable (use the colored glowing rings)
- Road signs should be recognizable road sign shapes (octagon, triangle, rectangle) on posts
- The overall composition should read top-to-bottom like a journey/roadmap
- Keep the dark background (#070707) — this is a dark-mode infographic
- Use the Space Grotesk or Montserrat font family for all text
