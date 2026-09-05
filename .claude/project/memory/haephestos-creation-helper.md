---
name: haephestos-creation-helper
description: "haephestos creation-helper remembers a previous session / --continue crept into the helper launch args / creation-helper cleanup route left files behind / unit test wrote to the real ~agents/haephestos directory / yarn test rewrote my haephestos settings.local.json / unexpected file appeared under ~/agents/haephestos/uploads / how are haephestos launch args built / raw.txt uploaded during a test landed in the real uploads folder / file-picker route pins homedir at module load / ensure-persona route always overwrites settings.local.json / vi.stubEnv HOME did not stop a test from writing real files / test containment defect in creation-helper wizard test / why did plain yarn test touch my real agent folder"
ocd: 2026-09-05
lmd: 2026-09-05
publish-globally: false
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: agents
---

# haephestos-creation-helper


^ATOM-ELBV-JH2R [desc: "haephestos launch args are a pure exported builder pinning --agent + no --continue", keywords: haephestos creation-helper --continue launch_args buildHaephestosLaunchArgs agent_flag tmux_launch remembers_previous_session session_continuity_bug creation-helper-service TRDD-E5AAE555 TRDD-66KNYSXY, ocd: 2026-09-05, lmd: 2026-09-05]

The Haephestos creation-helper's launch args are now a pure exported function, buildHaephestosLaunchArgs() in services/creation-helper-service.ts, with exactly one call site. This pins the two invariants that used to drift: launch always passes --agent haephestos-creation-helper, and it never passes --continue (the helper must not remember a previous session's context). tests/haephestos-launch.test.ts asserts both invariants directly on the exported builder, with no tmux spawn needed. Landed in commit 3f41f718 under TRDD-E5AAE555 (child TRDD-66KNYSXY).


^ATOM-3UG6-8D0T [desc: "yarn test writes real ~/agents/haephestos because UPLOAD_DIR/homedir is pinned at module load", keywords: test_containment writes_to_real_HOME UPLOAD_DIR_homedir_module_load vi.stubEnv_cannot_reach_module_constant ensure-persona_overwrites_settings.local.json file-picker_route creation-helper-wizard-system-owner_test yarn_test_rewrote_my_haephestos unexpected_uploads_folder_file TRDD-3AUQ2CL9 module-load_constant_not_injectable, trdd: TRDD-3AUQ2CL9, ocd: 2026-09-05, lmd: 2026-09-05]

A running yarn test rewrites the developer's REAL ~/agents/haephestos directory. app/api/agents/creation-helper/file-picker/route.ts pins UPLOAD_DIR from homedir() at MODULE LOAD, so vi.stubEnv('HOME', tmp) cannot redirect it once the module is loaded — and ensure-persona/route.ts unconditionally overwrites settings.local.json on every call. tests/unit/creation-helper-wizard-system-owner.test.ts uploads a 1-byte raw.txt through the file-picker route, so a plain yarn test run measurably recreated settings.local.json, uploads/<id>-raw.txt and toml/ under the real ~/agents/haephestos (observed 20:02:02). Filed as TRDD-3AUQ2CL9, commits fc5c8b8e and 16f2b024 (not yet fixed at module-load time; needs the constant made injectable or the route parameterized).

## Notes and lessons learned
