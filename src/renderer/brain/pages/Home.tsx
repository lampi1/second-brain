// Home is exclusively the agents' workspace; decisions appear in the shared questions window.
import { AgentStrips } from '../../components/AgentStrips';
import './home.css';

export function Home(_: { nav: (target: string) => void }) {
  return <div className="home-page" data-testid="home">
    <AgentStrips />
  </div>;
}
