# IA gratuita sem treino com os dados

Pesquisa de 21/11/2026 (links lidos nessa data). Motivo: o João decidiu que o beta é
**todo gratuito**; o Gemini no nível gratuito deixa o Google usar o conteúdo
("provide, improve, and develop", com revisão humana, sem opção de desligar —
[termos do AI Studio](https://aistudio.google.com/docs/terms)). Por isso a IA de
documentos do caixa está desligada.

## Comparação

| Opção | Custo / limite | Cartão | Treina com os dados? | Visão e manuscrito | Troca no código |
|---|---|---|---|---|---|
| AI Studio gratuito (hoje) | grátis | não | **sim**, com revisão humana | ótimo | — |
| Gemini pago | centavos/mês no beta | sim | não | ótimo | zero |
| Vertex AI, crédito US$ 300 | 90 dias | sim | não | ótimo | fácil — **mas o crédito não cobre mais Gemini para cadastros desde 16/11/2026** ([free trial](https://docs.cloud.google.com/free/docs/free-cloud-features)) |
| **Cloudflare Workers AI** | 10.000 neurônios/dia grátis ([preços](https://developers.cloudflare.com/workers-ai/platform/pricing/)); estimativa 100–180 fotos/dia | não | **não** ([privacidade](https://developers.cloudflare.com/workers-ai/platform/privacy/)); retenção e região não ditas | Llama 4 Scout, Llama 3.2 11B Vision, Mistral Small 3.1 — manuscrito médio (estimativa) | REST compatível com OpenAI |
| Groq gratuito | limite por conta | não | pode ligar retenção zero; EUA ([dados](https://console.groq.com/docs/your-data)) | só qwen com visão, médio | compatível com OpenAI |
| Mistral gratuito (Experiment) | baixo; declarado para avaliação | não | sim, **com opção de desligar** ([help](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)) | OCR forte em impresso | SDK próprio |
| OpenRouter `:free` | 50 pedidos/dia | não | depende do provedor — descartado | varia | compatível com OpenAI |
| GitHub Models | aposentado em 30/07/2026 — descartado | | | | |
| Hugging Face | sem crédito no gratuito — descartado | | | | |
| OCR local (Tesseract etc.) | zero, nada sai do servidor | não | não se aplica | **ruim em manuscrito**; bom em impresso/PDF | reescrever leitura |

Vale para todos: com provedor externo os dados saem do Brasil (LGPD); dado de saúde
continua fora. Neurônios por foto e qualidade em manuscrito são **estimativas** — medir
com folhas reais antes de trocar.

## Decisão do dono (21/11/2026)

1. **Folha manuscrita → Cloudflare Workers AI**, depois de um comparativo em folhas
   (Llama 4 Scout × Mistral Small 3.1 × Gemini atual) medindo acerto por campo. A tela
   de revisão continua obrigatória.
2. **Documentos → primeiro sem IA:** texto do PDF e linha digitável do boleto lidos no
   servidor (custo zero, nada sai). Foto de nota/recibo e classificação de lançamento
   pelo Workers AI.
3. **Contador de cota** do Workers AI com aviso antes de acabar (a cota é dividida
   entre folha e documentos).
4. Plano B gratuito: Groq com retenção zero ou Mistral com treino desligado.
   Gemini pago só se o João liberar custo.
5. Até a troca: nenhum documento real no Gemini gratuito (como já está).

## Comparativo de visão na folha de ponto (21/11/2026, Sprint 17 · frente F)

**Como:** `scripts/ia-comparativo/` — 4 folhas **sintéticas** (`gerar_folhas.py`: tabela
"Folha de ponto individual", horários em fonte manuscrita do Windows, empresa e
funcionários fictícios, gabarito conhecido): **limpa**, **inclinada** (3–5°), **borrada**
(desfoque gaussiano) e **foto torta** (perspectiva, mesa ao fundo, sombra, ruído, JPEG 55).
Cada uma tem 30–31 dias com 4 horários, sábados com meio expediente, domingos, feriado,
atestado, falta e "BH". Mesmo prompt, esquema e validação do app (`lib/ocr.ts`);
Cloudflare com stream e imagem ≤ 2.048 px; Gemini (referência, imagem sintética sem dado
pessoal) pelo mesmo provedor do app. Acerto = horário igual ao gabarito ("HH:MM").
Folha que falha conta como tudo errado.

| Modelo | Horários certos | Vazios mantidos vazios | Inventados | Marcador | Limpa | Inclinada | Borrada | Foto torta | Folhas lidas | Tempo/folha | Neurônios/folha |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **`@cf/mistralai/mistral-small-3.1-24b-instruct`** | **91,0%** | 95,5% | 8 | 84,2% | 100% | 100% | 100% | 65,0% | 4/4 | **43,8 s** | **194** |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 59,3% | 92,0% | 14 | 42,1% | 75,6% | 64,5% | 69,2% | 28,8% | 4/4 | 232 s | 172 |
| `@cf/google/gemma-4-26b-a4b-it` | 0% | — | — | — | — | — | — | — | 0/4 | 110 s | 120 |
| `@cf/meta/llama-3.2-11b-vision-instruct` | não rodou | | | | | | | | 0/4 | | |
| `gemini-2.5-flash` (referência) | 99,0% | 100% | 0 | 94,7% | 100% | 100% | 100% | 96,3% | 4/4 | 18,3 s | — |

- **Mistral Small 3.1 rodou duas vezes** (com e sem stream) com o mesmo resultado
  (temperatura 0). Lê perfeito o que está reto e nítido; na foto torta erra ~1 em 3
  horários. Gasto real informado pela API: 181–220 neurônios por folha → **~45–50 folhas
  por dia** na cota gratuita (10.000).
- **Llama 4 Scout:** lento demais (~4 min por folha; sem stream a Cloudflare devolve 408)
  e erra muito — descartado.
- **Gemma 4 26B:** modelo de raciocínio; gastou os 4.096 tokens de saída "pensando" e não
  devolveu JSON. Fica para testar com o raciocínio desligado.
- **Llama 3.2 11B Vision:** a Cloudflare exige aceitar a licença da Meta enviando "agree"
  pela API; não aceitamos sem autorização do dono. Os demais modelos de visão do catálogo
  (`qwen3.8-27b`, `deepseek-v4.1-flash`, `inkling-2-small`, `moondream3.1`, `clef*`,
  `clairic*`) não foram testados — os grandes custam bem mais por folha.
- Gasto total do comparativo: ~3.700 neurônios do dia (incluindo testes de chamada).

**Escolha:** `@cf/mistralai/mistral-small-3.1-24b-instruct` é o padrão
(`MODELO_CLOUDFLARE_PADRAO`, troca por `IA_MODELO_CLOUDFLARE`). Fica abaixo do Gemini
(91% × 99%), sobretudo em foto torta — a **revisão continua obrigatória** e vale orientar
o cliente a fotografar a folha reta e com luz. Medir de novo com folhas reais (com
autorização) antes de qualquer conclusão sobre produção.
