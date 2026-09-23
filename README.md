# Calabouço do Laya

Auto-battler tático em que o herói **não** tem árvore de comportamento. A cada
turno o [Laya](https://huggingface.co/convaiinnovations/laya-typed-decisions)
roda local em ONNX Runtime, sem chamada de API e sem geração de texto.

O estado da batalha vira um parágrafo em inglês (o checkpoint é monolíngue), o
parágrafo vira perguntas tipadas (`choice` e `score`), e o modelo devolve
probabilidades. Uma política pequena, escrita em código, combina esses sinais
com as regras do jogo (mana, poções, dano) e escolhe a jogada.

A tela em `index.html` chama `POST /api/decide` em todo turno — automático ou
manual.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/699cea97-95a4-4f40-b728-bd8607c4a21a" />


## Como funciona

```
estado da batalha
  → parágrafo em inglês (números + comparações já resolvidas)
  → 4 perguntas tipadas
  → sinais (danger, finish, threat, aggression)
  → calibração opcional (logit → a·z + b)
  → política do jogo
  → atacar / magia / poção / defender
```

O encoder lê texto bem e compara números mal. Por isso `src/decision.mjs` já
entrega as contas prontas: “o golpe inimigo deixa o herói em 0”, “mana para N
magias”, faixas de vida (`almost dead` … `unharmed`). Nenhuma frase diz o que
fazer — isso o Laya decide.

| Pergunta | Tipo | Sinal | O que pergunta |
| --- | --- | --- | --- |
| `mortal_danger` | `choice` A/B | `danger` | Sobreviver neste turno importa mais do que causar dano? |
| `finish_it` | `choice` A/B | `finish` | Dá para matar o inimigo neste turno? |
| `enemy_threat` | `choice` A/B | `threat` | O golpe que vem é pesado o bastante para bloquear? |
| `aggression` | `score` 0–2 | `aggression` | Quão agressivo jogar agora? |

Perguntas binárias usam chaves neutras `A`/`B`, não `noul`. Nesta família o
tipo booleano tende a seguir os rótulos `false:`/`true:` em vez do estado
descrito — um dos *Honest Limits* do model card.

A política (`chooseAction` em `src/decision.mjs`) é determinística:

1. **Perigo alto** → poção de cura se houver; senão defesa **só** se o golpe
   mata e o bloco ainda deixa o herói em pé. O limiar cai um pouco quando o
   score de agressão sobe (`0.6 − 0.1 × aggression`).
2. **Dá para finalizar** → ataque se o mínimo da espada (sobe com o nível)
   basta; senão magia.
3. **Ameaça ≥ 90%** e o golpe mata sem o escudo, mas o bloco salva → defesa.
4. **Ameaça ≥ 90%** com mana → magia (matar antes do golpe).
5. **Ameaça ≥ 90%** sem mana e com poção de mana → bebe a poção.
6. Sem mana para magia e com poção de mana → bebe a poção.
7. Caso contrário → ataque físico.

Ações ilegais nem entram na política: magia exige 15 de mana; poção de cura
exige estoque e o herói ferido; poção de mana exige estoque e mana incompleta.
Ataque e defesa estão sempre disponíveis.

## Requisitos

- Node.js 20 ou superior (ESM e *top-level await*; testado no 24)
- Checkpoint ONNX em `model-en/` (padrão) ou `model/` — centenas de MB, não
  versionados
- CPU basta: `onnxruntime-node` usa o encoder em CPU por padrão

## O modelo

O checkpoint no Hugging Face vem em `safetensors`. Este projeto espera um
export ONNX local. Dois layouts são aceitos; o carregador escolhe pelo arquivo:

**Grafo único** (`model-en/`, o padrão do servidor):

```
model-en/
├── model.onnx              # encoder + cabeça no mesmo grafo
├── rl_agent_config.json    # temperaturas e metadados (obrigatório)
└── tokenizer.json          # tokenizer do checkpoint
```

**Split** (`model/`):

```
model/
├── encoder.onnx
├── encoder_q8.onnx.data    # pesos int8 do encoder (~468 MB)
├── head.onnx
├── head_q8.onnx.data       # pesos int8 da cabeça (~53 MB)
├── rl_agent_config.json
└── tokenizer.json
```

Se faltar `tokenizer.json`, o carregador cai no tokenizer padrão do `laya-ts`.
Se faltar `rl_agent_config.json`, o carregamento falha.

O `laya-ts` está em `vendor/laya-ts/` porque o provider embutido assume que a
entrada da cabeça se chama `hidden_states`, e vários exports usam `hidden`. Em
`src/laya-agent.mjs` os nomes de I/O saem do próprio grafo, então os dois
layouts funcionam. O grafo único (`model.onnx`) também é detectado sozinho.

A interface fala português; o encoder é inglês. Cada inimigo tem `intent` (tela)
e `intentEn` (modelo). O parágrafo montado em `battleState()` é sempre inglês.

## Rodando

```bash
npm install
npm start          # http://localhost:8787 — o jogo chama o modelo
npm run smoke      # 6 cenários de batalha na linha de comando
```

Variáveis de ambiente:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `8787` | Porta HTTP |
| `LAYA_MODEL` | `./model-en` | Pasta do checkpoint |
| `LAYA_DEVICE` | `cpu` | Provider do ONNX Runtime |

O smoke também respeita `LAYA_MODEL` e carrega `calibration.json` se existir.
A saída lista, por cenário, os três sinais, a agressão, a jogada e o gatilho:

```
prestes a morrer, com pocoes                 hp  12 | perigo  82% finalizar   3% ameaca  91% agressao 1.40 -> Pocao de Cura (mortal_danger, 980 ms)
```

Scripts extras, sem entrada no `package.json`:

```bash
node scripts/calibrate.mjs     # refit de temperatura → calibration.json
node scripts/prompt-lab.mjs    # o sinal threat separa as intenções dos inimigos?
node scripts/parity.mjs        # sanidade do pipeline (exemplo do model card)
```

`calibrate.mjs` aceita `SAMPLES` (padrão 48) e `REUSE=1` para reaproveitar
`calibration-samples.json` sem rerodar o ONNX.

## API

`GET /api/health` — checkpoint carregado e device:

```json
{ "ok": true, "model": "laya-typed-decisions", "device": "cpu" }
```

`POST /api/decide` — estado da batalha → jogada. Campos numéricos são
obrigatórios; estado inválido responde `400`.

```bash
curl -s -X POST localhost:8787/api/decide \
  -H 'content-type: application/json' \
  -d '{
    "heroHp": 22, "heroMaxHp": 100,
    "heroMana": 40, "heroMaxMana": 50,
    "potions": 2, "manaPotions": 1, "floor": 3,
    "enemy": {
      "name": "Orc Berserker",
      "hp": 70, "maxHp": 75, "attack": 25,
      "intent": "roaring with blind rage, winding up a brutal axe swing"
    }
  }'
```

```json
{
  "action": "atacar_fisico",
  "actionLabel": "Ataque Fisico",
  "driver": "default",
  "confidence": 0.71,
  "signals": {
    "danger": { "value": 0.29, "raw": 0.61 },
    "finish": { "value": 0.08, "raw": 0.08 },
    "threat": { "value": 0.91, "raw": 0.91 }
  },
  "calibrated": true,
  "aggression": 1.41,
  "aggressionMax": 2,
  "legal": { "attack": true, "defend": true, "spell": true, "potion": true, "manaPotion": true },
  "latencyMs": 980,
  "tokens": 210,
  "model": "laya-typed-decisions",
  "device": "cpu"
}
```

- `driver` é o gatilho da política (`mortal_danger`, `finish_it`,
  `enemy_threat`, `restore_mana` ou `default`), não uma escolha direta do
  modelo.
- `signals.*.raw` é a probabilidade crua; `value` já passou pelo
  `calibration.json` quando o sinal foi ajustado.
- `confidence` é a confiança do gatilho que disparou, não uma distribuição
  sobre as quatro ações.

A sessão ONNX é única e compartilhada: as inferências são serializadas, uma
decisão por vez, na ordem em que chegam.

## Regras da batalha

| Ação | Efeito | Custo |
| --- | --- | --- |
| Ataque físico | 12–20 de dano, +2 por nível depois do 1º | — |
| Magia arcana | 26–36 de dano, +2 por nível depois do 1º | 15 de mana |
| Poção de cura | +40 HP | 1 poção de cura |
| Poção de mana | +25 de mana | 1 poção de mana |
| Postura defensiva | próximo golpe inimigo pela metade, +10 de mana | — |

O herói age primeiro e o inimigo revida no mesmo turno. Derrotar o inimigo
avança um andar (+150 pontos, +25 de mana) e concede XP (`metade do HP máximo
do inimigo + 10 × andar`). Ao encher a barra (`100 × nível` atual), o
cavaleiro sobe de nível: HP e mana voltam ao máximo e o dano de ataque e magia
sobe 2 pontos. Também rola o drop: cada
tipo de poção cai de forma independente (cura ~45%, mana ~40%), com um bônus
pequeno por andar e taxas próprias no bestiário (goblin deixa mais cura, mago
mais mana). A tela também deixa beber as duas poções na mão, fora do turno do
modelo.

## Calibração

O model card avisa: o checkpoint sai superconfiante; as temperaturas
publicadas (`choice:11+` = 0.10) caem fora da faixa válida e o `laya-ts` as
limita a 0.5 no carregamento. As probabilidades relativas ainda ordenam bem;
o valor absoluto de `P(A)` não.

`scripts/calibrate.mjs` faz o que o card pede: coleta estados aleatórios, usa
as regras do jogo como rótulo (perigo = o próximo golpe mata; finalizar = a
melhor ação disponível mata) e ajusta um par `(a, b)` sobre o logit. Só
grava o sinal se o Brier melhorar no terço retido.

O `calibration.json` da raiz entra no servidor e no smoke. Sem o arquivo, os
sinais passam crus e o log avisa para rodar o script.

## Estrutura

```
server.mjs                 # HTTP sem framework: estáticos + /api/health + /api/decide
src/laya-agent.mjs         # carrega ONNX (fused ou split) e monta o Agent do laya-ts
src/decision.mjs           # estado → perguntas → sinais → política → jogada
src/loot.mjs               # tabela de drop das poções (cura e mana)
src/level.mjs              # XP, curva de nível, dano por nível e refill de HP/mana
scripts/smoke.mjs          # 6 cenários de sanidade
scripts/calibrate.mjs      # refit de temperatura nos dados do próprio jogo
scripts/prompt-lab.mjs     # threat vs. intenções do bestiário
scripts/parity.mjs         # exemplo do model card (department → billing)
index.html                 # interface (Tailwind via CDN, sem build)
calibration.json           # (a, b) por sinal, se já foi ajustado
vendor/laya-ts/            # cliente laya-ts vendorizado
```

## Estado atual e limitações

- **O modelo estima sinais, a política escolhe a ação.** Isso é de propósito:
  deixar o Laya votar direto nas quatro jogadas produzia distribuições
  quase iguais (~50% ataque em qualquer HP). Separar “o que é verdade neste
  estado” de “o que fazer com isso” deixa o jogo jogável e o modelo no papel
  em que o encoder é forte (texto, não aritmética).
- **Só `danger` está calibrado** no `calibration.json` atual. `finish` não
  melhorou fora da amostra e ficou cru; `threat` não entra no refit porque
  o rótulo seria opinião, não regra.
- **`head.onnx` (layout split) não aceita batch > 1.** O export foi traçado
  com batch fixo. O provider tenta o lote, loga um aviso na primeira falha e
  passa a enviar uma pergunta por vez. O erro único do ONNX Runtime no log é
  esperado.
- **Latência de cerca de 1 s por turno em CPU**, com ~200 tokens de entrada
  por decisão no grafo único. O auto-battle encadeia turnos; não usa
  `setInterval`, para não empilhar inferências sobre estado velho.
- **Confianças do checkpoint não são calibradas de fábrica.** Mesmo com o
  refit local, trate `confidence` e `signals.*.value` como ordenação, não
  como probabilidade frequentista.

O modelo é distribuído sob Apache-2.0 pela Convai Innovations.
