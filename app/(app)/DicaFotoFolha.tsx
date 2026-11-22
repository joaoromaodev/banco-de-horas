// Dica de foto da folha de ponto (Sprint 18 · A). A IA gratuita erra mais em foto
// torta, cortada ou escura; a dica fica à vista onde a foto é escolhida — no envio
// do cliente (/enviar-ponto) e na Timesheet (/ponto). Sem regra: só orientação.
import { Aviso } from '@/components/ui';

export const TEXTO_DICA_FOTO = 'Fotografe a folha reta, inteira e com luz';

export function DicaFotoFolha({ className }: { className?: string }) {
  return (
    <Aviso tom="info" className={className}>
      <strong>{TEXTO_DICA_FOTO}.</strong>{' '}
      De cima, com os quatro cantos aparecendo e sem sombra — assim a leitura erra menos.
    </Aviso>
  );
}
