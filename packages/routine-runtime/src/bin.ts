// The entry of the `routine` command (ADR 0175): bundled to dist/routine.mjs by the package's build, beside
// dist/routine-mcp.mjs (the runtime's MCP servers). All the logic is in cli.ts `main`, which the unit tests call.
import { main } from './cli';

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
