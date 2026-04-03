# Image Generation Prompt — AI Maestro AMP Communication Rules Directed Graph

## Style & Format

Create a **directed graph diagram** on a pure dark background (#070707). The style should be clean, geometric, and technical — like a network topology diagram or a system architecture poster. NOT a flowchart. NOT a mind map. It's a **directed graph** where nodes are circular avatar portraits and edges are colored arrows showing who can send messages to whom.

Canvas: **1800×1200px**, dark mode, landscape orientation.

---

## The 7 Nodes (Agent Titles)

Each node is a **circular robot avatar portrait** (80-90px diameter) with a bright colored glowing border ring, the title name in bold uppercase below, and a one-line description in smaller gray text.

### Node positions (hierarchical layout):

```
Layer 0 (top):        MANAGER (center-top, OUTSIDE team frame)

Layer 1 (upper-mid):  CHIEF-OF-STAFF (left)     AUTONOMOUS (far right, OUTSIDE team frame)

Layer 2 (center):     ORCHESTRATOR (center)

Layer 3 (bottom):     ARCHITECT (left)    INTEGRATOR (center)    MEMBER (right)
```

The 5 team agents (COS, ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER) are enclosed inside a **rounded rectangle frame** with a dashed amber/gold border, labeled "CLOSED TEAM" at the top-left corner.

MANAGER and AUTONOMOUS are **outside** this team frame.

### Node details:

| Node | Avatar | Border Color | Glow Color | Position | Description |
|------|--------|-------------|------------|----------|-------------|
| **MANAGER** | Astronaut robot, white/red helmet | Bright red #FF4444 | Red glow | Top center, outside team | "1 per host · Can message ALL titles" |
| **CHIEF-OF-STAFF** | Blue humanoid robot, gold accents | Amber #FFB800 | Amber glow | Upper-left, inside team | "1 per team · Message gateway" |
| **ORCHESTRATOR** | Small red robot, round head, glowing eyes | Bright lilac #BE8CFF | Lilac glow | Center, inside team | "1 per team · Task distribution" |
| **ARCHITECT** | Dark armored robot, red circular visor | Bright blue #29B7FF | Blue glow | Bottom-left, inside team | "Design authority · Routes via COS + O" |
| **INTEGRATOR** | Red-eyed robot, white/tan angular body | Bright green #00E88A | Green glow | Bottom-center, inside team | "Quality gate · Routes via COS + O" |
| **MEMBER ×N** | Small white/red robot, round head | Light gray #A0A0A0 | Gray glow | Bottom-right, inside team | "Programmer · Routes via COS + O" |
| **AUTONOMOUS** | Different robot (unique look) | Bright yellow #FFDC32 | Yellow glow | Upper-right, outside team | "No team · Can message: Manager, COS" |

Each avatar circle should have:
1. A bright colored **outer glow ring** (the node's color at ~30% opacity, slightly larger than the avatar)
2. A solid **border ring** (the node's color, 3-4px)
3. The robot portrait **clipped to a circle**
4. **Title text** below in the node's color, bold, uppercase, large (like 16-18px equivalent)
5. **Description text** below title in gray (#999), smaller

---

## The 24 Directed Arrows (no self-loops)

**CRITICAL: All arrows use the SAME color: bright teal #00E88A.** They should be **3px thick** with large, clearly visible **triangular arrowheads** at the receiving end. The arrows should be clean straight lines or gentle curves — never zigzag or overlap messily.

For **bidirectional** connections (e.g., M↔C), draw **two parallel arrows** slightly offset from each other (like a two-lane road) so both directions are clearly visible.

For **long-distance** connections (e.g., M→A, M→I, M→E), make the arrows slightly thinner and more transparent (like 50% opacity) so they don't dominate the graph.

### Arrow list (sender → recipient):

**From MANAGER (6 outbound):**
- M → C (Chief-of-Staff) — bright, short
- M → O (Orchestrator) — bright, medium
- M → A (Architect) — dim, long diagonal
- M → I (Integrator) — dim, long vertical
- M → E (Member) — dim, long diagonal
- M → U (Autonomous) — bright, horizontal to right

**From CHIEF-OF-STAFF (6 outbound):**
- C → M (Manager) — bright, upward ← **bidirectional with M→C**
- C → O (Orchestrator) — bright, diagonal down-right
- C → A (Architect) — bright, downward
- C → I (Integrator) — dim, long diagonal
- C → E (Member) — dim, long diagonal
- C → U (Autonomous) — bright, horizontal to right

**From ORCHESTRATOR (4 outbound):**
- O → C (COS) — bright, upward-left ← **bidirectional with C→O**
- O → A (Architect) — bright, down-left
- O → I (Integrator) — bright, downward
- O → E (Member) — bright, down-right

**From ARCHITECT (2 outbound):**
- A → C (COS) — bright, upward ← note: NOT directly to Manager
- A → O (Orchestrator) — bright, upward-right ← **bidirectional with O→A**

**From INTEGRATOR (2 outbound):**
- I → C (COS) — dim, long upward-left
- I → O (Orchestrator) — bright, upward ← **bidirectional with O→I**

**From MEMBER (2 outbound):**
- E → C (COS) — dim, long upward-left
- E → O (Orchestrator) — bright, upward-left ← **bidirectional with O→E**

**From AUTONOMOUS (2 outbound):**
- U → M (Manager) — bright, diagonal up-left
- U → C (COS) — bright, horizontal to left

**Total: 24 arrows** (27 connections minus 3 self-loops which are NOT shown).

---

## Subagent Clusters

Below each main agent node, show a cluster of **small dots** (6-8px each) in the agent's color, representing its subagents. Each dot is a tiny circle. Add a small label with the count.

| Agent | Subagent Count | Dot Color |
|-------|---------------|-----------|
| MANAGER | 1 dot | Red |
| CHIEF-OF-STAFF | 9 dots (two rows: 5+4) | Amber |
| ORCHESTRATOR | 5 dots | Lilac |
| ARCHITECT | 5 dots | Blue |
| INTEGRATOR | 10 dots (two rows: 5+5) | Green |
| MEMBER | 0 (label: "main-agent only") | — |
| AUTONOMOUS | 0 (label: "no role-plugin") | — |

---

## Team Boundary Frame

Draw a **large rounded rectangle** with:
- **Dashed amber/gold border** (#FFB800 at 25% opacity, 3px, dash pattern)
- Contains: COS, ORCHESTRATOR, ARCHITECT, INTEGRATOR, MEMBER
- Does NOT contain: MANAGER, AUTONOMOUS
- Label "CLOSED TEAM" in amber text at the top-left corner of the frame
- Semi-transparent dark fill (very subtle, like 2% white)

---

## Legend / Rules Panel (bottom of image)

Below the graph, a dark panel with rounded corners containing:

### Arrow legend:
- A teal arrow → = "can send AMP message to" (Ed25519 signed)
- Missing arrow = FORBIDDEN (server blocks + suggests routing)

### Rules as imperative statements (bright colored bullet points):
- 🔴 **MANAGER** must be able to message any agent of any title directly.
- 🟡 **CHIEF-OF-STAFF** must be able to message any agent of any title (acts as message gateway).
- 🟣 **ORCHESTRATOR** can message: Chief-of-Staff, Architect, Integrator, Member. Cannot message Manager or Autonomous.
- 🔵 **ARCHITECT, INTEGRATOR, MEMBER** can only message: Chief-of-Staff and Orchestrator. All others are forbidden.
- 🟡 **AUTONOMOUS** can message: Manager and Chief-of-Staff only. Cannot reach team members directly.
- ⚪ **Forbidden messages** are blocked by the server with an error suggesting who to route through.

### Three enforcement layers (compact):
- **LAYER 1 — SERVER API:** Ed25519 signature verification. Graph lookup on every message. Blocks + suggests routing.
- **LAYER 2 — AGENT PROMPTS:** Role-plugin main-agent files and AI Maestro skills encode rules. Agents self-enforce.
- **LAYER 3 — SUBAGENTS:** Only 1 main-agent per role-plugin uses AMP. Subagents cannot send messages. They talk only to their spawner.

### User note:
- **THE USER:** Exempt from rules. Can message any agent; any agent can reply. Must authenticate. Agents respond only to user-initiated contact.

---

## Visual Quality Requirements

- The graph must be **geometrically clean** — nodes evenly spaced, arrows symmetric where possible
- Arrows should **not cross over** avatar circles (route around them)
- Bidirectional arrows should be clearly visible as **two separate parallel lines** (not one line with arrows at both ends)
- The team boundary frame should be clearly visible but not dominant
- The overall feel should be like a **professional system architecture diagram** — not a hand-drawn sketch
- Background is pure dark (#070707) with subtle radial gradients for depth
- All text should use Montserrat (body) or Bebas Neue (titles) font family
- Node glow effects should be visible but subtle — not overpowering
