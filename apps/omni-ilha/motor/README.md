# motor — o rosto do Omni vira de verdade (fatia F1)

A arte inteira (`modelo/texturas/base.png`, 1254×1254) vira uma malha 2,5D de 96×96 vértices.
Cada vértice lê o próprio z (`campos.png`) e os pesos de cabeça, pescoço e ombros (`pesos.png`).
Depois gira em yaw, pitch e roll em torno do pivô (612, 930), com projeção ortográfica, no WebGL2 da GPU.
A cena é uma função pura do tempo: `render(t)`. O simulador anda em passos fixos de 1/240 s, então o
mesmo `t` dá sempre o mesmo quadro, no vivo e no vídeo.

- Molas de 2ª ordem nos ângulos.
- O pescoço segue a cabeça com uma fração do ângulo e 80 ms de atraso; os ombros levam 10% do yaw.
- O cabelo usa duas molas (f 1,2 Hz, ζ 0,35) que atrasam sobre a cabeça.
- A respiração sobe o corpo; na cabeça ela chega 0,25 s depois.
- O idle soma senos lentos em yaw, pitch e roll, sacadas de atenção e respiração, com semente fixa.

## Como rodar

O Electron é o do omni-desktop (v33). `ELECTRON_RUN_AS_NODE` tem de estar fora do ambiente. As janelas nunca aparecem.

```
python -I ferramentas/assar.py                         # assa as texturas (só quando a arte ou o "assar" mudam)
env -u ELECTRON_RUN_AS_NODE <electron.exe> gravar.js tudo
env -u ELECTRON_RUN_AS_NODE <electron.exe> gravar.js giro rasgo          # ou só algumas provas
env -u ELECTRON_RUN_AS_NODE <electron.exe> provas/fumaca-gpu.js          # sanidade: WebGL2 + timer query na GTX 1650
```

`<electron.exe>` = `C:\Users\wp.santos\Documents\Omni\apps\omni-desktop\node_modules\electron\dist\electron.exe`.

Os vídeos vão para `provas/` e os dumps crus para `%TEMP%\omni-motor-cru`. A régua numérica é `ferramentas/medir.py`.

`vivo.html` abre direto no navegador (`file://`). Ele mostra o Omni com o idle sempre ligado, e o mouse puxa o olhar.

## O que cada critério mediu

Todas as provas são medidas em quadros escondidos, renderizados na GTX 1650 (ANGLE D3D11).

| | prova | o que mede | arquivo |
|---|---|---|---|
| a | fidelidade | Pose neutra contra a base premultiplicada, sobre preto e sobre branco. Exige ≥ 99,9% dos pixels com alfa > 0 dentro de 3/255 e PSNR ≥ 45 dB. | `provas/fidelidade.json` |
| b | giro | Distância que o centro do sigilo anda entre yaw −1 e +1 (≥ 70 px). Hausdorff do contorno do rosto (≤ 24 px). Escala local da bochecha do lado do giro (≤ 0,85). | `provas/giro.json` |
| c | rasgo | Pixels com alfa < 200 dentro da silhueta opaca erodida 4 px (deve ser 0). Razão de área por triângulo ≤ 1,6 em 27 poses extremas. Também a cena do giro e o idle quadro a quadro. | `provas/rasgo.json` |
| d | física | No estalo de yaw (t = 5,9 s), o t50 das pontas do cabelo menos o t50 da cabeça deve ficar entre 100 e 250 ms. As pontas devem entrar na faixa de 5% do curso em ≤ 1,5 s. | `provas/fisica.json` |
| e | desempenho | Média do timer query de GPU em 300 quadros a 512² (≤ 3 ms). Inclui também o teto pela parede, com sincronia, e a resolução cheia. | `provas/desempenho.json` |
| f | determinismo | Duas gravações do giro: sha256 de cada quadro e do mp4 (x264 em 1 thread, bitexact). Compara também com a execução anterior. Para o laço, o quadro de t = 8 s (giro) e o de t = 10 s (idle) devem ser iguais ao quadro 0. | `provas/determinismo.json` |
| g | olho do Weriton | Não dá para medir aqui: pendente. | — |

Provas visuais: `prova-idle.mp4` (10 s de idle, o primeiro a ver), `prova-giro.mp4` (8 s), `folha-pose-3x3.png`
(yaw × pitch) e `lado-a-lado.mp4` (o cartão CSS 3D antigo contra a malha, na mesma pose normalizada).

## Escolhas que fogem do texto da síntese

- Scripts clássicos em vez de módulos ES, e os shaders embutidos em `render/shaders.js`. Motivo: `file://` não carrega módulos nem lê `.vert` solto. O `gravar.js` gera o `shaders.js` a partir de `render/*.vert|frag`.
- Ordem do pintor (z de repouso, com a frente da cabeça por último) em vez de depth buffer. Com depth, o alfa premultiplicado das bordas recorta o que fica atrás.
- A premultiplicação roda como passe 0, na própria GPU. O mipmap só liga quando há minificação, para a pose neutra sair com o byte exato.
- O limiar de rasgo é alfa < 200 (fonte opaca = alfa ≥ 200).
- A medida principal da silhueta é o Hausdorff do contorno. A medida por linha (44 px) conta como movimento o deslizar ao longo da borda quase horizontal do queixo; ela fica no JSON como informação.
- Pesos novos no `assar.py`. Uma faixa de pescoço de 230 px substitui o degrau no queixo. O cabelo junto aos ombros interpola pela razão de distâncias. O declive máximo de z ficou em 1,15. Nenhum peso dá degrau em borda, porque um degrau de peso vezes z rasga a malha.
- A respiração em laço usa período `T/round(T/4,2)`, para o laço fechar.
- O transform feedback (posição de cada vértice para as provas) roda sem framebuffer ligado. Com o FBO da base preso, amostrar `u_base` vira laço de realimentação e o WebGL recusa o desenho.
