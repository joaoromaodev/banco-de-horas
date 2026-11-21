// Eventos da folha enviada pelo cliente — ligados ao sino de notificações do app.
//
// Sem nome de funcionário nem horários na notificação (dado pessoal): só a empresa,
// o mês e o link para a fila do ponto. Quem chama não muda; esta função nunca lança
// — o envio/leitura já aconteceu quando o evento é emitido.

import { registrarNotificacao } from '@/lib/notificacoesServidor';

export type TipoEventoEnvio = 'recebida' | 'lida' | 'falhou' | 'aplicada' | 'devolvida';

export interface EventoEnvioPonto {
  tipo: TipoEventoEnvio;
  envioId: string;
  escritorioId: string;
  empresaId: string;
  ano: number;
  mes: number;
}

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** O que vai para o sino da contabilidade (ou `null` se o evento não avisa ninguém). */
export function notificacaoDoEnvio(ev: EventoEnvioPonto): { tipo: string; titulo: string; texto: string; href: string; chave: string } | null {
  const periodo = `${MES[ev.mes - 1] ?? ev.mes}/${ev.ano}`;
  const href = `/ponto?${new URLSearchParams({ empresa: ev.empresaId, ano: String(ev.ano), mes: String(ev.mes) })}`;
  const base = { href, chave: `envio-ponto:${ev.envioId}:${ev.tipo}` };
  switch (ev.tipo) {
    case 'recebida': return { ...base, tipo: 'ponto_envio', titulo: 'Folha de ponto enviada pelo cliente', texto: `Nova folha de ${periodo} aguardando leitura.` };
    case 'lida': return { ...base, tipo: 'ponto_envio', titulo: 'Folha lida pela IA', texto: `Folha de ${periodo} pronta para conferir.` };
    case 'falhou': return { ...base, tipo: 'ponto_envio', titulo: 'Não foi possível ler uma folha', texto: `Folha de ${periodo}: confira a foto e digite à mão, se preciso.` };
    default: return null; // aplicada/devolvida: a própria contadora fez
  }
}

export function notificarEnvioPonto(ev: EventoEnvioPonto): void {
  try {
    const n = notificacaoDoEnvio(ev);
    if (!n) return;
    void registrarNotificacao({ escritorioId: ev.escritorioId, empresaId: ev.empresaId, ...n }).catch(() => {});
  } catch { /* nunca derruba quem chamou */ }
}
