'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SettingsSidebar from '@/components/SettingsSidebar'
import HostsSection from '@/components/settings/HostsSection'
import DomainsSection from '@/components/settings/DomainsSection'
import WebhooksSection from '@/components/settings/WebhooksSection'
import HelpSection from '@/components/settings/HelpSection'
import AboutSection from '@/components/settings/AboutSection'
import OnboardingSection from '@/components/settings/OnboardingSection'
import ExperimentsSection from '@/components/settings/ExperimentsSection'
// MarketplaceSection removed: the 'marketplace' tab now renders SkillsSection
// (renamed in the UI). The marketplace LIST (registered marketplaces + plugins)
// lives inside GlobalElementsSection → 'Marketplaces' subtab.
import SkillsSection from '@/components/settings/SkillsSection'
import AgentsSection from '@/components/settings/AgentsSection'
import CommandsSection from '@/components/settings/CommandsSection'
import GlobalElementsSection from '@/components/settings/GlobalElementsSection'
import CemeterySection from '@/components/settings/CemeterySection'
import SecuritySection from '@/components/settings/SecuritySection'
import DiagnosticsSection from '@/components/settings/DiagnosticsSection'
import PluginUpdatesSection from '@/components/settings/PluginUpdatesSection'
import { VersionChecker } from '@/components/VersionChecker'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-gray-950 text-gray-500">Loading settings…</div>}>
      <SettingsPageInner />
    </Suspense>
  )
}

function SettingsPageInner() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeSection, setActiveSection] = useState<'security' | 'hosts' | 'domains' | 'webhooks' | 'help' | 'about' | 'onboarding' | 'experiments' | 'marketplace' | 'global-elements' | 'agents' | 'commands' | 'cemetery' | 'diagnostics' | 'plugin-updates'>('hosts')
  // Navigate to section from URL params (e.g. /settings?tab=global-elements
  // or the post-rename /settings?tab=extensions alias). The internal state
  // key remains `global-elements` — the UI label changed to "Extensions"
  // (2026-04-22), but renaming the route/state key would break every
  // bookmark, scenario URL, doc link, and stored URL in the wild. The alias
  // below is the user-visible rename; the internal key is a stability
  // invariant.
  useEffect(() => {
    const validTabs = ['security', 'hosts', 'domains', 'webhooks', 'help', 'about', 'onboarding', 'experiments', 'marketplace', 'global-elements', 'agents', 'commands', 'cemetery', 'diagnostics', 'plugin-updates'] as const
    const extensionsAlias = 'extensions'
    if (tabParam === extensionsAlias) {
      setActiveSection('global-elements')
      return
    }
    if (tabParam && (validTabs as readonly string[]).includes(tabParam)) {
      setActiveSection(tabParam as typeof validTabs[number])
    }
  }, [tabParam])

  return (
      <div className="flex flex-col h-screen bg-gray-950 text-white">
        {/* Header Navigation */}
        <div className="border-b border-gray-800 bg-gray-900/50 backdrop-blur flex-shrink-0">
          <div className="px-6 py-4 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
            {activeSection === 'security' && <SecuritySection />}
            {activeSection === 'hosts' && <HostsSection />}
            {activeSection === 'domains' && <DomainsSection />}
            {activeSection === 'webhooks' && <WebhooksSection />}
            {activeSection === 'marketplace' && <SkillsSection initialClient={(searchParams.get('client') as import('@/lib/converter/types').ProviderId) || 'claude-code'} />}
            {activeSection === 'agents' && <AgentsSection initialClient={(searchParams.get('client') as import('@/lib/converter/types').ProviderId) || 'claude-code'} />}
            {activeSection === 'commands' && <CommandsSection initialClient={(searchParams.get('client') as import('@/lib/converter/types').ProviderId) || 'claude-code'} />}
            {activeSection === 'global-elements' && <GlobalElementsSection initialSubtab={searchParams.get('subtab') as 'plugins' | 'elements' | 'marketplaces' | null} initialMarketplace={searchParams.get('marketplace')} />}
            {activeSection === 'cemetery' && <CemeterySection />}
            {activeSection === 'diagnostics' && <div className="p-6 max-w-4xl"><DiagnosticsSection /></div>}
            {activeSection === 'plugin-updates' && <PluginUpdatesSection />}
            {activeSection === 'experiments' && <ExperimentsSection />}
            {activeSection === 'onboarding' && <OnboardingSection />}
            {activeSection === 'help' && <HelpSection />}
            {activeSection === 'about' && <AboutSection />}
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-gray-800 bg-gray-950 px-4 py-2 flex-shrink-0">
          <div className="flex flex-col md:flex-row justify-between items-center gap-1 md:gap-0 md:h-5">
            <p className="text-xs md:text-sm text-white leading-none">
              <VersionChecker /> • Made with <span className="text-red-500 text-lg inline-block scale-x-125">♥</span> in Boulder Colorado
            </p>
            <p className="text-xs md:text-sm text-white leading-none">
              Concept by{' '}
              <a
                href="https://x.com/jkpelaez"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 transition-colors"
              >
                Juan Peláez
              </a>{' '}
              @{' '}
              <a
                href="https://23blocks.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-red-500 hover:text-red-400 transition-colors"
              >
                23blocks
              </a>
              . Coded by Claude
            </p>
          </div>
        </footer>
      </div>
  )
}
