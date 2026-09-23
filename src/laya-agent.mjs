// Carrega um checkpoint Laya exportado em ONNX split (encoder.onnx + head.onnx)
// e devolve um Agent do laya-ts pronto para predict().
//
// O provider embutido do laya-ts espera a entrada da cabeca chamada
// "hidden_states"; exports da comunidade costumam chama-la "hidden". Aqui os
// nomes sao resolvidos a partir do proprio grafo, entao os dois layouts servem.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ort from 'onnxruntime-node';
import {
  Agent,
  defaultTokenizer,
  encodeWithData,
  parseTokenizerJson,
} from '../vendor/laya-ts/index.js';

function int64(rows, dims) {
  const flat = rows.flat(Infinity).map((v) => BigInt(Math.trunc(v)));
  return new ort.Tensor('int64', BigInt64Array.from(flat), dims);
}

function toRows(tensor) {
  const [n, k] = tensor.dims;
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(Array.from(tensor.data.slice(i * k, (i + 1) * k), Number));
  }
  return rows;
}

// Export de grafo unico (input_ids/attention_mask/marker_* /qtype -> logits):
// o encoder vira um repasse e toda a inferencia acontece em runHead.
async function createFusedProvider(modelFile, device) {
  const session = await ort.InferenceSession.create(modelFile, {
    executionProviders: [device],
  });
  const actOut =
    session.outputNames.find((n) => /act/.test(n)) ?? session.outputNames[1];
  const qtypeRank =
    session.inputMetadata?.find((m) => m.name === 'qtype')?.shape?.length ?? 1;

  return {
    async runEncoder(batch) {
      return { lastHidden: batch };
    },

    async runHead(_hidden, batch) {
      const n = batch.inputIds.length;
      const len = Math.max(1, ...batch.inputIds.map((r) => r.length));
      const k = Math.max(1, ...batch.markerPos.map((r) => r.length));
      const out = await session.run({
        input_ids: int64(batch.inputIds, [n, len]),
        attention_mask: int64(batch.attentionMask, [n, len]),
        marker_pos: int64(batch.markerPos, [n, k]),
        marker_mask: new ort.Tensor(
          'bool',
          Uint8Array.from(batch.markerMask.flat().map((v) => (v ? 1 : 0))),
          [n, k],
        ),
        qtype:
          qtypeRank === 1
            ? int64(batch.qtype, [n])
            : int64(
                batch.qtype.map((v) => [v]),
                [n, 1],
              ),
      });
      return { logits: toRows(out.logits), act: toRows(out[actOut]) };
    },
  };
}

async function createSplitProvider(modelDir, device) {
  const encoder = await ort.InferenceSession.create(
    path.join(modelDir, 'encoder.onnx'),
    { executionProviders: [device] },
  );
  const head = await ort.InferenceSession.create(
    path.join(modelDir, 'head.onnx'),
    { executionProviders: ['cpu'] },
  );

  const hiddenIn = head.inputNames.includes('hidden_states')
    ? 'hidden_states'
    : 'hidden';
  const hiddenOut =
    encoder.outputNames.find((n) => /hidden/.test(n)) ?? encoder.outputNames[0];
  const actOut =
    head.outputNames.find((n) => /act/.test(n)) ?? head.outputNames[1];
  // Alguns exports declaram qtype como [b] e outros como [b, 1].
  const qtypeRank =
    head.inputMetadata?.find((m) => m.name === 'qtype')?.shape?.length ?? 2;
  let headIsRowwise = false;

  return {
    async runEncoder(batch) {
      const n = batch.inputIds.length;
      const len = Math.max(1, ...batch.inputIds.map((r) => r.length));
      const out = await encoder.run({
        input_ids: int64(batch.inputIds, [n, len]),
        attention_mask: int64(batch.attentionMask, [n, len]),
      });
      // O laya-ts trata este valor como opaco, entao o tensor passa direto
      // para a cabeca sem virar array aninhado no caminho.
      return { lastHidden: out[hiddenOut] };
    },

    async runHead(hidden, batch) {
      const n = batch.markerPos.length;
      const k = Math.max(1, ...batch.markerPos.map((r) => r.length));
      const seqLen = hidden.dims[1];
      const width = hidden.dims[2];
      const mask = batch.attentionMask.map((row) => {
        const trimmed = row.slice(0, seqLen);
        while (trimmed.length < seqLen) trimmed.push(0);
        return trimmed;
      });

      const feeds = (rows) => ({
        [hiddenIn]: new ort.Tensor(
          'float32',
          hidden.data.subarray(
            rows[0] * seqLen * width,
            (rows[rows.length - 1] + 1) * seqLen * width,
          ),
          [rows.length, seqLen, width],
        ),
        marker_pos: int64(
          rows.map((r) => batch.markerPos[r]),
          [rows.length, k],
        ),
        marker_mask: new ort.Tensor(
          'bool',
          Uint8Array.from(
            rows.flatMap((r) => batch.markerMask[r].map((v) => (v ? 1 : 0))),
          ),
          [rows.length, k],
        ),
        qtype:
          qtypeRank === 1
            ? int64(
                rows.map((r) => batch.qtype[r]),
                [rows.length],
              )
            : int64(
                rows.map((r) => [batch.qtype[r]]),
                [rows.length, 1],
              ),
        attention_mask: int64(
          rows.map((r) => mask[r]),
          [rows.length, seqLen],
        ),
      });

      const all = [...batch.markerPos.keys()];
      if (!headIsRowwise && n > 1) {
        try {
          const out = await head.run(feeds(all));
          return { logits: toRows(out.logits), act: toRows(out[actOut]) };
        } catch {
          // Exports tracados com batch fixo so aceitam uma linha por vez.
          headIsRowwise = true;
          console.warn(
            '[laya] head.onnx nao aceita batch > 1; passando uma pergunta por vez',
          );
        }
      }

      const logits = [];
      const act = [];
      for (const row of all) {
        const out = await head.run(feeds([row]));
        logits.push(toRows(out.logits)[0]);
        act.push(toRows(out[actOut])[0]);
      }
      return { logits, act };
    },
  };
}

async function loadTokenizer(modelDir) {
  try {
    const raw = await readFile(path.join(modelDir, 'tokenizer.json'), 'utf8');
    const data = parseTokenizerJson(JSON.parse(raw));
    if (!data) return defaultTokenizer();
    return {
      clsId: data.ids.cls,
      sepId: data.ids.sep,
      maskId: data.ids.mask,
      padId: data.ids.pad,
      maskToken: data.maskToken,
      encode: (text) => encodeWithData(data, text),
    };
  } catch {
    return defaultTokenizer();
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function loadAgent(modelDir, { device = 'cpu' } = {}) {
  const cfg = JSON.parse(
    await readFile(path.join(modelDir, 'rl_agent_config.json'), 'utf8'),
  );
  const fused = path.join(modelDir, 'model.onnx');
  const [tok, provider] = await Promise.all([
    loadTokenizer(modelDir),
    (await exists(fused))
      ? createFusedProvider(fused, device)
      : createSplitProvider(modelDir, device),
  ]);
  const agent = new Agent({ provider, tok, cfg });
  return { agent, cfg };
}
