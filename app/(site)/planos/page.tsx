import Link from 'next/link';
import { Secao, linkCls, meta, ROTAS } from '../_partes';
import { Precos } from './Precos';

export const metadata = meta(
  'Planos e preços',
  'Essencial R$ 89, Escritório R$ 189 e Ilimitado R$ 349 por mês. Todos os módulos em todos os planos, 14 dias grátis sem cartão. Anual com 2 meses grátis.',
  '/planos',
);

const SIM = <span className="font-medium text-sucesso"><span aria-hidden="true">✓</span><span className="sr-only">Incluso</span></span>;

const LINHAS: [string, React.ReactNode, React.ReactNode, React.ReactNode][] = [
  ['Empresas-clientes ativas', 'até 10', 'até 40', 'sem limite'],
  ['Livro Caixa (cliente lança, você concilia)', SIM, SIM, SIM],
  ['Folha de Ponto com leitura por IA', SIM, SIM, SIM],
  ['Contrato de Experiência, declaração de VT e aviso de término', SIM, SIM, SIM],
  ['Alertas de vencimento de contratos', SIM, SIM, SIM],
  ['Acesso do cliente ao próprio caixa', SIM, SIM, SIM],
  ['Exportação em PDF e planilha (.xlsx)', SIM, SIM, SIM],
  ['Folhas lidas por IA por mês', '150', '600', '2.000'],
  ['14 dias de teste, sem cartão', SIM, SIM, SIM],
];

const FAQ: [string, string][] = [
  ['Como posso pagar?', 'Por Pix, boleto ou cartão de crédito — você escolhe. A cobrança é recorrente (mensal ou anual) e você recebe o lembrete antes de cada vencimento. Durante os 14 dias de teste não pedimos nenhum meio de pagamento.'],
  ['O que acontece quando o teste termina?', 'Você escolhe um plano para continuar. Se não escolher, sua conta fica em modo somente leitura e nada é apagado — você pode assinar depois e seguir de onde parou.'],
  ['Posso cancelar quando quiser?', 'Sim. Não há fidelidade nem multa: cancele pelo próprio painel e o acesso segue até o fim do período já pago. No plano anual, o valor proporcional dos meses não usados segue as regras dos Termos de uso.'],
  ['Posso trocar de plano?', 'Pode, a qualquer momento. Se a sua carteira de empresas-clientes crescer, é só subir de plano; o ajuste é proporcional.'],
  ['E os meus dados, ficam seguros?', 'Os dados do seu escritório e das empresas que você atende são seus: você é o controlador e a ClickContas apenas os processa, conforme a LGPD. Cada escritório enxerga somente os próprios dados, e você pode exportá-los ou pedir a exclusão quando quiser. Veja a Política de Privacidade.'],
  ['Preciso instalar alguma coisa?', 'Não. O ClickContas roda no navegador, no computador ou no celular — o seu e o do seu cliente.'],
];

export default function Planos() {
  return (
    <>
      <section className="border-b border-borda bg-superficie">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-tinta sm:text-4xl">Um preço simples, por escritório</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-tinta-suave">
            O preço depende só de quantas empresas-clientes você atende. Todos os módulos vêm em todos os planos.
          </p>
          <div className="mt-8"><Precos /></div>
        </div>
      </section>

      <Secao titulo="O que cada plano inclui">
        <div className="relative overflow-x-auto rounded-xl border border-borda bg-superficie shadow-cartao">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-superficie-suave text-[11px] uppercase tracking-wider text-tinta-suave">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Recurso</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Essencial</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Escritório</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Ilimitado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {LINHAS.map(([r, a, b, c]) => (
                <tr key={r}>
                  <th scope="row" className="px-4 py-3 font-normal text-tinta">{r}</th>
                  <td className="px-4 py-3 text-center text-tinta-suave">{a}</td>
                  <td className="px-4 py-3 text-center text-tinta-suave">{b}</td>
                  <td className="px-4 py-3 text-center text-tinta-suave">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Perguntas frequentes" suave>
        <div className="max-w-3xl divide-y divide-borda rounded-xl border border-borda bg-fundo">
          {FAQ.map(([p, r]) => (
            <details key={p} className="group px-5 py-4">
              <summary className="flex items-center justify-between gap-4 text-[15px] font-medium text-tinta marker:content-none [&::-webkit-details-marker]:hidden">
                {p}
                <span aria-hidden="true" className="text-lg text-tinta-fraca transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-tinta-suave">{r}</p>
            </details>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Link href={ROTAS.criarConta} className={linkCls('primaria', 'lg')}>Começar teste grátis de 14 dias</Link>
          <Link href={ROTAS.conheca} className={linkCls('secundaria', 'lg')}>Conhecer o produto</Link>
        </div>
      </Secao>
    </>
  );
}
