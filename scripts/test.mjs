// Roda node --test a partir da raiz do projeto. O npm do Windows, num
// workspace WSL, muda o cwd para C:\Windows (cmd.exe nao aceita UNC).
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function projectRoot() {
  const fromNpm = process.env.npm_config_local_prefix || process.env.INIT_CWD;
  const raw = fromNpm || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return raw.replaceAll('\\', '/');
}

const root = projectRoot();
const files = (await readdir(`${root}/test`))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `test/${name}`);

if (files.length === 0) {
  console.error('nenhum arquivo *.test.mjs em test/');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
