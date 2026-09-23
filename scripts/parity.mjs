// Sanidade do pipeline: roda o exemplo do model card, onde a resposta esperada
// e conhecida (department -> billing), alem de um par de textos opostos.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '../src/laya-agent.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { agent, cfg } = await loadAgent(path.join(ROOT, process.env.LAYA_MODEL ?? 'model'));
console.log('checkpoint:', cfg.model_name, '\n');

console.log(
  'tokens de "Hello world, refund please":',
  agent.tok.encode('Hello world, refund please').slice(0, 12),
);
console.log('ids cls/sep/mask/pad:', agent.tok.clsId, agent.tok.sepId, agent.tok.maskId, agent.tok.padId, '\n');

const email = {
  from: 'user@acme.com',
  subject: 'Duplicate charge on invoice #4411',
  body: 'Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan.',
};

const out = await agent.predict(email, {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this request?',
    criteria: {
      billing: 'invoices, payments, refunds',
      technical: 'bugs, outages, system errors',
      sales: 'pricing, new contracts',
      other: 'everything else',
    },
  },
});
console.log('esperado billing ->', out.answers.department.choice, out.answers.department.probabilities);

for (const text of [
  'This movie was absolutely wonderful, I loved every minute.',
  'This movie was terrible, I hated every minute of it.',
]) {
  const r = await agent.predict(text, {
    sentiment: {
      type: 'choice',
      instructions: 'Is this review positive?',
      criteria: { A: 'yes, the review is positive', B: 'no, the review is negative' },
    },
  });
  console.log(`"${text.slice(0, 40)}..." ->`, r.answers.sentiment.choice, r.answers.sentiment.probabilities);
}
