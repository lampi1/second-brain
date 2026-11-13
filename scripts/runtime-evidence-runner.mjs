// Detached diagnostic command runner: preserve stdout, stderr and the child's own exit code for overnight checks.
// Call with an existing evidence directory, label, executable and arguments; never installs dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const [folder, label, command, ...args] = process.argv.slice(2);
if (!fs.statSync(folder).isDirectory() || !/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid evidence destination');
const stdout = fs.openSync(path.join(folder, `${label}.stdout.log`), 'w');
const stderr = fs.openSync(path.join(folder, `${label}.stderr.log`), 'w');
const child = spawn(command, args, { stdio: ['ignore', stdout, stderr], windowsHide: true });
child.on('error', error => { fs.writeFileSync(path.join(folder, `${label}.exit.json`), JSON.stringify({ error: error.message, code: null })); process.exitCode = 1; });
child.on('exit', (code, signal) => { fs.writeFileSync(path.join(folder, `${label}.exit.json`), JSON.stringify({ code, signal })); process.exitCode = code ?? 1; });
