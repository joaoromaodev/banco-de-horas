# Folhas de ponto SINTÉTICAS para o comparativo de IA (Sprint 17, frente F).
#
# Nada aqui é dado real: empresa, funcionário e horários são inventados e o
# gabarito (o que está escrito em cada célula) é conhecido. Gera uma folha no
# layout da "FOLHA DE PONTO INDIVIDUAL DE TRABALHO" com os horários em fonte
# manuscrita e quatro variações: limpa, inclinada, borrada e foto torta
# (perspectiva, sombra, ruído e JPEG ruim).
#
# Uso (Pillow instalado; as fontes manuscritas vêm do Windows):
#   python scripts/ia-comparativo/gerar_folhas.py [pasta-de-saida] [semente]
# Saída: <pasta>/<nome>.jpg e <pasta>/gabarito.json. A pasta padrão fica fora do
# repositório (scripts/ia-comparativo/saida/ está no .gitignore).
import json
import os
import random
import sys
import calendar

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTES_WIN = 'C:/Windows/Fonts'
MANUSCRITAS = ['Inkfree.ttf', 'segoepr.ttf', 'segoesc.ttf', 'comic.ttf']
IMPRESSA = 'arial.ttf'
IMPRESSA_NEGRITO = 'arialbd.ttf'

NOMES_FICTICIOS = ['FULANO DE TESTE', 'BELTRANA EXEMPLO', 'CICRANO SINTETICO', 'MARIA MODELO']
MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO',
         'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO']
DIAS_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']


def fonte(nome, tamanho):
    return ImageFont.truetype(os.path.join(FONTES_WIN, nome), tamanho)


def hora(h, m):
    return f'{h:02d}:{m:02d}'


def gerar_dias(rnd, ano, mes):
    """Gabarito: o que fica escrito em cada linha."""
    ndias = calendar.monthrange(ano, mes)[1]
    feriado = rnd.choice([d for d in range(3, ndias) if calendar.weekday(ano, mes, d) < 5])
    especiais = {}
    uteis = [d for d in range(1, ndias + 1) if calendar.weekday(ano, mes, d) < 5 and d != feriado]
    for marcador in ['ATESTADO', 'FALTA']:
        d = rnd.choice(uteis)
        uteis.remove(d)
        especiais[d] = marcador
    dias = []
    for d in range(1, ndias + 1):
        sem = calendar.weekday(ano, mes, d)
        item = {'dia': d, 'entradaManha': None, 'saidaAlmoco': None, 'retornoAlmoco': None,
                'saidaTarde': None, 'marcador': None, 'texto': None}
        if d == feriado:
            item['marcador'] = 'FERIADO'
            item['texto'] = 'FERIADO'
        elif d in especiais:
            item['marcador'] = especiais[d]
            item['texto'] = especiais[d]
        elif sem == 6:
            item['texto'] = 'DOMINGO'
        elif sem == 5:
            # Metade dos sábados com meio expediente, metade só "SÁBADO".
            if rnd.random() < 0.5:
                item['entradaManha'] = hora(rnd.choice([7, 8]), rnd.randint(0, 15))
                item['saidaAlmoco'] = hora(rnd.choice([11, 12]), rnd.randint(0, 10))
            else:
                item['texto'] = 'SÁBADO'
        else:
            e = hora(rnd.choice([7, 7, 8]), rnd.choice([0, rnd.randint(0, 14), 55 - rnd.randint(0, 8)]) % 60)
            sa = hora(rnd.choice([11, 12]), rnd.randint(0, 59))
            r = hora(rnd.choice([13, 13, 14]), rnd.randint(0, 20))
            st = hora(rnd.choice([17, 17, 18]), rnd.randint(0, 59))
            item.update(entradaManha=e, saidaAlmoco=sa, retornoAlmoco=r, saidaTarde=st)
            # Um dia com banco de horas anotado junto dos horários.
            if rnd.random() < 0.08:
                item['marcador'] = 'BANCO DE HORAS'
                item['texto'] = 'BH'
        dias.append(item)
    return dias


def desenhar_folha(rnd, ano, mes, funcionario, dias):
    W, H = 1700, 2300
    img = Image.new('RGB', (W, H), (252, 251, 247))
    dr = ImageDraw.Draw(img)
    f_tit = fonte(IMPRESSA_NEGRITO, 38)
    f_cab = fonte(IMPRESSA, 26)
    f_col = fonte(IMPRESSA_NEGRITO, 20)
    f_dia = fonte(IMPRESSA, 22)

    dr.text((W // 2, 70), 'FOLHA DE PONTO INDIVIDUAL DE TRABALHO', font=f_tit, fill=(20, 20, 20), anchor='mm')
    dr.text((80, 130), 'EMPREGADOR: EMPRESA FICTÍCIA DE TESTE LTDA', font=f_cab, fill=(20, 20, 20))
    dr.text((80, 170), f'EMPREGADO: {funcionario}', font=f_cab, fill=(20, 20, 20))
    dr.text((80, 210), f'MÊS: {MESES[mes - 1]} / {ano}', font=f_cab, fill=(20, 20, 20))
    dr.text((1000, 210), 'HORÁRIO: 07:00 ÀS 17:00', font=f_cab, fill=(20, 20, 20))

    x0, y0 = 60, 270
    colunas = [('DIA', 110), ('ENTRADA\nMANHÃ', 250), ('ALMOÇO\nSAÍDA', 250), ('ALMOÇO\nRETORNO', 250),
               ('SAÍDA\nTARDE', 250), ('ASSINATURA', 470)]
    alt_cab, alt_lin = 70, 60
    largura = sum(c[1] for c in colunas)
    linha = (40, 40, 40)
    # Cabeçalho
    x = x0
    for nome, larg in colunas:
        dr.rectangle([x, y0, x + larg, y0 + alt_cab], outline=linha, width=2)
        dr.multiline_text((x + larg / 2, y0 + alt_cab / 2), nome, font=f_col, fill=(20, 20, 20), anchor='mm', align='center')
        x += larg
    tinta = rnd.choice([(25, 45, 140), (30, 30, 35), (20, 60, 160)])
    manuscrita = rnd.choice(MANUSCRITAS)
    for i, d in enumerate(dias):
        y = y0 + alt_cab + i * alt_lin
        x = x0
        for _, larg in colunas:
            dr.rectangle([x, y, x + larg, y + alt_lin], outline=linha, width=1)
            x += larg
        sem = DIAS_SEMANA[calendar.weekday(ano, mes, d['dia'])]
        dr.text((x0 + 55, y + alt_lin / 2), f"{d['dia']:02d} {sem}", font=f_dia, fill=(20, 20, 20), anchor='mm')
        centros = []
        xc = x0 + colunas[0][1]
        for _, larg in colunas[1:5]:
            centros.append(xc + larg / 2)
            xc += larg
        campos = ['entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde']
        tem_hora = any(d[c] for c in campos)
        for c, cx in zip(campos, centros):
            if d[c]:
                escrever(img, d[c], (cx, y + alt_lin / 2), manuscrita, tinta, rnd)
        if d['texto'] and not tem_hora:
            # Texto escrito por cima das colunas de horário.
            escrever(img, d['texto'], ((centros[0] + centros[3]) / 2, y + alt_lin / 2), manuscrita, tinta, rnd, tam=36)
        elif d['texto']:
            escrever(img, d['texto'], (x0 + largura - 400, y + alt_lin / 2), manuscrita, tinta, rnd, tam=34)
        if tem_hora or d['texto'] in ('FERIADO', 'ATESTADO'):
            # Rubrica na assinatura.
            escrever(img, rnd.choice(['F.T.', 'ft', 'Fulano', 'b.e.']), (x0 + largura - 180, y + alt_lin / 2),
                     manuscrita, tinta, rnd, tam=30)
    return img


def escrever(img, texto, centro, nome_fonte, tinta, rnd, tam=None):
    tam = tam or rnd.randint(32, 40)
    f = fonte(nome_fonte, tam)
    camada = Image.new('RGBA', (tam * len(texto) + 40, tam * 2 + 20), (0, 0, 0, 0))
    dc = ImageDraw.Draw(camada)
    dc.text((20, 10), texto, font=f, fill=tinta + (235,))
    camada = camada.rotate(rnd.uniform(-6, 6), resample=Image.BICUBIC, expand=True)
    bbox = camada.getbbox()
    if bbox:
        camada = camada.crop(bbox)
    cx = centro[0] + rnd.uniform(-14, 14)
    cy = centro[1] + rnd.uniform(-5, 5)
    img.paste(camada, (int(cx - camada.width / 2), int(cy - camada.height / 2)), camada)


def inclinar(img, rnd):
    return img.rotate(rnd.choice([-1, 1]) * rnd.uniform(3, 5), resample=Image.BICUBIC, expand=True, fillcolor=(235, 235, 230))


def borrar(img, rnd):
    return img.filter(ImageFilter.GaussianBlur(radius=rnd.uniform(1.6, 2.2)))


def foto_torta(img, rnd):
    """Simula foto de celular: perspectiva, mesa ao fundo, sombra, ruído, baixa resolução."""
    W, H = img.size
    fundo = Image.new('RGB', (W + 300, H + 300), (120, 95, 70))
    fundo.paste(img, (150, 150))
    W2, H2 = fundo.size
    d = lambda: rnd.uniform(40, 140)
    # Quadrilátero de origem (cantos levemente fora de esquadro) → retângulo.
    quad = (d(), d(), d(), H2 - d(), W2 - d(), H2 - d(), W2 - d(), d())
    foto = fundo.transform((W2, H2), Image.QUAD, quad, resample=Image.BICUBIC)
    foto = foto.rotate(rnd.uniform(-7, 7), resample=Image.BICUBIC, expand=False, fillcolor=(110, 90, 65))
    # Sombra em gradiente (mão/celular).
    sombra = Image.new('L', foto.size, 0)
    ds = ImageDraw.Draw(sombra)
    for i in range(0, foto.width, 4):
        ds.line([(i, 0), (i, foto.height)], fill=int(90 * (i / foto.width) ** 2))
    foto = Image.composite(Image.new('RGB', foto.size, (0, 0, 0)), foto, sombra.point(lambda v: v // 2))
    foto = foto.filter(ImageFilter.GaussianBlur(radius=1.1))
    # Ruído.
    ruido = Image.effect_noise(foto.size, 18).convert('RGB')
    foto = Image.blend(foto, ruido, 0.06)
    return foto.resize((int(foto.width * 0.6), int(foto.height * 0.6)), Image.LANCZOS)


def main():
    saida = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'saida')
    semente = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
    os.makedirs(saida, exist_ok=True)
    rnd = random.Random(semente)
    variacoes = [('limpa', None, 92), ('inclinada', inclinar, 90), ('borrada', borrar, 88), ('foto-torta', foto_torta, 55)]
    gabarito = []
    for i, (nome, efeito, qualidade) in enumerate(variacoes):
        ano, mes = 2026, rnd.choice([3, 4, 5, 6, 8, 9])
        funcionario = NOMES_FICTICIOS[i % len(NOMES_FICTICIOS)]
        dias = gerar_dias(rnd, ano, mes)
        img = desenhar_folha(rnd, ano, mes, funcionario, dias)
        if efeito:
            img = efeito(img, rnd)
        arquivo = f'{i + 1:02d}-{nome}.jpg'
        img.save(os.path.join(saida, arquivo), 'JPEG', quality=qualidade)
        gabarito.append({
            'arquivo': arquivo, 'variacao': nome, 'ano': ano, 'mes': mes, 'funcionario': funcionario,
            'dias': [{k: v for k, v in d.items() if k != 'texto'} for d in dias],
        })
    with open(os.path.join(saida, 'gabarito.json'), 'w', encoding='utf-8') as f:
        json.dump(gabarito, f, ensure_ascii=False, indent=1)
    print(f'{len(gabarito)} folhas em {saida}')


if __name__ == '__main__':
    main()
