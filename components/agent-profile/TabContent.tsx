'use client'

import type { AgentLocalConfig } from '@/types/agent-local-config'
import { ExpandableElementCard, ListTab, type TabId, type AgentInfo } from './shared'
import RoleTab from './RoleTab'
import PluginsTab from './PluginsTab'
import McpTab from './McpTab'
import MarketplacesTab from './MarketplacesTab'

export default function TabContent({
  tab,
  config,
  agentId,
  agentInfo,
  onEditInHaephestos,
  onBrowse,
  onRefresh,
  onSwitchTab,
}: {
  tab: TabId
  config: AgentLocalConfig
  agentId: string
  agentInfo?: AgentInfo
  onEditInHaephestos?: (profilePath: string) => void
  onBrowse?: (path: string) => void
  onRefresh?: () => void
  onSwitchTab?: (tab: TabId) => void
}) {
  // Clicking "plugin: xxx" badge switches to the Plugins tab
  const handlePluginClick = onSwitchTab ? () => onSwitchTab('plugins') : undefined
  const rpName = config.rolePlugin?.name
  switch (tab) {
    case 'role': return <RoleTab config={config} agentId={agentId} agentTitle={agentInfo?.title} agentClient={agentInfo?.program} onEditInHaephestos={onEditInHaephestos} onBrowse={onBrowse} onRefresh={onRefresh} />
    case 'plugins': return <PluginsTab config={config} agentId={agentId} onSwitchTab={onSwitchTab} onRefresh={onRefresh} />
    case 'marketplaces': return (
      <MarketplacesTab
        workingDirectory={config.workingDirectory}
        installedPluginNames={new Set(config.plugins.map(p => p.name))}
        onRefresh={onRefresh}
      />
    )
    case 'skills': return (
      <ListTab
        items={config.skills}
        emptyText="No skills installed"
        emptyHint="Add skills to .claude/skills/ or install a plugin that bundles them."
        filterBy={(s) => [s.name, s.description, s.sourcePlugin]}
        filterPlaceholder={`Filter ${config.skills.length} skill${config.skills.length === 1 ? '' : 's'}…`}
        renderItem={(s) => (
          <ExpandableElementCard key={s.name} name={s.name} elementType="skill" detail={s.description} sourcePlugin={s.sourcePlugin} path={s.path} agentId={agentId} onRemoved={onRefresh} onPluginClick={handlePluginClick} rolePluginName={rpName} />
        )}
      />
    )
    case 'agents': return (
      <ListTab
        items={config.agents}
        emptyText="No subagents defined"
        emptyHint="Add agent .md files to .claude/agents/ or install a plugin."
        filterBy={(a) => [a.name, a.description, a.sourcePlugin]}
        filterPlaceholder={`Filter ${config.agents.length} subagent${config.agents.length === 1 ? '' : 's'}…`}
        renderItem={(a) => (
          <ExpandableElementCard key={a.name} name={a.name} elementType="agent" detail={a.description} sourcePlugin={a.sourcePlugin} path={a.path} agentId={agentId} onRemoved={onRefresh} onPluginClick={handlePluginClick} rolePluginName={rpName} />
        )}
      />
    )
    case 'hooks': return (
      <ListTab
        items={config.hooks}
        emptyText="No hooks installed"
        emptyHint="Hooks are defined in settings.json or plugin hooks.json."
        filterBy={(h) => [h.name, h.eventType, h.matcher, h.sourcePlugin, h.command]}
        filterPlaceholder={`Filter ${config.hooks.length} hook${config.hooks.length === 1 ? '' : 's'}…`}
        renderItem={(h) => {
        const metadata: Record<string, string> = {}
        if (h.eventType) metadata['event'] = h.eventType
        if (h.matcher) metadata['matcher'] = h.matcher
        if (h.hookType) metadata['type'] = h.hookType
        if (typeof h.timeout === 'number') metadata['timeout'] = `${h.timeout}s`
        const detailLine = h.eventType
          ? `${h.eventType}${h.matcher ? ` · ${h.matcher}` : ''}`
          : undefined
        return (
          <ExpandableElementCard
            key={`${h.sourcePlugin || 'standalone'}::${h.name}`}
            name={h.name}
            elementType="hook"
            detail={detailLine}
            sourcePlugin={h.sourcePlugin}
            path={h.path}
            metadata={Object.keys(metadata).length > 0 ? metadata : undefined}
            jsonContent={h.command}
            onPluginClick={handlePluginClick}
            rolePluginName={rpName}
          />
        )
      }} />
    )
    case 'rules': return (
      <ListTab
        items={config.rules}
        emptyText="No rules installed"
        emptyHint="Add rule .md files to .claude/rules/ or install a plugin."
        filterBy={(r) => [r.name, r.preview, r.sourcePlugin]}
        filterPlaceholder={`Filter ${config.rules.length} rule${config.rules.length === 1 ? '' : 's'}…`}
        renderItem={(r) => (
          <ExpandableElementCard key={r.name} name={r.name} elementType="rule" detail={r.preview} sourcePlugin={r.sourcePlugin} path={r.path} agentId={agentId} onRemoved={onRefresh} onPluginClick={handlePluginClick} rolePluginName={rpName} />
        )}
      />
    )
    case 'commands': return (
      <ListTab
        items={config.commands}
        emptyText="No commands installed"
        emptyHint="Add command .md files to .claude/commands/ for /slash commands."
        filterBy={(c) => [c.name, c.trigger, c.sourcePlugin]}
        filterPlaceholder={`Filter ${config.commands.length} command${config.commands.length === 1 ? '' : 's'}…`}
        renderItem={(c) => (
          <ExpandableElementCard key={c.name} name={c.name} elementType="command" detail={c.trigger} sourcePlugin={c.sourcePlugin} path={c.path} agentId={agentId} onRemoved={onRefresh} onPluginClick={handlePluginClick} rolePluginName={rpName} />
        )}
      />
    )
    case 'mcps': return <McpTab config={config} agentId={agentId} onRefresh={onRefresh} />
    case 'outputStyles': return (
      <ListTab
        items={config.outputStyles}
        emptyText="No output styles"
        emptyHint="Add output style files to .claude/output-styles/ or install a plugin."
        filterBy={(o) => [o.name, o.sourcePlugin]}
        filterPlaceholder={`Filter ${config.outputStyles.length} style${config.outputStyles.length === 1 ? '' : 's'}…`}
        renderItem={(o) => (
          <ExpandableElementCard key={o.name} name={o.name} elementType="outputStyle" sourcePlugin={o.sourcePlugin} path={o.path} agentId={agentId} onRemoved={onRefresh} onPluginClick={handlePluginClick} rolePluginName={rpName} />
        )}
      />
    )
  }
}
