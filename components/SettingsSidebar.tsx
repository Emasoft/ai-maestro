'use client'

import { Server, HelpCircle, Info, Compass, FlaskConical, Webhook, Globe, Store, Puzzle, Bot, TerminalSquare, Archive, Shield, Activity } from 'lucide-react'

type SectionId = 'security' | 'hosts' | 'domains' | 'webhooks' | 'help' | 'about' | 'onboarding' | 'experiments' | 'marketplace' | 'global-elements' | 'agents' | 'commands' | 'cemetery' | 'diagnostics'

interface SettingsSidebarProps {
  activeSection: SectionId
  onSectionChange: (section: SectionId) => void
}

export default function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const sections = [
    {
      id: 'security' as const,
      label: 'Security',
      icon: Shield,
      description: 'Auth, encryption & policies',
    },
    {
      id: 'hosts' as const,
      label: 'Hosts',
      icon: Server,
      description: 'Manage remote workers',
    },
    {
      id: 'domains' as const,
      label: 'Domains',
      icon: Globe,
      description: 'Email domains',
    },
    {
      id: 'webhooks' as const,
      label: 'Webhooks',
      icon: Webhook,
      description: 'Event subscriptions',
    },
    {
      id: 'marketplace' as const,
      label: 'Skills',
      icon: Store,
      description: 'Browse & convert skills per client',
    },
    {
      id: 'agents' as const,
      label: 'Agents',
      icon: Bot,
      description: 'Browse agents per client',
    },
    {
      id: 'commands' as const,
      label: 'Commands',
      icon: TerminalSquare,
      description: 'Slash commands per client',
    },
    {
      id: 'global-elements' as const,
      label: 'Plugins',
      icon: Puzzle,
      description: 'Plugins & marketplaces',
    },
    {
      id: 'cemetery' as const,
      label: 'Cemetery',
      icon: Archive,
      description: 'Revive deleted agents',
    },
    {
      // #234 (2026-04-20): Ledger-health diagnostics panel. Fits here
      // between Cemetery and Experiments because it's an operator-
      // visibility tool sitting right next to the other "inspect the
      // system" entries (Cemetery + Hosts + Plugins).
      id: 'diagnostics' as const,
      label: 'Diagnostics',
      icon: Activity,
      description: 'Ledger health + integrity',
    },
    {
      id: 'experiments' as const,
      label: 'Experiments',
      icon: FlaskConical,
      description: 'Try new features',
    },
    {
      id: 'onboarding' as const,
      label: 'Onboarding',
      icon: Compass,
      description: 'Getting started guide',
    },
    {
      id: 'help' as const,
      label: 'Help',
      icon: HelpCircle,
      description: 'Documentation & guides',
    },
    {
      id: 'about' as const,
      label: 'About',
      icon: Info,
      description: 'Version & info',
    },
  ]

  return (
    <div className="w-64 border-r border-gray-800 bg-gray-900/50 flex flex-col min-h-0">
      <div className="p-4 pb-2 flex-shrink-0">
        <h2 className="text-lg font-semibold text-white mb-1 px-2">Settings</h2>
        <p className="text-xs text-gray-400 px-2">Configure AI Maestro</p>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 px-4 pb-4">
        {sections.map((section) => {
          const Icon = section.icon
          const isActive = activeSection === section.id

          return (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
              <div className="flex-1 text-left">
                <div className={`font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>
                  {section.label}
                </div>
                <div className={`text-xs ${isActive ? 'text-blue-100' : 'text-gray-500'}`}>
                  {section.description}
                </div>
              </div>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
