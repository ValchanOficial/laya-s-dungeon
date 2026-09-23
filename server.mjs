// Servidor do Calabouco do Laya: serve o jogo e expoe as decisoes do modelo.
// Sem dependencias de framework — so node:http e o ONNX Runtime por baixo.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from './src/laya-agent.mjs';
import { decide, loadCalibration, validateState } from './src/decision.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const MODEL_DIR = process.env.LAYA_MODEL ?? path.join(ROOT, 'model-en');
const DEVICE = process.env.LAYA_DEVICE ?? 'cpu';

console.log(`[laya] carregando checkpoint de ${MODEL_DIR} (${DEVICE})...`);
const loadStart = Date.now();
const { agent, cfg } = await loadAgent(MODEL_DIR, { device: DEVICE });
const modelName = cfg.model_name ?? 'laya';
console.log(`[laya] ${modelName} pronto em ${Date.now() - loadStart} ms`);

const calibration = await loadCalibration(ROOT);
console.log(
  calibration
    ? `[laya] calibracao aplicada (${Object.keys(calibration.signals).join(', ')}), ajustada em ${calibration.fittedOn} amostras`
    : '[laya] sem calibration.json: probabilidades cruas (rode npm run calibrate)',
);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('corpo da requisicao grande demais');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Uma inferencia por vez: a sessao ONNX e compartilhada e o jogo pede
// uma decisao por turno.
let queue = Promise.resolve();
function serialize(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/src/loot.mjs': ['src/loot.mjs', 'text/javascript; charset=utf-8'],
  '/src/level.mjs': ['src/level.mjs', 'text/javascript; charset=utf-8'],
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, model: modelName, device: DEVICE });
  }

  if (req.method === 'POST' && url.pathname === '/api/decide') {
    try {
      const state = await readJsonBody(req);
      const invalid = validateState(state);
      if (invalid) return json(res, 400, { error: invalid });
      const decision = await serialize(() => decide(agent, state));
      return json(res, 200, { ...decision, model: modelName, device: DEVICE });
    } catch (err) {
      console.error('[laya] falha na decisao:', err);
      return json(res, 500, { error: String(err?.message ?? err) });
    }
  }

  const entry = STATIC[url.pathname];
  if (req.method === 'GET' && entry) {
    const [file, type] = entry;
    const body = await readFile(path.join(ROOT, file));
    res.writeHead(200, { 'content-type': type });
    return res.end(body);
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('nao encontrado');
});

server.listen(PORT, () => {
  console.log(`[laya] calabouco aberto em http://localhost:${PORT}`);
});
