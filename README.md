# ⏱️ Banco de Horas — Folha de Ponto

Sistema que lê **folhas de ponto manuscritas** (foto), extrai os horários com IA, permite revisão assistida e gera a **planilha de levantamento de horas** pronta — uma por funcionário — arquivando tudo no Google Sheets.

Feito para eliminar o trabalho manual de uma contadora que digitava, dia a dia, os horários do papel para a planilha.

## O problema

A empresa envia a folha de ponto de cada funcionário (preenchida à mão) e alguém precisa transcrever 4 horários por dia, mês a mês, para uma planilha no formato exigido — com fórmulas de saldo, jornada a cumprir por tipo de dia, etc. Trabalhoso e sujeito a erro.

## A solução — fluxo

```
Foto da folha  →  OCR (Gemini)  →  Revisão assistida  →  Planilha .xlsx  →  Google Sheets
 manuscrita       JSON            regras + edição       (formato exato)     (arquivo do mês)
```

1. **Upload** da foto da folha.
2. **Extração** com Google Gemini (visão) devolvendo os horários em JSON estruturado, com marcação de leituras incertas.
3. **Revisão lado a lado**: a imagem e uma grade editável, com destaque automático de células suspeitas (ordem cronológica inválida, horário implausível, dia incompleto, fim de semana com lançamento…).
4. **Geração** do `.xlsx` idêntico ao modelo usado pela contadora — fórmulas de total/saldo, sistema de datas 1904 (para saldo negativo), coluna "horário a cumprir" calculada por calendário (8h dia útil / 4h sábado / 0h domingo-feriado).
5. **Persistência** no Google Sheets (um registro por dia, com _upsert_ por funcionário/mês) e **geração em lote** (.zip com todas as planilhas do mês).

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind
- **Google Gemini** (`@google/genai`) — OCR de manuscrito com saída estruturada
- **Google Sheets** (`googleapis`) — banco de dados simples
- **ExcelJS** — geração fiel do `.xlsx` (estilos, mesclagens, fórmulas, 1904)
- **JSZip** — empacotamento em lote

## Arquitetura

```
lib/
  tipos.ts        modelo de domínio
  tempo.ts        parsing de horários (HH:MM ↔ fração de dia)
  calendario.ts   tipo do dia + horário a cumprir
  validacao.ts    regras que destacam células suspeitas
  planilha.ts     gerador do .xlsx (ExcelJS)
  ocr.ts          extração via Gemini (schema JSON)
  sheets.ts       persistência e cadastros no Google Sheets
  config.ts       credenciais (env / conta de serviço)
app/
  page.tsx              upload + revisão + download + lote
  cadastros/           funcionários e feriados
  configuracoes/       chave da IA e modelo
  api/{extrair,gerar,gerar-lote,salvar,funcionarios,feriados,config}
```

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev
```

Abra http://localhost:3000.

### Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `GEMINI_API_KEY` | Chave da API do Google AI Studio (fallback; o app também lê a chave da aba `Config` da planilha) |
| `GOOGLE_SHEETS_ID` | ID da planilha do Google que serve de banco |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Caminho do JSON da conta de serviço (local) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Alternativa: o JSON inline (ideal para deploy na Vercel) |

A conta de serviço precisa ter a planilha compartilhada como **editor**.

---

Projeto pessoal — Next.js 16, Google Gemini, Google Sheets.
