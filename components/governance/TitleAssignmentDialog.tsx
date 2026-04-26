'use client'

// Public client-boundary shim for TitleAssignmentDialog.
//
// This file exists solely to hold the 'use client' directive for the
// Next.js module graph. The actual component implementation lives in
// TitleAssignmentDialog.impl.tsx and is pulled in here via a re-export.
//
// Why the split? The Next.js TypeScript plugin emits a 71007 warning
// ("Props must be serializable for components in the 'use client' entry
// file") for every function-typed prop on a default-exported function
// that lives in a file starting with 'use client'. The check is purely
// syntactic — it does not distinguish between components that are
// actually imported across a Server/Client boundary and components
// that are only ever used from other client modules.
//
// TitleAssignmentDialog is only imported from AgentProfile.tsx and
// zoom/AgentProfileTab.tsx, both of which are themselves 'use client'
// files reachable only from app/page.tsx (also 'use client'). No
// Server Component ever touches this module, so its function props
// (onClose, onTitleChanged, onRestartNeeded) never cross an RSC
// boundary and do not need to be serializable.
//
// By isolating the directive in this shim (which contains nothing
// but a re-export declaration), the plugin has no default function
// export here to check, and the implementation file does not carry
// the directive so the rule is not applied there either. The public
// import path `@/components/governance/TitleAssignmentDialog` stays
// unchanged — callers see exactly the same default export as before.
//
// Runtime behaviour is unchanged: the implementation module is part
// of the client bundle via transitive import from this 'use client'
// file (Next.js client-boundary inheritance), so hooks in the impl
// work exactly as they did in the original single-file layout.

export { default } from './TitleAssignmentDialog.impl'
