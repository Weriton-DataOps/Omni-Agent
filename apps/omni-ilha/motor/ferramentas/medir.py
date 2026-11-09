# Mede os quadros que as provas despejaram crus (o motor roda na GPU; a régua roda aqui, em numpy).
# Uso (chamado pelas provas): python -I ferramentas/medir.py <prova> <pasta_cru> [arg]
#   fidelidade  pose neutra vs base premultiplicada, sobre preto e sobre branco
#   rasgo       alfa dentro da silhueta opaca erodida e razão de área por triângulo
#   giro        andar do sigilo, andar da silhueta do rosto, escala local da bochecha
#   folha       monta folha-pose-3x3.png com rótulos
# Imprime o resultado em JSON na última linha.
import site, sys
sys.path.append(site.getusersitepackages())
import json, math, os
import numpy as np
import cv2

AQUI = os.path.dirname(os.path.abspath(__file__))
MOTOR = os.path.dirname(AQUI)
TEX = os.path.join(MOTOR, 'modelo', 'texturas')


def base_bgra():
    return cv2.imread(os.path.join(TEX, 'base.png'), cv2.IMREAD_UNCHANGED)


def le(pasta, nome, forma, tipo=np.uint8):
    return np.fromfile(os.path.join(pasta, nome), dtype=tipo).reshape(forma)


def psnr(dif):
    mse = float(np.mean(dif.astype(np.float64) ** 2))
    return ('inf' if mse == 0 else round(10 * math.log10(255.0 ** 2 / mse), 3)), mse


def fidelidade(pasta):
    b = base_bgra()
    H, W = b.shape[:2]
    a = b[:, :, 3].astype(np.int32)
    rgb = b[:, :, 2::-1].astype(np.int32)  # BGR -> RGB
    pre = np.floor(rgb * a[:, :, None] / 255.0 + 0.5).astype(np.int32)  # sem empate possível (255 é ímpar)
    tinta = a > 0
    saida = {'pixelsComAlfa': int(tinta.sum()), 'fracaoComAlfa': round(float(tinta.mean()), 4)}
    for nome, arq, ref in [('sobrePreto', 'fid-transp.rgba', pre), ('sobreBranco', 'fid-branco.rgba', pre + 255 - a[:, :, None])]:
        r = le(pasta, arq, (H, W, 4)).astype(np.int32)
        d = np.abs(r[:, :, :3] - ref)[tinta]
        dmax = d.max(axis=1)
        p, mse = psnr(d)
        hist = np.bincount(dmax, minlength=4)
        saida[nome] = {
            'fracaoAte3': round(float((dmax <= 3).mean()), 6),
            'difMax': int(dmax.max()), 'difMedia': round(float(d.mean()), 5),
            'pixelsIguais': int((dmax == 0).sum()), 'pixelsDif1': int(hist[1]), 'pixelsDif2': int(hist[2]), 'pixelsDif3': int(hist[3]),
            'pixelsDifMaior3': int((dmax > 3).sum()), 'psnrDb': p, 'mse': mse,
        }
        if nome == 'sobrePreto':
            da = np.abs(r[:, :, 3] - a)[tinta]
            saida[nome]['alfaDifMax'] = int(da.max())
    ok = all(saida[k]['fracaoAte3'] >= 0.999 and (saida[k]['psnrDb'] == 'inf' or saida[k]['psnrDb'] >= 45) for k in ('sobrePreto', 'sobreBranco'))
    saida['criterio'] = 'dif <= 3/255 em >= 99,9% dos pixels com alfa > 0 e PSNR >= 45 dB, sobre preto e sobre branco'
    saida['passou'] = bool(ok)
    return saida


def triangulos(nx, ny):
    t = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i; b = a + 1; c = a + nx; d = c + 1
            t.append((a, b, c)); t.append((b, d, c))
    return np.array(t, np.int64)


def area(p, tri):
    a, b, c = p[tri[:, 0]], p[tri[:, 1]], p[tri[:, 2]]
    return 0.5 * ((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))


def rasgo(pasta):
    man = json.load(open(os.path.join(pasta, 'rasgo-manifesto.json'), encoding='utf-8'))
    W, H = man['W'], man['H']
    xs, ys = np.array(man['xs']), np.array(man['ys'])
    nx, ny = len(xs), len(ys)
    gx, gy = np.meshgrid(xs, ys)
    rep = np.stack([gx.ravel(), gy.ravel()], 1)
    tri = triangulos(nx, ny)
    a0 = area(rep, tri)
    # triângulo "com tinta": algum pixel da célula em repouso com alfa >= 16 (caixa da célula: conservador)
    alfa = base_bgra()[:, :, 3]
    tinta_cel = np.zeros((ny - 1, nx - 1), bool)
    for j in range(ny - 1):
        y0, y1 = int(math.floor(ys[j])), int(math.ceil(ys[j + 1]))
        for i in range(nx - 1):
            x0, x1 = int(math.floor(xs[i])), int(math.ceil(xs[i + 1]))
            tinta_cel[j, i] = alfa[y0:y1, x0:x1].max() >= 16
    tinta = np.repeat(tinta_cel.ravel(), 2)
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))  # raio 4 px
    poses = []
    pior = {'razaoMax': 0, 'razaoMin': 9, 'invertidos': 0, 'pixelsRasgo': 0}
    for k, pose in enumerate(man['poses']):
        tf = le(pasta, f'rasgo-{k}-tf.f32', (-1, 6), np.float32).astype(np.float64)
        r = area(tf[:, :2], tri) / a0
        rt = r[tinta]
        alf = le(pasta, f'rasgo-{k}-alfa.u8', (H, W))
        opa = le(pasta, f'rasgo-{k}-opaco.u8', (H, W)) >= 128
        dentro = cv2.erode(opa.astype(np.uint8), nucleo) > 0
        buraco = dentro & (alf < 200)
        ys_, xs_ = np.nonzero(buraco)
        item = {
            'pose': pose, 'razaoMax': round(float(rt.max()), 4), 'razaoMin': round(float(rt.min()), 4),
            'invertidos': int((rt <= 0).sum()), 'pixelsDentro': int(dentro.sum()), 'pixelsRasgo': int(buraco.sum()),
        }
        if len(xs_):
            item['exemploRasgo'] = [int(xs_[0]), int(ys_[0])]
        imax = int(np.argmax(np.where(tinta, r, -9)))
        item['triPiorCentro'] = [round(float(rep[tri[imax]].mean(0)[0]), 1), round(float(rep[tri[imax]].mean(0)[1]), 1)]
        poses.append(item)
        pior['razaoMax'] = max(pior['razaoMax'], item['razaoMax'])
        pior['razaoMin'] = min(pior['razaoMin'], item['razaoMin'])
        pior['invertidos'] += item['invertidos']
        pior['pixelsRasgo'] += item['pixelsRasgo']
    pior['passou'] = bool(pior['razaoMax'] <= 1.6 and pior['pixelsRasgo'] == 0 and pior['invertidos'] == 0)
    # cenas dos vídeos, quadro a quadro (molas, atraso do pescoço e cabelo inclusos)
    dinamico = {}
    for nome in ('giro', 'idle'):
        f = os.path.join(pasta, f'rasgo-dinamico-{nome}.f32')
        if not os.path.exists(f):
            continue
        xy = np.fromfile(f, np.float32).astype(np.float64).reshape(-1, nx * ny, 2)
        rq = np.array([area(q, tri)[tinta] / a0[tinta] for q in xy])
        qmax = int(np.argmax(rq.max(1)))
        dinamico[nome] = {'quadros': int(len(xy)), 'razaoMax': round(float(rq.max()), 4), 'razaoMin': round(float(rq.min()), 4),
                          'invertidos': int((rq <= 0).sum()), 'quadroPior': qmax}
    pior['dinamico'] = dinamico
    pior['passouDinamico'] = bool(all(d['razaoMax'] <= 1.6 and d['invertidos'] == 0 for d in dinamico.values()))
    return {'graus': man['graus'], 'trianguloComTinta': int(tinta.sum()), 'triangulos': int(len(tri)), 'resumo': pior, 'poses': poses,
            'criterio': 'zero pixels com alfa < 200 dentro da fonte opaca (alfa >= 200) deformada e erodida 4 px; razão de área <= 1,6 nos triângulos com tinta (alfa >= 16), nas 27 poses {-1,0,1}^3'}


def giro(pasta):
    man = json.load(open(os.path.join(pasta, 'giro-manifesto.json'), encoding='utf-8'))
    W, H = man['W'], man['H']
    xs, ys = np.array(man['xs']), np.array(man['ys'])
    nx = len(xs)
    res = {}
    cent, bordas = {}, {}
    for nome in ('menos', 'zero', 'mais'):
        s = le(pasta, f'giro-{nome}-sig.u8', (H, W)).astype(np.float64)
        s = np.where(s >= 128, s, 0)
        yy, xx = np.nonzero(s)
        w = s[yy, xx]
        cent[nome] = [float((xx * w).sum() / w.sum()), float((yy * w).sum() / w.sum())]
        r = le(pasta, f'giro-{nome}-rosto.u8', (H, W)) >= 128
        e = np.full(H, np.nan); d = np.full(H, np.nan)
        for y in range(H):
            lin = np.nonzero(r[y])[0]
            if len(lin) > 20:
                e[y] = lin[0]; d[y] = lin[-1]
        bordas[nome] = (e, d)
    dx = cent['mais'][0] - cent['menos'][0]
    dy = cent['mais'][1] - cent['menos'][1]
    res['sigilo'] = {'centroMenos': [round(v, 2) for v in cent['menos']], 'centroZero': [round(v, 2) for v in cent['zero']],
                     'centroMais': [round(v, 2) for v in cent['mais']], 'andaPx': round(math.hypot(dx, dy), 2), 'andaX': round(dx, 2)}
    em, dm = bordas['menos']; ep, dp = bordas['mais']
    ok = ~np.isnan(em) & ~np.isnan(ep) & ~np.isnan(dm) & ~np.isnan(dp)
    de = np.abs(ep - em)[ok]; dd = np.abs(dp - dm)[ok]
    tudo = np.concatenate([de, dd])
    # centro da silhueta (meio entre as bordas, por linha): quanto o contorno do rosto anda como um todo
    meio = (((ep + dp) / 2) - ((em + dm) / 2))[ok]
    # régua principal: distância de Hausdorff simétrica entre os contornos (yaw -1 vs +1). A régua por linha
    # mede o deslize AO LONGO de uma borda quase horizontal (o queixo) como se fosse andar da silhueta; o
    # contorno mede quanto a forma de fato se desloca.
    def contorno(mk):
        u = mk.astype(np.uint8)
        return (u - cv2.erode(u, np.ones((3, 3), np.uint8))) > 0
    rm = le(pasta, 'giro-menos-rosto.u8', (H, W)) >= 128
    rp = le(pasta, 'giro-mais-rosto.u8', (H, W)) >= 128
    cm, cp = contorno(rm), contorno(rp)
    dist = lambda c: cv2.distanceTransform((~c).astype(np.uint8), cv2.DIST_L2, 5)
    d1 = dist(cp)[cm]; d2 = dist(cm)[cp]
    dd_ = np.concatenate([d1, d2])
    yy, xx = np.nonzero(cm)
    k = int(np.argmax(d1))
    res['silhueta'] = {
        'hausdorffPx': round(float(dd_.max()), 2), 'contornoMedioPx': round(float(dd_.mean()), 2),
        'contornoP95Px': round(float(np.percentile(dd_, 95)), 2), 'piorPonto': [int(xx[k]), int(yy[k])],
        'porLinha': {
            'linhas': int(ok.sum()), 'bordaEsqMediaPx': round(float(de.mean()), 2), 'bordaDirMediaPx': round(float(dd.mean()), 2),
            'bordaMaxPx': round(float(tudo.max()), 2), 'bordaP95Px': round(float(np.percentile(tudo, 95)), 2),
            'centroMedioPx': round(float(np.abs(meio).mean()), 2), 'centroMaxPx': round(float(np.abs(meio).max()), 2),
        },
    }
    # escala local da bochecha: derivada dx'/dx na malha deformada, em volta do ponto
    def escala(nome, px, py):
        tf = le(pasta, f'giro-{nome}-tf.f32', (-1, 6), np.float32).astype(np.float64)
        i = int(np.argmin(np.abs(xs - px))); j = int(np.argmin(np.abs(ys - py)))
        vals = []
        for jj in (j - 1, j, j + 1):
            for ii in (i - 1, i, i + 1):
                a = jj * nx + ii - 1; b = jj * nx + ii + 1
                vals.append((tf[b, 0] - tf[a, 0]) / (xs[ii + 1] - xs[ii - 1]))
        return {'ponto': [px, py], 'vertice': [float(xs[i]), float(ys[j])], 'escala': round(float(np.mean(vals)), 4), 'escalaMax3x3': round(float(np.max(vals)), 4)}
    bx, by = man['bochecha']
    res['bochecha'] = {'yawMais_ladoDireito': escala('mais', bx, by), 'yawMenos_ladoEsquerdo': escala('menos', 2 * man['pivo'][0] - bx, by)}
    esc = max(res['bochecha']['yawMais_ladoDireito']['escala'], res['bochecha']['yawMenos_ladoEsquerdo']['escala'])
    res['passou'] = bool(res['sigilo']['andaPx'] >= 70 and res['silhueta']['hausdorffPx'] <= 24 and esc <= 0.85)
    res['criterio'] = ('sigilo anda >= 70 px entre yaw -1 e +1; silhueta do rosto anda <= 24 px (Hausdorff simétrico entre os '
                       'contornos, pior ponto; a régua por linha vai junto em porLinha); escala local da bochecha do lado do giro <= 0,85')
    return res


def folha(pasta):
    man = json.load(open(os.path.join(pasta, 'folha-manifesto.json'), encoding='utf-8'))
    W, H = man['W'], man['H']
    img = le(pasta, 'folha.rgba', (H, W, 4))
    bgr = np.ascontiguousarray(img[:, :, 2::-1])
    for c in man['celulas']:
        x, y, w, h = c['caixa']
        cv2.putText(bgr, c['rotulo'], (x + 12, y + h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 210, 225), 1, cv2.LINE_AA)
    cv2.imwrite(man['saida'], bgr, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    return {'saida': man['saida']}


if __name__ == '__main__':
    prova, pasta = sys.argv[1], sys.argv[2]
    r = {'fidelidade': fidelidade, 'rasgo': rasgo, 'giro': giro, 'folha': folha}[prova](pasta)
    print(json.dumps(r, ensure_ascii=False))
