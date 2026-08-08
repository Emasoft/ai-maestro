---
trdd-id: 3QRUDK12
title: Remote USER registration and the ASSISTANT collaboration model (USER ruling)
column: planned
created: 2026-08-08T10:14:35+0200
updated: 2026-08-08T10:14:35+0200
current-owner: ai-maestro-hub-session
task-type: feature
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-08T10:14:35+0200
project-id: ai-maestro
labels: [multi-user, assistant, registration, tailscale, security]
external-refs: [ai-maestro#39, ai-maestro#86]
---

# Remote USER registration and the ASSISTANT collaboration model

**This card records a USER RULING, dictated 2026-08-08 in answer to issue #39's open question
("is multi-user registration wanted?"). The answer is YES, with the exact model below.** It
unblocks #39 AC4 (ASSISTANT auto-provisioning) — the gate was "native-user registration does
not exist"; it is now a mandated feature with a specified shape. Implementation is future work
decomposed from this card; nothing here is built yet.

## USER dictation (verbatim, 2026-08-08 — the authoritative source; the distillation below must
## never be read as superseding it)

> No, the ai-maestro server had one admin, called MAESTRO-USER, that must register locally. But
> it has multiple USER that can connect remotely and register remotely from any device connected
> to the same tailscale VPN of the ai-maestro. the USER can only contribute to project if invited
> by the MANAGER and it will do so by the use of a special agent created to only respond to him,
> the ASSISTANT , titled ASSISTANT. the ASSISTANT cannot join teams, but it can share the design
> folder with other agents if the MANAGER approve its collaboration to the same project. it can
> clone the github repos of the project (a project can have multiple repos) and make PRs. the
> MAINTAINER agent delegated by the MANAGER to maintain the repo will review and eventually merge
> its PR or refuse asking to fix things. This is the only way an USER connected and registered
> remotely can collaborate to projects. of course it can also simply use the ASSISTANT to develop
> its own projects in isolation. any browser from an ip inside the same tailscale VPN can
> register to ai-maestro and work remotely, giving instructions to its ASSISTANT. it does not
> have access to the host settings of course, only to the settings relative to its user and
> account, and can install extensions or configure its own ASSISTANT as he wish (except for the
> assistant role plugin of course, that cannot be changed, and the other basic required
> extensions and core plugins every agent must have). the hooks of the assistant will restrict
> even more the access to files outside the workdir, even for reads, except for certain locally
> scoped folders or project scoped folders or other files belonging to the very assistant or
> needed for collaborate to projects, etc. also the ASSISTANT is able to install/uninstall
> extensions to its own local scope, but not to other agents. it cannot even see other agents or
> message them unless he is approved by the MANAGER as a collaborator to the same project. only
> in that case it can message the other agents working at the same project, and of course it can
> always message with the MANAGER. but reading the host files outside of the workdir and outside
> of those exeptions, is strictly blocked by hooks and other permissions rules specific of the
> ASSISTANT role plugin.

## Normative distillation

**Identity model**
- Exactly ONE admin: **MAESTRO-USER**, registered LOCALLY on the host.
- Multiple remote **USER**s: self-registration from any device inside the SAME Tailscale VPN as
  the ai-maestro host (any tailnet browser can register and work remotely). The tailnet boundary
  IS the registration perimeter — no registration from outside it.

**The ASSISTANT is the remote USER's sole surface**
- Each remote USER gets a dedicated agent, titled **ASSISTANT**, created to respond ONLY to that
  USER (this is the auto-provisioning #39 AC4 describes).
- The ASSISTANT **cannot join teams** — ever.
- Visibility/messaging default: the ASSISTANT cannot SEE or MESSAGE any other agent. Exceptions:
  (a) it can ALWAYS message the MANAGER; (b) once the MANAGER approves the USER as a collaborator
  on a project, it can message the agents working that same project.

**Collaboration path (the ONLY one for remote USERs)**
- The MANAGER invites the USER to a project. On approval the ASSISTANT may: share the project's
  `design/` folder with the project's agents; clone the project's GitHub repos (a project may
  span multiple repos); open PRs.
- The project's **MAINTAINER** (delegated by the MANAGER) reviews each ASSISTANT PR and merges or
  refuses with requested fixes. No other write path into project repos exists for remote USERs.
- Independently of any invitation, the USER may use its ASSISTANT to develop its OWN projects in
  isolation.

**Settings and extension boundaries**
- A remote USER has NO access to host settings — only the settings of its own user/account.
- The USER may install extensions and configure its own ASSISTANT freely, EXCEPT: the assistant
  role plugin itself (immutable) and the required core extensions/plugins every agent must carry.
- The ASSISTANT may install/uninstall extensions at its OWN local scope only — never on another
  agent.

**Filesystem containment (ASSISTANT role hooks)**
- Reads AND writes outside the ASSISTANT's workdir are blocked by hooks + ASSISTANT-role-specific
  permission rules. Enumerated exceptions only: designated locally-scoped folders, project-scoped
  folders (for approved collaborations), the assistant's own files, and files needed for the
  collaboration. Host files outside those exceptions are strictly unreadable.

## Relationship to existing artifacts

- Resolves the OPEN half of **ai-maestro#39** (AC4): registration is mandated; auto-provisioning
  is now specifiable (one ASSISTANT per registered remote USER).
- The existing ASSISTANT constraints in R39.x (never a team member, never unblock-targetable per
  R42.8(d), the human-surface rationale) are CONSISTENT with this model and remain in force.
- The R42.8(d) "a USER has no terminal" note gains context: remote USERs interact via browser +
  ASSISTANT chat only — unchanged.
- Governance rule amendments implied by this model (registration perimeter, ASSISTANT visibility
  matrix, MAINTAINER PR-review duty) are NOT made by this card — each lands as its own doc
  change when the corresponding feature ships, citing this card.

## Derived work (to be decomposed before dev — depth-1 NPT/EHT on the implementing cards, not here)

Registration service (tailnet-gated) · per-USER auth/session model · ASSISTANT auto-provisioning
pipeline · ASSISTANT visibility/messaging enforcement (server-side, not just hooks) · ASSISTANT
filesystem hook set · MAINTAINER PR-review workflow wiring · dashboard multi-user surfaces.

## Acceptance

- [x] USER dictation captured verbatim and distilled without invention (this card)
- [ ] ai-maestro#39 updated with the ruling and this card's id
- [ ] Implementation decomposition authored (separate cards; this box ticks when the first
      implementing card cites this one as parent)

## Approval log

- 2026-08-08T10:14:35+0200 — MANDATE recorded: dictated by the USER in-session (AskUserQuestion
  answer, hub session). Pre-approved by authority: issuer is the USER. No approval request sent.
