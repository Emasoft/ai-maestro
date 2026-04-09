import { redirect } from 'next/navigation'

/**
 * /agent-creation now redirects to the main dashboard.
 * Haephestos is integrated directly into the dashboard as an embedded view.
 * The URL ?agent=haephestos tells the dashboard to select the Haephestos agent.
 */
export default function AgentCreationRedirect() {
  redirect('/?agent=haephestos')
}
