import { Cabecalho, Rodape } from './_partes';

// Layout do site público: sem a barra lateral do app.
export default function LayoutSite({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Cabecalho />
      <main className="flex-1">{children}</main>
      <Rodape />
    </div>
  );
}
