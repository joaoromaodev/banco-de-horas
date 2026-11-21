-- 0019 — Preferências do escritório (Sprint 6, Frente A: tela "Escritório").
--
-- O QUE TRAZ
-- `escritorios.prazo_pedidos_padrao`: dia do mês (1–28) sugerido como prazo dos
-- pedidos mensais novos (tela "Pedidos mensais"). Padrão 10 — o valor que já era
-- fixo no código. NÃO muda pedidos já configurados: cada um guarda o seu
-- `dia_prazo` (0018).
--
-- ADITIVA: uma coluna com default; nenhuma linha é reescrita além do default.
-- O código funciona sem ela (lê 10 e avisa que falta aplicar ao tentar gravar),
-- então a ordem publicar/aplicar não quebra nada. Os demais campos da tela já
-- existem: nome e cnpj (0010), contabilista_nome/_crc (0017), agenda_avisos (0014).

alter table escritorios
  add column if not exists prazo_pedidos_padrao int not null default 10
  check (prazo_pedidos_padrao between 1 and 28);

notify pgrst, 'reload schema';
