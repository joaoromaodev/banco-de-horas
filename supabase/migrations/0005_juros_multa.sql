-- Juros e multa por lançamento.
--
-- Decisão da contadora (via João): juros e multa são valores ADICIONAIS que
-- também saem do caixa — não um simples detalhamento da saída. Então a saída
-- efetiva de uma linha passa a ser `saida + juros + multa`, e o saldo, o saldo
-- transportado, os totais do mês e o resumo somam os três. O principal continua
-- na coluna `saida`; juros e multa ficam à parte, visíveis e auditáveis.

-- Colunas novas (default 0: linhas existentes seguem válidas, sem penalidade).
alter table lancamentos
  add column if not exists juros numeric(14, 2) not null default 0 check (juros >= 0),
  add column if not exists multa numeric(14, 2) not null default 0 check (multa >= 0);

-- A regra "entrada OU saída" agora considera a saída efetiva (saida+juros+multa):
-- uma linha é entrada (entrada>0) XOR uma saída de qualquer natureza (>0). Assim
-- dá para ter uma linha só de juros/multa (saida=0), e uma entrada não carrega
-- penalidade.
alter table lancamentos drop constraint if exists entrada_xor_saida;
alter table lancamentos add constraint entrada_xor_saida
  check ((entrada > 0) <> ((saida + juros + multa) > 0));

-- Saldo final do exercício: entra - (saida + juros + multa).
create or replace function saldo_final_exercicio(p_exercicio uuid)
returns numeric language sql stable as $$
  select e.saldo_inicial
       + coalesce((select sum(l.entrada - l.saida - l.juros - l.multa) from lancamentos l
                    where l.exercicio_id = e.id), 0)
    from exercicios e where e.id = p_exercicio;
$$;

-- Resumo mensal: "saidas" inclui juros+multa; o saldo acumulado também.
create or replace view resumo_mensal as
select e.id  as exercicio_id,
       e.empresa_id,
       e.ano,
       m.mes,
       coalesce(sum(l.entrada), 0)                    as entradas,
       coalesce(sum(l.saida + l.juros + l.multa), 0)  as saidas,
       e.saldo_inicial
         + coalesce((select sum(l2.entrada - l2.saida - l2.juros - l2.multa)
                       from lancamentos l2
                      where l2.exercicio_id = e.id and l2.mes <= m.mes), 0) as saldo_final
  from exercicios e
 cross join generate_series(1, 12) as m(mes)
  left join lancamentos l on l.exercicio_id = e.id and l.mes = m.mes
 group by e.id, e.empresa_id, e.ano, m.mes, e.saldo_inicial;

notify pgrst, 'reload schema';
