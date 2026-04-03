# Gemini Image Prompt — AI Maestro Communication Rules

Create a dark-mode infographic showing a directed graph of 7 AI agent roles and how they can communicate. The image title at the top is "AMP COMMUNICATION RULES" in large bold white text.

## What this image shows

This is a hierarchical directed graph like a network topology map. 7 robot characters are arranged in layers on a near-black background (#070707). Bright glowing neon-teal arrows connect them, showing who can send messages to whom. The arrow direction matters — an arrow FROM A TO B means A can message B, not the reverse.

## The 7 agents — arranged in 4 layers

**Top layer (outside team):**
MANAGER — a robot character inside a circle with a thick bright RED glowing border. Positioned top-center. This is the boss — arrows radiate FROM it to all other agents below.

**Second layer:**
Left side, inside a large rounded dashed golden frame labeled "CLOSED TEAM":
CHIEF-OF-STAFF — robot in a circle with thick bright AMBER/GOLD glowing border. This is the gateway — almost as many arrows as the Manager.

Right side, OUTSIDE the team frame:
AUTONOMOUS — robot in a circle with thick bright YELLOW glowing border. Isolated, with only 2 outgoing arrows.

**Third layer (inside team frame):**
ORCHESTRATOR — robot in a circle with thick bright LILAC/PURPLE glowing border. Center of the team, hub for the bottom row.

**Bottom layer (inside team frame):**
Three agents side by side:
ARCHITECT (bright BLUE glowing border) — INTEGRATOR (bright GREEN glowing border) — MEMBER (bright SILVER/GRAY glowing border)

Each circle shows a unique robot character portrait, with the role title in bold text below in the matching color. No other text near the nodes.

## The team frame

A large rounded rectangle with a dashed golden/amber border encloses CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR, and MEMBER. Label "CLOSED TEAM" in small amber text at the top-left corner. MANAGER and AUTONOMOUS are OUTSIDE this frame.

## The arrows — the star of the image

All arrows are the same bright neon TEAL color (#00E88A). They are THICK (like glowing neon tubes), with a subtle 3D appearance — a brighter highlight along the top edge and a darker shadow along the bottom, giving them depth like illuminated pipes. Each arrow has a large solid triangular arrowhead at the destination end.

Where two arrows travel between the same pair of nodes in opposite directions, show them as two parallel lines slightly offset (like a two-lane road), each with its own arrowhead pointing in its direction.

Where arrows cross over each other, render one ABOVE and one BELOW using the 3D shading — the foreground arrow casts a subtle shadow on the one behind it.

**The arrow connections (what you must draw):**

The MANAGER (top, red) sends arrows DOWN to every other node — 6 arrows radiating outward like sunbeams. These are the most prominent arrows.

The CHIEF-OF-STAFF (amber) sends arrows to every other node too — 6 arrows. Notably, an arrow goes UP to MANAGER (making that link bidirectional) and one goes RIGHT to Autonomous.

The ORCHESTRATOR (purple) sends arrows to 4 nodes: up-left to CHIEF-OF-STAFF, down-left to ARCHITECT, down to INTEGRATOR, down-right to MEMBER.

ARCHITECT, INTEGRATOR, and MEMBER each send only 2 arrows: one up-left to CHIEF-OF-STAFF and one up to ORCHESTRATOR. These are thinner/dimmer to show their limited reach.

AUTONOMOUS sends 2 arrows: up-left to MANAGER and left to CHIEF-OF-STAFF.

**Arrows that do NOT exist (important for correctness):**
- No arrow from ORCHESTRATOR to MANAGER (must route through CHIEF-OF-STAFF)
- No arrow from Architect/Integrator/Member to MANAGER (must route through CHIEF-OF-STAFF)
- No arrow from ARCHITECT/INTEGRATOR/MEMBER to AUTONOMOUS
- No arrow from AUTONOMOUS to ORCHESTRATOR/ARCHITECT/INTEGRATOR/MEMBER

## Subagents — small icons fanning below each main agent

Each main agent has helper subagents shown as smaller circles fanning out in a symmetric arc below their parent. Subagent circle diameter must be **half** the diameter of the main agent circles. A thin line connects each subagent to its parent. Each subagent has a unique small icon/symbol inside its circle and its name in tiny text below.

**CRITICAL: Subagents must be in the SAME ZONE as their parent.** If the parent is inside the team frame, subagents are inside. If outside, subagents are outside. Never cross the team boundary.

The subagents per parent:
- MANAGER (outside frame): 1 subagent — report-generator
- CHIEF-OF-STAFF (inside frame): 9 subagents in two rows — approval-coord, lifecycle-mgr, perf-reporter, plugin-config, recovery-coord, resource-mon, skill-valid, staff-planner, team-coord
- ORCHESTRATOR (inside frame): 5 subagents — checklist, docker-expert, experimenter, task-summary, team-orch
- ARCHITECT (inside frame): 5 subagents — api-research, cicd-design, doc-writer, modularizer, planner
- INTEGRATOR (inside frame): 10 subagents in two rows — api-coord, bug-invest, code-review, committer, debug, github-sync, verifier, pr-eval, screenshot, test-eng
- MEMBER (inside frame): no subagents, small label "main-agent only"
- AUTONOMOUS (outside frame): no subagents, small label "no role-plugin"

Each subagent icon must be unique — no two should look the same.

## Bottom legend panel

A dark rounded panel at the bottom, organized as **distinct sections with big bold titles and icon-pointed lists**:

**ARROW LEGEND** (big title)
▸ Teal arrow = "can send AMP message" (with a glowing arrow icon as bullet)
▸ Missing arrow = FORBIDDEN — server blocks and suggests routing

**RULES BY ROLE** (big title, each bullet uses the role's color as the icon/bullet)
🔴 MANAGER — can message all agents directly
🟡 CHIEF-OF-STAFF — can message all agents (acts as gateway)
🟣 ORCHESTRATOR — can message CHIEF-OF-STAFF, Architect, Integrator, Member
🔵 ARCHITECT / INTEGRATOR / MEMBER — can only message CHIEF-OF-STAFF and Orchestrator
🟡 AUTONOMOUS — can only message MANAGER and CHIEF-OF-STAFF

**FOUR ENFORCEMENT LAYERS** (big title)
🛡️ LAYER 1 — SERVER API: Ed25519 signature verification on every message
🤖 LAYER 2 — AGENT PROMPTS: role-plugins encode allowed recipients
🔒 LAYER 3 — SUBAGENT ISOLATION: only main-agents use AMP, subagents cannot
👤 LAYER 4 — USER AUTHENTICATION: the user is exempt from agent rules but must authenticate with the server. Can message any agent. Agents respond only to user-initiated contact.

Each section title should be large, bold, and clearly separated. Each list item should use a distinctive icon or colored bullet point — not plain text dashes. The panel should look like a polished reference card, not a wall of text.

## Style direction

Think: Tron Legacy meets network topology diagram. Dark background, bright neon glowing elements, clean geometric lines. The arrows are the visual hero — thick, luminous, clearly directional. The agent circles glow softly in their colors against the dark background. Professional, technical, beautiful. NOT a flowchart, NOT a mind map, NOT hand-drawn. This is a precise engineering diagram rendered with cinematic lighting.
