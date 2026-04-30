'use client'

/**
 * ClientSection — Config-tab Program (AI client) selector.
 *
 * SCEN-016.02 + 016.03 (2026-04-30): the Program field used to live on the
 * Overview tab as a free-text EditableField. It moved here because:
 *   1. It is a configuration concern, not a "work setting" — it dictates
 *      which client binary the agent runs and which plugin formats are
 *      used.
 *   2. Changing it triggers the R18 ChangeClient pipeline (services/
 *      element-management-service.ts:ChangeClient), which uninstalls and
 *      re-emits every plugin in the new client's format. That is heavy
 *      filesystem work — users must understand what they are about to do.
 *
 * Two pre-flight gates protect the user before the R18 pipeline starts:
 *   - A typed dropdown sourced from SUPPORTED_CLIENTS so typos cannot
 *     produce an unsupported program string (R18.3d would have to abort
 *     with no native source available — a confusing UX).
 *   - A confirm dialog explaining "all plugins will be reinstalled in
 *     the new client format". After the user confirms here, the strict-
 *     route PATCH still triggers the sudo-mode password modal (Rule 12)
 *     before the pipeline actually runs.
 */

import { useState } from 'react'
import { Briefcase, AlertTriangle } from 'lucide-react'
import {
  SUPPORTED_CLIENTS,
  detectClientType,
  clientTypeLabel,
  type ClientType,
} from '@/lib/client-capabilities'

interface ClientSectionProps {
  /** Current program value from the agent registry (e.g. 'claude', 'codex') */
  currentProgram: string | undefined
  /** Number of plugins currently installed (shown in confirm dialog so the
   *  user knows the scope of the re-emission). Pass 0 if unknown — the
   *  dialog still fires but the count line is omitted. */
  pluginCount: number
  /** Called when the user confirms the change. Must trigger PATCH /api/
   *  agents/{id} { program } via sudoFetch (the strict-route handler runs
   *  ChangeClient internally). Receives the new ClientType. */
  onChange: (newClient: ClientType) => Promise<void>
  /** Disabled while a save is in flight or while the agent is currently
   *  running its program (changing client mid-session would orphan the
   *  tmux pane). */
  disabled?: boolean
}

export default function ClientSection({
  currentProgram,
  pluginCount,
  onChange,
  disabled,
}: ClientSectionProps) {
  const currentType = detectClientType(currentProgram || '')
  const [pendingClient, setPendingClient] = useState<ClientType | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as ClientType
    if (next === currentType || saving) return
    // Show confirm dialog before triggering R18 pipeline.
    setPendingClient(next)
  }

  const cancelChange = () => {
    setPendingClient(null)
  }

  const confirmChange = async () => {
    if (!pendingClient) return
    setSaving(true)
    try {
      await onChange(pendingClient)
    } finally {
      // Whether onChange resolved or threw, close the dialog so the user is
      // not stuck. The parent surfaces success/failure via toast/refetch.
      setSaving(false)
      setPendingClient(null)
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="agent-program-select"
        className="text-xs font-medium text-gray-400 flex items-center gap-2"
      >
        <Briefcase className="w-4 h-4" />
        Program
      </label>
      <select
        id="agent-program-select"
        value={currentType === 'unknown' || currentType === 'aider' ? '' : currentType}
        onChange={handleSelect}
        disabled={disabled || saving}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {/* Empty option lets the user see "no client selected" for unknown/
            aider state. They cannot select it back — only the supported
            clients are pickable. */}
        {(currentType === 'unknown' || currentType === 'aider') && (
          <option value="" disabled>
            {currentProgram
              ? `Unknown: ${currentProgram}`
              : 'No program set'}
          </option>
        )}
        {SUPPORTED_CLIENTS.map(c => (
          <option key={c} value={c}>
            {clientTypeLabel(c)}
          </option>
        ))}
      </select>
      <p className="text-[10px] text-gray-600">
        Changing this re-installs all plugins in the new client&rsquo;s format
        and requires the agent to be relaunched.
      </p>

      {/* Confirm dialog — pre-flight gate before sudo modal + R18 pipeline */}
      {pendingClient && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={cancelChange}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-100">
                  Change AI Client?
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Switching from{' '}
                  <span className="font-mono text-gray-200">
                    {clientTypeLabel(currentType)}
                  </span>{' '}
                  to{' '}
                  <span className="font-mono text-gray-200">
                    {clientTypeLabel(pendingClient)}
                  </span>{' '}
                  will:
                </p>
                <ul className="mt-2 space-y-1 text-xs text-gray-400 list-disc list-inside">
                  {pluginCount > 0 && (
                    <li>
                      Re-install <strong>{pluginCount} plugin{pluginCount === 1 ? '' : 's'}</strong>{' '}
                      in the new client&rsquo;s format (R18 conversion pipeline)
                    </li>
                  )}
                  <li>Remove the current client&rsquo;s install files</li>
                  <li>Mark the agent as needing a session relaunch</li>
                </ul>
                <p className="mt-2 text-[10px] text-amber-400/90">
                  You will be asked to re-enter the governance password.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-800">
              <button
                type="button"
                onClick={cancelChange}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-gray-100 rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmChange}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
