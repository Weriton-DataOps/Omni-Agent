# Assa as texturas do motor a partir da base.png (roda uma vez por versão da arte).
# Uso: python -I ferramentas/assar.py
# Sai em modelo/texturas/:
#   mascaras.png      R obsidiana (rosto+corpo+orelhas, pena 7 px), G cabelo, B (gola: F2), A raiz->ponta do cabelo
#   profundidade.png  16 bits, z = v/escala + zmin (px; +z sai da tela)
#   sigilo.png        R núcleo do traço, G halo (sigma 18)
#   campos.png        runtime: R,G = z em 16 bits (alto, baixo), B = ponta do cabelo
#   pesos.png         runtime: R cabeça, G pescoço, B respiração do corpo (x4 px)
#   regioes.png       runtime: R rosto (sem pena), G núcleo do sigilo, B fonte opaca (alfa >= 200)
#   pacote.js         as PNGs do runtime em data URL (file:// não deixa a página ler PNG solta na GPU)
#   assado.json       números do assado, para as provas
import site, sys
sys.path.append(site.getusersitepackages())
import base64, json, os, re, time
import numpy as np
import cv2

AQUI = os.path.dirname(os.path.abspath(__file__))
MOTOR = os.path.dirname(AQUI)
MODELO = json.load(open(os.path.join(MOTOR, 'modelo', 'omni.modelo.json'), encoding='utf-8'))
TEX = os.path.join(MOTOR, 'modelo', 'texturas')
G = MODELO['geometria']
A = MODELO['assar']
W, H = MODELO['tamanho']


def caminho(d, passos=32):
    """Path SVG (M/L/C/Z absolutos) -> polígono em px."""
    tok = re.findall(r'[MCLZ]|-?[0-9.]+', d)
    pts, i, cur, cmd = [], 0, None, None
    while i < len(tok):
        if tok[i] in 'MCLZ':
            cmd = tok[i]; i += 1
            if cmd == 'Z':
                break
            continue
        if cmd in 'ML':
            cur = np.array([float(tok[i]), float(tok[i + 1])]); pts.append(cur); i += 2
        elif cmd == 'C':
            c1 = np.array([float(tok[i]), float(tok[i + 1])]); c2 = np.array([float(tok[i + 2]), float(tok[i + 3])])
            e = np.array([float(tok[i + 4]), float(tok[i + 5])]); i += 6
            t = np.linspace(0, 1, passos)[1:, None]
            pts.extend((1 - t) ** 3 * cur + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * e)
            cur = e
    return np.array(pts)


def preenche(d):
    m = np.zeros((H, W), np.uint8)
    # subpixel (shift=4) para o contorno não andar meio pixel
    cv2.fillPoly(m, [np.round(caminho(d) * 16).astype(np.int32)], 255, cv2.LINE_8, shift=4)
    return m.astype(np.float32) / 255


def elipse(cx, cy, rx, ry):
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(cx), int(cy)), (int(rx), int(ry)), 0, 0, 360, 255, -1)
    return m.astype(np.float32) / 255


def borra(x, s):
    if s <= 0:
        return x
    return cv2.GaussianBlur(x, (0, 0), s, borderType=cv2.BORDER_REPLICATE)


def suave(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lipschitz(z, declive, iteracoes):
    """Maior função <= z com declive <= `declive` px/px (inf-convolução com cone, chanfro 8-vizinhos).
    Tira as quinas de profundidade que rasgariam a malha no giro."""
    z = z.copy()
    d1, d2 = declive, declive * np.sqrt(2)
    for _ in range(iteracoes):
        p = np.pad(z, 1, mode='edge')
        v = np.minimum.reduce([
            p[1:-1, :-2] + d1, p[1:-1, 2:] + d1, p[:-2, 1:-1] + d1, p[2:, 1:-1] + d1,
            p[:-2, :-2] + d2, p[:-2, 2:] + d2, p[2:, :-2] + d2, p[2:, 2:] + d2, z])
        if np.array_equal(v, z):
            break
        z = v
    return z


def geodesica(semente, dentro, maximo):
    """Distância geodésica (em px da meia resolução) da semente, andando só por `dentro`."""
    dist = np.full(semente.shape, np.inf, np.float32)
    atual = semente.astype(np.uint8)
    dist[semente > 0] = 0
    cruz = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    quad = np.ones((3, 3), np.uint8)
    dentro8 = dentro.astype(np.uint8)
    for k in range(1, maximo + 1):
        # alterna cruz e quadrado: frente quase octogonal (mais perto da euclidiana)
        nova = cv2.dilate(atual, cruz if k % 2 else quad) & dentro8
        frente = (nova > 0) & ~np.isfinite(dist)
        if not frente.any():
            break
        dist[frente] = k * (1.0 if k % 2 else 1.0)
        atual = nova
    return dist


def salva_png(nome, img):
    caminho_ = os.path.join(TEX, nome)
    ok = cv2.imwrite(caminho_, img, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    assert ok, nome
    return caminho_


def main():
    t0 = time.time()
    base = cv2.imread(os.path.join(TEX, 'base.png'), cv2.IMREAD_UNCHANGED)  # BGRA
    assert base.shape == (H, W, 4), base.shape
    alfa = base[:, :, 3].astype(np.float32) / 255
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    E = G['elipsoide']

    # ---------- regiões ----------
    rosto = preenche(G['rosto'])
    corpo = preenche(G['corpo'])
    pescoco = np.clip(preenche(G['pescoco']) - rosto, 0, 1)
    orelhas = np.clip(sum(elipse(*o) for o in G['orelhas']), 0, 1)
    cabeca = np.clip(rosto + orelhas, 0, 1)
    obsid = np.clip(rosto + corpo + orelhas, 0, 1)
    obsid_pena = np.clip(borra(obsid, A['pena']), 0, 1)
    cabelo = np.clip(alfa * (1 - obsid_pena), 0, 1)
    tronco = np.clip(corpo + pescoco, 0, 1)

    # ---------- profundidade ----------
    u = (xx - E['cx']) / E['rx']; v = (yy - E['cy']) / E['ry']
    z_elip = E['rz'] * np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
    # pescoço: cilindro vertical achatado; meia largura cresce para a gola
    rn = np.interp(yy, [836, 960, 1010], [95, 140, 160])
    dxn = np.clip(np.abs(xx - G['pivo'][0]) / rn, 0, 1)
    z_pesc = 0.5 * rn * np.sqrt(1 - dxn * dxn)
    # ombros: plano inclinado 8 graus (topo mais para trás)
    z_omb = 30 + (yy - 1000) * np.tan(np.radians(A['ombroGraus']))
    z_tronco = z_pesc + (z_omb - z_pesc) * suave(950, 1020, yy)
    # cabelo e fundo: atrás do crânio, mais fundo quanto mais longe dele
    d_cab = cv2.distanceTransform((cabeca < 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    z_cab = -A['cabeloK'] * np.minimum(d_cab, A['cabeloZMax'] / A['cabeloK'])
    # orelhas: leve relevo
    z_orel = np.zeros_like(z_elip)
    for (ox, oy, orx, ory) in G['orelhas']:
        r2 = ((xx - ox) / orx) ** 2 + ((yy - oy) / ory) ** 2
        z_orel = np.maximum(z_orel, 10 * np.sqrt(np.clip(1 - r2, 0, 1)))
    z = np.where(tronco > 0.5, z_tronco, z_cab)
    z = np.where(orelhas > 0.5, np.maximum(z_orel, z), z)
    # o queixo fica na frente do pescoço: max dos dois dentro do rosto
    z = np.where(rosto > 0.5, np.maximum(z_elip, np.where(tronco > 0.5, z_tronco, -1e9)), z)
    # declive máximo (meia resolução, depois volta)
    meia = cv2.resize(z, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    meia = lipschitz(meia, A['declive'] * 2, 400)
    z_lip = cv2.resize(meia, (W, H), interpolation=cv2.INTER_LINEAR)
    z_lip = np.minimum(z_lip, z + 0.0)  # nunca acima do original
    z_fim = borra(z_lip, A['suaveZ']).astype(np.float32)
    gy_, gx_ = np.gradient(z_fim)
    declive_max = float(np.sqrt(gx_ ** 2 + gy_ ** 2)[alfa > 0.03].max())

    # ---------- pesos ----------
    # Nenhum peso pode saltar numa borda: um salto de peso vezes o z da borda vira rasgo/dobra no giro.
    #  - tronco: o pescoço logo abaixo da mandíbula acompanha a cabeça e solta numa faixa (faixaPescoco px);
    #  - cabelo: peso 1 na zona da cabeça (cabeça + cabelo acima de cabeloTopo), o do tronco encostado nele, degradê no vão.
    y0 = A['cabeloTopo']
    faixa = 1 - suave(0, A['faixaPescoco'], d_cab)                    # 1 colado na cabeça, 0 longe
    m_pesc = borra((pescoco > 0.5).astype(np.float32), A['suavePesos'])
    wc_t = faixa
    wn_t = m_pesc * (1 - faixa)
    # peso do tronco esticado para fora: o valor do pixel de tronco mais próximo
    d_tr, rot = cv2.distanceTransformWithLabels((tronco < 0.5).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zeros = np.nonzero((tronco < 0.5).ravel() == 0)[0]                 # rótulo k -> k-ésimo pixel de tronco
    vc = np.concatenate([[0], wc_t.ravel()[zeros]]); vn = np.concatenate([[0], wn_t.ravel()[zeros]])
    assert np.allclose(vc[rot][tronco > 0.5], wc_t[tronco > 0.5]), 'rótulos fora da ordem de varredura'
    wc_ext = borra(vc[rot].astype(np.float32), 6); wn_ext = borra(vn[rot].astype(np.float32), 6)
    # cabelo: interpola entre a "zona da cabeça" (cabeça + cabelo acima de y0, peso 1) e o tronco (peso dele)
    # pela fração das distâncias; o degradê ocupa o vão inteiro entre os dois, sem degrau.
    zona = (cabeca > 0.5) | ((tronco < 0.5) & (yy < y0))
    d_zona = cv2.distanceTransform((~zona).astype(np.uint8), cv2.DIST_L2, 5)
    solta = suave(0, 1, d_tr / np.maximum(d_tr + d_zona, 1e-3))
    wc_h = wc_ext + (1 - wc_ext) * solta
    wn_h = wn_ext * (1 - solta)
    wc = np.where(cabeca > 0.5, 1.0, np.where(tronco > 0.5, wc_t, wc_h)).astype(np.float32)
    wn = np.where(cabeca > 0.5, 0.0, np.where(tronco > 0.5, wn_t, wn_h)).astype(np.float32)
    wc = borra(wc, A['suavePesos']); wn = borra(wn, A['suavePesos'])
    # o rosto todo gira com a cabeça (colado nele a faixa já vale ~1: forçar não cria degrau)
    wc = np.where(rosto > 0.5, 1.0, wc)
    wn = np.where(rosto > 0.5, 0.0, wn)
    soma = np.maximum(wc + wn, 1.0)
    wc = wc / soma; wn = wn / soma
    # respiração do corpo: 4 px na ponta do ombro, 3 px na gola, some na borda de baixo
    # (guardado em fração de `ombros`; o shader multiplica por rig.respira.ombros)
    RS = MODELO['rig']['respira']
    larg = np.clip(np.abs(xx - G['pivo'][0]) / 420, 0, 1)
    resp = (RS['gola'] + (RS['ombros'] - RS['gola']) * larg) / RS['ombros'] * (1 - suave(1150, 1254, yy))

    # ---------- ponta do cabelo (geodésica a partir do crânio) ----------
    h2, w2 = H // 2, W // 2
    semente = cv2.resize((cv2.dilate((cabeca > 0.5).astype(np.uint8), np.ones((13, 13), np.uint8))), (w2, h2), interpolation=cv2.INTER_NEAREST)
    dentro = cv2.resize(((alfa > 0.1) & (tronco < 0.5)).astype(np.uint8), (w2, h2), interpolation=cv2.INTER_NEAREST) | semente
    dg = geodesica(semente, dentro, 700) * 2
    de = cv2.resize(d_cab, (w2, h2), interpolation=cv2.INTER_AREA)
    dg = np.where(np.isfinite(dg), dg, de)
    dg = cv2.resize(dg, (W, H), interpolation=cv2.INTER_LINEAR)
    pa, pb = A['pontaCabelo']
    ponta = suave(pa, pb, np.where(alfa > 0.1, dg, d_cab))
    ponta = np.where(cabeca > 0.5, 0, ponta)
    ponta = np.clip(borra(ponta.astype(np.float32), A['suavePonta']), 0, 1)
    ponta = np.where(cabeca > 0.5, 0, ponta)

    # ---------- sigilo ----------
    b, g, r = [base[:, :, k].astype(np.float32) for k in range(3)]
    lum = (0.299 * r + 0.587 * g + 0.114 * b)
    caixa = (np.abs(xx - G['sigilo'][0]) < 72) & (yy > 478) & (yy < 680)
    nucleo = np.clip((lum - 120) / 80, 0, 1) * (b > 180) * caixa * rosto
    nucleo = nucleo.astype(np.float32)
    halo = borra(nucleo, 18)
    halo = halo / max(1e-6, halo.max())
    ys, xs = np.nonzero(nucleo > 0.5)
    w_ = nucleo[ys, xs]
    centro_sigilo = [float((xs * w_).sum() / w_.sum()), float((ys * w_).sum() / w_.sum())]
    # centro do anel: pixels do núcleo fora da faixa do traço vertical
    anel = (nucleo > 0.5) & (np.abs(xx - G['sigilo'][0]) > 8)
    ys2, xs2 = np.nonzero(anel)
    centro_anel = [float(xs2.mean()), float(ys2.mean())]

    # ---------- grava ----------
    u8 = lambda x: np.clip(np.round(x * 255), 0, 255).astype(np.uint8)
    P = MODELO['profundidade']
    zq = np.clip(np.round((z_fim - P['zmin']) * P['escala']), 0, 65535).astype(np.uint16)
    salva_png('profundidade.png', zq)
    # mascaras: OpenCV grava BGRA
    salva_png('mascaras.png', np.dstack([np.zeros_like(alfa, np.uint8), u8(cabelo), u8(obsid_pena), u8(ponta)]))
    salva_png('sigilo.png', np.dstack([np.zeros_like(alfa, np.uint8), u8(halo), u8(nucleo), np.full_like(zq, 255, np.uint8)]))
    um = np.full((H, W), 255, np.uint8)
    salva_png('campos.png', np.dstack([u8(ponta), (zq & 255).astype(np.uint8), (zq >> 8).astype(np.uint8), um]))
    salva_png('pesos.png', np.dstack([u8(resp), u8(wn), u8(wc), um]))
    opaco = (base[:, :, 3] >= 200).astype(np.float32)
    salva_png('regioes.png', np.dstack([u8(opaco), u8(nucleo), u8(rosto), um]))

    pacote = {}
    for nome in ['base', 'campos', 'pesos', 'regioes']:
        dados = open(os.path.join(TEX, nome + '.png'), 'rb').read()
        pacote[nome] = 'data:image/png;base64,' + base64.b64encode(dados).decode('ascii')
    with open(os.path.join(TEX, 'pacote.js'), 'w', encoding='utf-8') as f:
        f.write('// gerado por ferramentas/assar.py — não editar à mão\n')
        f.write('window.OMNI_TEXTURAS = ' + json.dumps(pacote) + ';\n')
    with open(os.path.join(TEX, 'pacote-modelo.js'), 'w', encoding='utf-8') as f:
        f.write('// gerado por ferramentas/assar.py — cópia do omni.modelo.json para file://\n')
        f.write('window.OMNI_MODELO = ' + json.dumps(MODELO, ensure_ascii=False) + ';\n')

    info = {
        'z': {'min': float(z_fim[alfa > 0.03].min()), 'max': float(z_fim.max()), 'decliveMax': declive_max},
        'zSigilo': float(z_fim[int(round(centro_sigilo[1])), int(round(centro_sigilo[0]))]),
        'centroSigilo': centro_sigilo, 'centroAnel': centro_anel,
        'pixelsNucleo': int((nucleo > 0.5).sum()),
        'cabeloFracao': float((cabelo > 0.1).mean()),
        'segundos': round(time.time() - t0, 2),
    }
    json.dump(info, open(os.path.join(TEX, 'assado.json'), 'w', encoding='utf-8'), indent=2)
    print(json.dumps(info))

    # folha de diagnóstico (scratch): z, pesos, ponta, sigilo
    if len(sys.argv) > 1:
        zn = u8((z_fim - z_fim.min()) / (z_fim.max() - z_fim.min()))
        diag = np.hstack([cv2.applyColorMap(zn, cv2.COLORMAP_TURBO),
                          np.dstack([u8(wn), u8(wc), u8(resp)]),
                          cv2.applyColorMap(u8(ponta), cv2.COLORMAP_VIRIDIS),
                          np.dstack([u8(halo), u8(nucleo), u8(cabelo)])])
        cv2.imwrite(sys.argv[1], cv2.resize(diag, (diag.shape[1] // 3, diag.shape[0] // 3), interpolation=cv2.INTER_AREA))


if __name__ == '__main__':
    main()
