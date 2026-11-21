import Link from 'next/link';
import { Selo } from '@/components/ui';
import { VENDAS_ABERTAS } from '@/lib/brand';
import { PLANOS } from '@/lib/cobranca';
import { Secao, linkCls, meta, ROTAS, TESTE } from '../_partes';

export const metadata = meta(
  'O cliente lança, a IA lê, o contador confere',
  `Livro Caixa, Folha de Ponto com leitura por IA e Contrato de Experiência para escritórios contábeis pequenos.${VENDAS_ABERTAS ? ' Teste grátis por 14 dias, sem cartão.' : ''}`,
  '/conheca',
);

// ---------------------------------------------------------------- mocks (HTML/CSS)
function Janela({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-borda bg-superficie shadow-flutuante">
      <div className="flex items-center gap-1.5 border-b border-borda bg-superficie-suave px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-borda-forte/40" />
        <span className="h-2 w-2 rounded-full bg-borda-forte/40" />
        <span className="h-2 w-2 rounded-full bg-borda-forte/40" />
        <span className="ml-2 text-[11px] font-medium text-tinta-fraca">{titulo}</span>
      </div>
      {children}
    </div>
  );
}

function MockCaixa() {
  const linhas = [
    { d: '03/11', h: 'Venda balcão — Pix', v: '+ 1.280,00', e: true },
    { d: '04/11', h: 'Energia elétrica', v: '− 412,35', e: false },
    { d: '05/11', h: 'Consulta — cartão', v: '+ 960,00', e: true },
    { d: '07/11', h: 'Material de expediente', v: '− 86,90', e: false },
  ];
  return (
    <Janela titulo="Livro Caixa · Novembro">
      <div className="grid grid-cols-3 gap-px bg-borda text-center">
        {[['Entradas', '2.240,00', 'text-sucesso'], ['Saídas', '499,25', 'text-perigo'], ['Saldo', '1.740,75', 'text-tinta']].map(([r, v, c]) => (
          <div key={r} className="bg-superficie px-2 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-tinta-fraca">{r}</div>
            <div className={`text-sm font-semibold tabular-nums ${c}`}>{v}</div>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-borda text-[12px]">
        {linhas.map((l) => (
          <li key={l.h} className="flex items-center gap-2 px-3 py-2">
            <span className="w-9 shrink-0 tabular-nums text-tinta-fraca">{l.d}</span>
            <span className="min-w-0 flex-1 truncate text-tinta">{l.h}</span>
            <span className={`shrink-0 font-medium tabular-nums ${l.e ? 'text-sucesso' : 'text-perigo'}`}>{l.v}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-borda bg-superficie-suave px-3 py-2 text-[11px] text-tinta-suave">
        <span>Lançado pelo cliente</span>
        <Selo tom="sucesso">Conciliado</Selo>
      </div>
    </Janela>
  );
}

function MockPonto() {
  const dias = [['01', '07:58', '12:02', '13:01', '17:05'], ['02', '08:03', '12:00', '13:00', '17:10'], ['03', '07:55', '12:15', '13:15', '17:00']];
  return (
    <Janela titulo="Folha de Ponto · leitura por IA">
      <div className="grid grid-cols-[5.5rem_1fr] gap-3 p-3">
        <div className="-rotate-2 rounded-md border border-aviso-borda bg-aviso-suave p-2 font-serif text-[10px] italic leading-5 text-tinta-suave shadow-cartao">
          <div className="mb-1 border-b border-aviso-borda pb-0.5 font-sans font-semibold not-italic text-aviso">Folha manuscrita</div>
          <div>8:00 · 12:00</div><div>13:00 · 17:05</div><div>7:55 · 12:15</div>
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-5 gap-1 pb-1 text-center text-[9px] font-medium uppercase tracking-wider text-tinta-fraca">
            <span>Dia</span><span>Ent.</span><span>Saí.</span><span>Ret.</span><span>Saí.</span>
          </div>
          {dias.map((d) => (
            <div key={d[0]} className="grid grid-cols-5 gap-1 border-t border-borda py-1 text-center text-[11px] tabular-nums text-tinta">
              {d.map((c, i) => <span key={i} className={i === 0 ? 'font-medium text-tinta-suave' : ''}>{c}</span>)}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-borda bg-superficie-suave px-3 py-2 text-[11px] text-tinta-suave">
        <span>1 horário a conferir</span>
        <Selo tom="aviso">Revisar</Selo>
      </div>
    </Janela>
  );
}

function MockContrato() {
  return (
    <Janela titulo="Contrato de Experiência">
      <div className="space-y-3 p-3 text-[12px]">
        <div className="rounded-md border border-borda p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-tinta-fraca">Colaboradora</div>
          <div className="font-medium text-tinta">Maria das Graças Souza</div>
          <div className="mt-1 text-tinta-suave">Auxiliar administrativo · 45 + 45 dias</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Selo tom="primaria">Contrato</Selo>
          <Selo tom="primaria">Declaração de VT</Selo>
          <Selo tom="primaria">Aviso de término</Selo>
        </div>
        <div className="flex items-center justify-between rounded-md border border-aviso-borda bg-aviso-suave px-2.5 py-2 text-aviso">
          <span>1º período vence em</span><strong className="tabular-nums">12 dias</strong>
        </div>
      </div>
    </Janela>
  );
}

// ---------------------------------------------------------------- conteúdo
const MODULOS = [
  {
    nome: 'Livro Caixa',
    quem: 'O cliente lança · você concilia',
    texto: 'A empresa-cliente registra entradas e saídas pelo celular. Você confere, classifica e fecha o mês — o livro sai em PDF ou planilha, sem redigitar nada.',
    mock: <MockCaixa />,
  },
  {
    nome: 'Folha de Ponto',
    quem: 'A IA lê · você revisa',
    texto: 'Fotografe a folha manuscrita. A leitura por IA preenche os horários, destaca o que está duvidoso e entrega o .xlsx pronto para o departamento pessoal.',
    mock: <MockPonto />,
  },
  {
    nome: 'Contrato de Experiência',
    quem: 'Gera os documentos · avisa os prazos',
    texto: 'Contrato, declaração de vale-transporte e aviso de término saem dos seus próprios modelos, preenchidos. E você é lembrado antes de cada vencimento.',
    mock: <MockContrato />,
  },
];

const PASSOS = [
  ['1', 'O cliente lança', 'Sua empresa-cliente registra o movimento do caixa ou manda a foto da folha. Sem planilha trocada por WhatsApp.'],
  ['2', 'A IA lê', 'O que veio em papel vira dado: horários, valores e datas são lidos e organizados para você.'],
  ['3', 'O contador confere', 'Você só revisa o que importa, corrige o que a IA marcou como duvidoso e gera o documento final.'],
];

export default function Conheca() {
  return (
    <>
      {/* herói */}
      <section className="hero relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-20 h-[24rem] w-[24rem] opacity-[0.06] brightness-0 invert" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <span className="mb-6 block h-1 w-10 rounded-full bg-verde-500" aria-hidden="true" />
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.15] tracking-tight sm:text-5xl">
            O cliente lança,<br />a IA lê,<br />o contador confere.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-petroleo-100 sm:text-lg">
            O ClickContas é a camada entre o seu cliente e o seu sistema contábil: coleta, conferência e documentos prontos — para escritórios pequenos que cansaram de redigitar.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {VENDAS_ABERTAS && <Link href={ROTAS.criarConta} className={linkCls('claro', 'lg')}>{TESTE}</Link>}
            <Link href={ROTAS.entrar} className={linkCls(VENDAS_ABERTAS ? 'vazado' : 'claro', 'lg')}>Entrar</Link>
          </div>
          {VENDAS_ABERTAS && <p className="mt-4 text-[13px] text-petroleo-200">Sem cartão de crédito. Planos a partir de R$ {PLANOS.essencial.mensal}/mês.</p>}
        </div>
      </section>

      {/* módulos */}
      <Secao id="modulos" titulo="Três ferramentas, uma rotina só"
        subtitulo={`${VENDAS_ABERTAS ? 'Todos os módulos em todos os planos. ' : ''}Cada um nasceu de uma tarefa que consumia horas no escritório.`}>
        <div className="space-y-14">
          {MODULOS.map((m, i) => (
            <div key={m.nome} className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
              <div className={i % 2 ? 'md:order-2' : ''}>
                <Selo tom="primaria">{m.quem}</Selo>
                <h3 className="mt-3 text-xl font-semibold tracking-tight text-tinta">{m.nome}</h3>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-tinta-suave">{m.texto}</p>
              </div>
              <div className="mx-auto w-full max-w-md">{m.mock}</div>
            </div>
          ))}
        </div>
      </Secao>

      {/* como funciona */}
      <Secao id="como-funciona" titulo="Como funciona" suave>
        <ol className="grid gap-4 md:grid-cols-3">
          {PASSOS.map(([n, t, d]) => (
            <li key={n} className="rounded-xl border border-borda bg-fundo p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primaria text-sm font-semibold text-sobre-primaria" aria-hidden="true">{n}</span>
              <h3 className="mt-4 text-[15px] font-semibold text-tinta">{t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-tinta-suave">{d}</p>
            </li>
          ))}
        </ol>
      </Secao>

      {/* CTA final */}
      {VENDAS_ABERTAS && (
      <section className="hero">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Teste com os seus clientes por 14 dias</h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-petroleo-100">Sem cartão. Se não fizer sentido, é só não continuar.</p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={ROTAS.criarConta} className={linkCls('claro', 'lg')}>{TESTE}</Link>
            <Link href={ROTAS.planos} className={linkCls('vazado', 'lg')}>Ver planos</Link>
          </div>
        </div>
      </section>
      )}
    </>
  );
}
