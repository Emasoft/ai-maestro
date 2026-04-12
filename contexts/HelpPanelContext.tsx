'use client'

/**
 * Help panel context.
 *
 * Owns the open/closed state of the in-app Help Center and renders
 * `HelpPanel` itself so that the panel receives zero props from its
 * caller. This removes the function prop (`onClose: () => void`)
 * that was triggering the Next.js TypeScript plugin warning 71007
 * (`Props must be serializable for components in the "use client" entry
 * file, "onClose" is invalid`) — the plugin scans every client file for
 * destructured function-typed props and flags them, regardless of
 * whether the actual parent is a Server Component or another Client
 * Component. By moving state + actions into context the prop literally
 * stops existing on `HelpPanel`, which is the only way to silence a
 * false-positive rule without using `@ts-ignore`.
 *
 * Mirrors the pattern in `contexts/SudoContext.tsx`: provider owns
 * state, renders the dialog itself, and exposes action hooks to
 * consumers via `useHelpPanel()`.
 *
 * USAGE (in any client component inside the provider tree):
 *
 *   const { open } = useHelpPanel()
 *   <button onClick={open}>Help</button>
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'

// HelpPanel is heavy (tutorials, icons, optional chat). Keep it code-split
// so it only loads when the panel is actually opened.
const HelpPanel = dynamic(() => import('@/components/HelpPanel'), { ssr: false })

interface HelpPanelContextValue {
  /** Whether the help panel is currently open. */
  isOpen: boolean
  /** Open the help panel. */
  open: () => void
  /** Close the help panel. */
  close: () => void
}

const HelpPanelContext = createContext<HelpPanelContextValue | null>(null)

interface HelpPanelProviderProps {
  children: ReactNode
}

export function HelpPanelProvider({ children }: HelpPanelProviderProps) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  // Memoize the context value so consumers only re-render when isOpen flips.
  const value = useMemo<HelpPanelContextValue>(
    () => ({ isOpen, open, close }),
    [isOpen, open, close],
  )

  return (
    <HelpPanelContext.Provider value={value}>
      {children}
      {/*
        The panel is rendered by the provider, not by consumers. This
        keeps the boundary clean: HelpPanel reads its state/actions from
        context and takes zero props. Rendering it unconditionally is
        fine because `HelpPanel` internally short-circuits when `isOpen`
        is false (animation classes collapse it to a hidden state).
      */}
      <HelpPanel />
    </HelpPanelContext.Provider>
  )
}

/**
 * Consumer hook. Must be called inside a `HelpPanelProvider` subtree.
 * Throws at runtime if used outside the provider, which is the standard
 * React-context contract (catches missing-provider bugs at first touch
 * instead of degrading silently).
 */
export function useHelpPanel(): HelpPanelContextValue {
  const ctx = useContext(HelpPanelContext)
  if (!ctx) {
    throw new Error('useHelpPanel must be used inside a <HelpPanelProvider>')
  }
  return ctx
}
