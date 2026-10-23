// Developer home: persistent work overview above the agent strips; the Orchestrator remains beside every page.
import { WorkCockpit } from '../../components/WorkCockpit';
import { AgentStrips, AgentStripsActions } from '../../components/AgentStrips';
import { CloudStrips } from '../../components/CloudStrips';
import './home.css';

export function Home(_: { nav: (target: string) => void }) {
  return <div className="home-page" data-testid="home">
    <WorkCockpit />
    <AgentStripsActions />
    <AgentStrips />
    <CloudStrips />
  </div>;
}
