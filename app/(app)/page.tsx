// A raiz não tem tela: o proxy.ts já redireciona por papel. Este arquivo só existe
// como rede de segurança (ex.: o proxy desligado) e manda para o painel.
import { redirect } from 'next/navigation';

export default function Raiz() {
  redirect('/painel');
}
