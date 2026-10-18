// Standalone app-owned memory writer entry; invoked by agents using the path in their launch instructions.
import { command } from '../cli.mjs';
try { console.log(JSON.stringify(command(process.argv.slice(2)))); }
catch (error) { console.error(error instanceof Error ? error.message : 'Product memory command failed.'); process.exitCode = 1; }
