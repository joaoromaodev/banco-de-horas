// Página inicial por papel (sem I/O). A raiz `/` não tem tela própria: o proxy a
// redireciona para o início de quem entrou. A Timesheet da Folha de Ponto mora em
// `/ponto`.
import type { Papel } from './auth';

export const HOME_CONTADOR = '/painel';
export const HOME_CLIENTE = '/inicio';
export const ROTA_PONTO = '/ponto';

/** Para onde `/` (e o pós-login) leva cada papel: contador e master → painel; cliente → /inicio (o que pede ação dele; ver docs/portal-cliente.md). */
export const inicioDoPapel = (role: Papel): string => (role === 'cliente' ? HOME_CLIENTE : HOME_CONTADOR);
