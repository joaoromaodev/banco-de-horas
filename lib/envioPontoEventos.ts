// Eventos da folha enviada pelo cliente — o ponto de ligação com as notificações.
//
// Hoje só registra no log (sem nome de funcionário nem horários: só ids). A frente
// de notificações no app (sino no layout, lib/notificacoes*) liga aqui o aviso à
// contadora ("Folha nova da empresa X") e ao cliente ("Sua folha foi devolvida").
// Trocar o corpo desta função é o ÚNICO ponto: quem chama não muda.
// Não pode lançar: o envio/leitura já aconteceu quando o evento é emitido.

export type TipoEventoEnvio = 'recebida' | 'lida' | 'falhou' | 'aplicada' | 'devolvida';

export interface EventoEnvioPonto {
  tipo: TipoEventoEnvio;
  envioId: string;
  escritorioId: string;
  empresaId: string;
  ano: number;
  mes: number;
}

export function notificarEnvioPonto(ev: EventoEnvioPonto): void {
  try {
    console.info('[envio-ponto] evento', ev.tipo, ev.envioId, ev.empresaId, `${ev.ano}-${String(ev.mes).padStart(2, '0')}`);
  } catch { /* nunca derruba quem chamou */ }
}
