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
