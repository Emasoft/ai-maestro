# Gemini Image Prompt — Communication Rules Graph

Generate a directed graph diagram on a dark background (#070707).

## Layout

7 circular nodes arranged hierarchically, connected by bright glowing arrows:

```
            MANAGER (red border)
           ↙     ↘
  CHIEF-OF-STAFF    AUTONOMOUS (yellow, far right)
    (amber)         
        ↓
   ORCHESTRATOR (purple, center)
    ↙    ↓    ↘
ARCHITECT  INTEGRATOR  MEMBER
 (blue)    (green)    (gray)
```

A dashed amber rounded rectangle labeled "CLOSED TEAM" encloses COS, ORCHESTRATOR, ARCHITECT, INTEGRATOR, and MEMBER. MANAGER and AUTONOMOUS are outside this frame.

## Nodes

Each node is a circular robot portrait (80px) with a bright glowing colored border ring and ONLY the title name in bold below. No subtitles or descriptions — just the title.

- **MANAGER** — red (#FF4444) border, top center, outside team frame
- **CHIEF-OF-STAFF** — amber (#FFB800) border, upper-left inside team
- **ORCHESTRATOR** — lilac (#BE8CFF) border, center inside team
- **ARCHITECT** — blue (#29B7FF) border, bottom-left inside team
- **INTEGRATOR** — green (#00E88A) border, bottom-center inside team
- **MEMBER** — gray (#A0A0A0) border, bottom-right inside team
- **AUTONOMOUS** — yellow (#FFDC32) border, upper-right, outside team frame

## Arrows — THICK, 3D, GLOWING

All arrows are **bright teal (#00E88A)**, **5-6px thick**, with a **3D tube/pipe appearance** (highlight on top edge, shadow on bottom edge to create depth). Large triangular arrowheads. Every arrow must **glow** with a teal halo (like neon tubing).

Where arrows cross each other, one must clearly pass **OVER** and the other **UNDER** — use the 3D shading to show which is in front (the one on top has a shadow falling on the one below). This is critical for readability.

Draw exactly these 24 directed arrows:

**MANAGER sends to:** COS, Orchestrator, Architect, Integrator, Member, Autonomous (6 arrows radiating down and right)

**COS sends to:** Manager, Orchestrator, Architect, Integrator, Member, Autonomous (6 arrows)

**ORCHESTRATOR sends to:** COS, Architect, Integrator, Member (4 arrows)

**ARCHITECT sends to:** COS, Orchestrator (2 arrows upward)

**INTEGRATOR sends to:** COS, Orchestrator (2 arrows upward)

**MEMBER sends to:** COS, Orchestrator (2 arrows upward)

**AUTONOMOUS sends to:** Manager, COS (2 arrows to the left)

Bidirectional connections (like Manager↔COS) should show TWO parallel offset arrows going in opposite directions, like a two-lane highway.

## Subagents

Below each main node, show smaller circles (40px, half the diameter of main nodes) fanning out symmetrically downward, connected by thin lines to the parent. Each small circle has a gear/robot icon and a name label below it:

- Below MANAGER (1): report-generator
- Below COS (9, two rows): approval-coord, lifecycle-mgr, perf-reporter, plugin-config, recovery-coord, resource-mon, skill-valid, staff-planner, team-coord
- Below ORCHESTRATOR (5): checklist, docker-expert, experimenter, task-summary, team-orch
- Below ARCHITECT (5): api-research, cicd-design, doc-writer, modularizer, planner
- Below INTEGRATOR (10, two rows): api-coord, bug-invest, code-review, committer, debug, github-sync, verifier, pr-eval, screenshot, test-eng
- Below MEMBER: label "main-agent only"
- Below AUTONOMOUS: label "no role-plugin"

## Bottom Panel

A dark rounded box at the bottom with:
- Arrow legend: "→ = can send AMP message (Ed25519 signed)"
- "Missing arrow = FORBIDDEN — server blocks and suggests routing"
- Rules in colored bullets matching each node's color
- Three enforcement layers: SERVER API, AGENT PROMPTS, SUBAGENTS
- User note: "Exempt from rules. Can message any agent."

## Style

Clean, geometric, technical — like a professional network topology diagram or circuit board. No hand-drawn look. Symmetric where possible. Arrows route AROUND node circles, never through them. Where arrows must cross, use 3D over/under rendering. Dark background with colored glows behind each node. The arrows should be the most prominent visual element — thick, bright, glowing neon tubes that clearly show the communication topology.
