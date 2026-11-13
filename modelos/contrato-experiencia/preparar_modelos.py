"""Converte os modelos .docx da contadora em templates com {{PLACEHOLDERS}}.

Uso: python -I preparar_modelos.py <dir_com_os_originais> <dir_saida>
Os originais (da contadora) se chamam contrato.docx, vale.docx e encerramento.docx.
Cada placeholder fica inteiro dentro de um único <w:t>, para o preenchimento
em runtime ser um simples replace de string.
"""
import sys, zipfile, re, os

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

P_RE = re.compile(r"<w:p[ >].*?</w:p>", re.S)


def paras(xml):
    return list(P_RE.finditer(xml))


def sub_in(p, old, new, count=1):
    """Troca o texto de um <w:t> (conteúdo exato) dentro do parágrafo."""
    pat = re.compile(r"(<w:t(?: [^>]*)?>)" + re.escape(old) + r"(</w:t>)")
    n = len(pat.findall(p))
    assert n >= count, f"não achei {old!r} ({n})"
    return pat.sub(lambda m: '<w:t xml:space="preserve">' + new + m.group(2), p, count=count)


def edit(xml, plan):
    """plan: {indice_paragrafo: funcao(p)->p | None (remove)}"""
    ps = paras(xml)
    pieces, last = [], 0
    for i, m in enumerate(ps):
        if i in plan:
            pieces.append(xml[last:m.start()])
            f = plan[i]
            pieces.append(f(m.group(0)) if f else "")
            last = m.end()
    pieces.append(xml[last:])
    return "".join(pieces)


def rpr_of(p, bold):
    for r in re.findall(r"<w:r>.*?</w:r>", p, re.S):
        rp = re.search(r"<w:rPr>.*?</w:rPr>", r, re.S)
        if rp and (("<w:b/>" in rp.group(0)) == bold) and "<w:t" in r:
            return rp.group(0)
    raise AssertionError("sem rPr")


def rebuild(p, segs, jc="both", rpr_src=None):
    """Recria o parágrafo com os mesmos pPr e uma lista de (negrito, texto)."""
    src_p = rpr_src or p
    rn, rb = rpr_of(src_p, False), rpr_of(src_p, True)
    head = re.match(r"<w:p[^>]*>", p).group(0)
    ppr = re.search(r"<w:pPr>.*?</w:pPr>", p, re.S).group(0)
    ppr = re.sub(r'<w:jc w:val="\w+"/>', f'<w:jc w:val="{jc}"/>', ppr)
    ppr = re.sub(r"<w:tabs>.*?</w:tabs>", "", ppr, flags=re.S)
    runs = "".join(
        f'<w:r>{rb if b else rn}<w:t xml:space="preserve">{t}</w:t></w:r>' for b, t in segs
    )
    return head + ppr + runs + "</w:p>"


def process(name, fn):
    zin = zipfile.ZipFile(os.path.join(src, name + ".docx"))
    zout = zipfile.ZipFile(os.path.join(out, name + ".docx"), "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        if item.filename.endswith("/"):
            continue
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            data = fn(data.decode("utf8")).encode("utf8")
        zout.writestr(item, data)
    zout.close()


# ---------------------------------------------------------------- contrato
def contrato(x):
    ps = [m.group(0) for m in paras(x)]
    p1 = ps[1]
    intro = rebuild(p1, [
        (False, "Por este instrumento particular, que entre si fazem a Empresa, "),
        (True, "{{EMPRESA}}"),
        (False, " com sede nesta cidade na {{EMPRESA_ENDERECO}}, neste ato denominada simplesmente &quot;"),
        (True, "EMPREGADORA"),
        (False, "”, e {{O_SR}} "),
        (True, "{{NOME}}"),
        (False, ", {{PORTADOR}} da Carteira Profissional DIGITAL Nº {{CTPS}} - {{CTPS_UF}}, doravante {{CHAMADO}} simplesmente “EMPREGADO”, firmam o presente "
                "Contrato individual de trabalho, em caráter de experiência, conforme a letra “C” parágrafo 2o. do artigo 443 "
                "da Consolidação das Leis do Trabalho, mediante as seguintes condições:"),
    ])
    clausula1 = rebuild(ps[7], [
        (False, "1) "),
        (True, "O Empregado trabalhara para a Empregadora"),
        (False, ", exercendo a Função de "),
        (True, "{{FUNCAO}}"),
        (False, ", recebendo o "),
        (True, "Salário R$ {{SALARIO}} ({{SALARIO_EXTENSO}}) por mês."),
    ])

    def linha(dia):
        def f(p):
            p = sub_in(p, dia, dia)
            p = sub_in(p, "08:00", "{{%s_E}}" % dia)
            p = sub_in(p, "às", "{{%s_AS}}" % dia)
            p = sub_in(p, "18:00", "{{%s_S}}" % dia)
            p = sub_in(p, " 12:00 13:00", " {{%s_I}}" % dia)
            p = sub_in(p, "DOM", "{{REPOUSO}}")
            return p
        return f

    sab = linha("SAB")(ps[19].replace(">SEX<", ">SAB<"))
    plan = {
        1: lambda p: intro, 2: None, 3: None, 4: None, 5: None, 6: None,
        7: lambda p: clausula1, 8: None,
        11: linha("SEG"), 13: linha("TER"), 15: linha("QUA"), 17: linha("QUI"), 19: linha("SEX"),
        21: lambda p: sab,
        22: lambda p: sub_in(p, "........ ", "{{VENCIMENTO}},"),
        41: lambda p: sub_in(p, "VAZ &amp; VOUZELA INDÚSTRIA E COMÉRCIO DE ALIMENTOS LTDA", "{{EMPRESA_MAIUSC}}"),
        63: lambda p: sub_in(p, "VAZ &amp; VOUZELA INDÚSTRIA E COMÉRCIO DE ALIMENTOS LTDA", "{{EMPRESA_MAIUSC}}"),
        46: lambda p: sub_in(p, ".....", "{{NOME}}"),
        68: lambda p: sub_in(p, "..................", "{{NOME}}"),
        50: lambda p: sub_in(sub_in(sub_in(p, "BELEM,", "{{CIDADE_MAIUSC}},"), " ....... de.....", " {{DATA_EXTENSO}}"), " de.....", ""),
        56: lambda p: sub_in(p, " ..................", " {{VENCIMENTO}}"),
        57: lambda p: sub_in(p, "prorrogado até: ___ / ___ / _______", "prorrogado até: {{PRORROGADO_ATE}}"),
    }
    return edit(x, plan)


# ---------------------------------------------------------------- vale-transporte
def vale(x):
    def cel(nome):
        return lambda p: p.replace("</w:p>", f'<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">{{{{{nome}}}}}</w:t></w:r></w:p>')

    def p1(p):
        p = sub_in(p, " ...................", " {{NOME}}")
        p = sub_in(p, ", Brasileiro, ", ", {{NACIONALIDADE}}, ")
        p = sub_in(p, "................", "{{PROFISSAO}}")
        p = sub_in(p, "Estado civil ..................", " estado civil {{ESTADO_CIVIL}}")
        p = sub_in(p, ".................", " {{CPF}}")
        p = sub_in(p, ", registrado com carteira de trabalho", ", {{REGISTRADO}} com carteira de trabalho")
        return p

    plan = {
        1: p1,
        2: lambda p: sub_in(p, "Endereço :", "Endereço: {{END_RUA}}"),
        3: lambda p: sub_in(p, "Nº:", "Nº: {{END_NUM}}"),
        4: lambda p: sub_in(p, "Bairro:", "Bairro: {{END_BAIRRO}}"),
        5: lambda p: sub_in(p, "Cidade: ", "Cidade: {{END_CIDADE}}"),
        6: lambda p: sub_in(p, "CEP: ", "CEP: {{END_CEP}}"),
        7: lambda p: sub_in(p, "Estado: ", "Estado: {{END_UF}}"),
        10: lambda p: sub_in(p, "(       ) NÃO receber vale-transporte;", "( {{VT_NAO}} ) NÃO receber vale-transporte;"),
        11: lambda p: sub_in(p, "(      ) receber vale-transporte, comprometendo-me:", "( {{VT_SIM}} ) receber vale-transporte, comprometendo-me:"),
        44: lambda p: sub_in(p, "FUNCIONÁRIO : ", "FUNCIONÁRIO : {{NOME}}"),
    }
    cols = ["LINHA", "OPER", "TARIFA"]
    for k, base in (("IDA", 21), ("VOLTA", 34)):
        for i in range(9):
            plan[base + i] = cel(f"{k}{i // 3 + 1}_{cols[i % 3]}")
    return edit(x, plan)


# ---------------------------------------------------------------- aviso de término
def encerramento(x):
    plan = {
        1: lambda p: sub_in(p, "Funcionário :", "Funcionário : {{NOME}}"),
        3: lambda p: sub_in(p, "N...............", "Nº {{CTPS}}"),
        5: lambda p: sub_in(sub_in(sub_in(p, ".................. ", "{{INICIO}}"), " ............6", " {{TERMINO}}"), "....................", "{{RETORNO}}"),
        6: lambda p: sub_in(sub_in(p, "Belém, ", "{{CIDADE}}, "), ".... de ......... de .....", "{{DATA_EXTENSO}}"),
        8: lambda p: sub_in(p, "Funcionário:  ", "Funcionário: {{NOME}}"),
        10: lambda p: sub_in(p, "..........", "{{CPF}}"),
    }
    return edit(x, plan)


process("contrato", contrato)
process("vale", vale)
process("encerramento", encerramento)
print("ok")
