# Gemini Image Prompt — Communication Rules Graph

Generate a directed graph diagram on a dark background (#070707).

## Layout

7 circular nodes arranged hierarchically, connected by teal arrows:

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

Each node is a circular portrait (80px) with a bright glowing colored border ring and the title name in bold below. Use distinct robot character portraits for each:

- **MANAGER** — red (#FF4444) border, top center, outside team frame
- **CHIEF-OF-STAFF** — amber (#FFB800) border, upper-left inside team
- **ORCHESTRATOR** — lilac (#BE8CFF) border, center inside team
- **ARCHITECT** — blue (#29B7FF) border, bottom-left inside team
- **INTEGRATOR** — green (#00E88A) border, bottom-center inside team
- **MEMBER ×N** — gray (#A0A0A0) border, bottom-right inside team
- **AUTONOMOUS** — yellow (#FFDC32) border, upper-right, outside team frame

## Arrows (ALL teal #00E88A, 3px thick, large triangular arrowheads)

Draw exactly these 24 directed arrows. Each arrow goes FROM the first node TO the second node:

**MANAGER sends to:** COS, Orchestrator, Architect, Integrator, Member, Autonomous (6 arrows radiating down and right)

**COS sends to:** Manager, Orchestrator, Architect, Integrator, Member, Autonomous (6 arrows)

**ORCHESTRATOR sends to:** COS, Architect, Integrator, Member (4 arrows)

**ARCHITECT sends to:** COS, Orchestrator (2 arrows upward)

**INTEGRATOR sends to:** COS, Orchestrator (2 arrows upward)

**MEMBER sends to:** COS, Orchestrator (2 arrows upward)

**AUTONOMOUS sends to:** Manager, COS (2 arrows to the left)

Bidirectional connections (like Manager↔COS) should show TWO parallel offset arrows going in opposite directions.

## Subagents

Below each main node, show smaller circles (40px, half-size) fanning out symmetrically downward, connected by thin lines to the parent. Each small circle has a gear/robot icon and a name label:

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

Clean, geometric, technical — like a professional network topology diagram. No hand-drawn look. Symmetric where possible. Arrows must not cross over node circles. Dark background with subtle colored glows behind each node.
