// The Grindhouse (page id 'home') is the one place for the agents, beside the persistent Orchestrator (SPEC 19): only
// the strips of the agents at work (components/AgentStrips.tsx), grouped and ordered by the Orchestrator
// (lib/agent-order.ts: by area, start order inside a group; never by the user). Brother, 18/10: «le striscioline devono
// essere il cuore della grindhouse nessun altra informazione»: no greeting, no headline (it is the Dashboard's, SPEC 18),
// no counts, no "Aspetta te" list; a decision waiting shows as a pill on its own strip (ChatTile.tsx).
import { AgentStrips, AgentStripsActions } from '../../components/AgentStrips';
import './home.css';

export function Home(_: { nav: (target: string) => void }) {
  return <div className="home-page" data-testid="home">
    <AgentStripsActions />
    <AgentStrips />
  </div>;
}
