// GET /api/caixa/demonstrativo?empresa=&ano=&mes= — "Demonstrativo de caixa" do mês.
//
// Vale para o cliente (só a própria empresa — `exigirEmpresa`) e para a contabilidade
// (a prévia). Só devolve mês CONFIRMADO em sequência desde janeiro, para os dois:
// o recorte é o mesmo de /api/caixa/resumo, e a prévia mostra exatamente o que o
// cliente vai ver. Só leitura (não cria exercício). A contabilidade recebe também o
// registro de envio e quantos logins de cliente receberiam o e-mail.
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa } from '@/lib/acesso';
import { hojeBelem } from '@/lib/agenda';
import { emailsDoCliente, lerDemonstrativo, lerEnvio, RegistroEnvio } from '@/lib/demonstrativoServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;

  const ano = Number(req.nextUrl.searchParams.get('ano'));
  const mes = Number(req.nextUrl.searchParams.get('mes'));
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return Response.json({ erro: 'Ano inválido.' }, { status: 400 });
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return Response.json({ erro: 'Mês inválido.' }, { status: 400 });

  try {
    const resultado = await lerDemonstrativo(empresa, ano, mes, hojeBelem());
    if (!ehGestor(g.sessao)) return Response.json(resultado, { headers: { 'Cache-Control': 'no-store' } });

    // Só a contabilidade vê o registro de envio e o número de destinatários. Sem a
    // 0023 (tabela ausente) a prévia segue, e o envio é que avisa.
    let envio: RegistroEnvio | null = null;
    let envioIndisponivel = false;
    try { envio = await lerEnvio(empresa, ano, mes); } catch (e) {
      envioIndisponivel = true;
      console.error('[caixa/demonstrativo] envio:', (e as { code?: string })?.code ?? '', e instanceof Error ? e.message : e);
    }
    const destinatarios = (await emailsDoCliente(empresa)).length;
    return Response.json({ ...resultado, envio, envioIndisponivel, destinatarios }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[caixa/demonstrativo]', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível montar o demonstrativo agora.' }, { status: 502 });
  }
}
