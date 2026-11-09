# Omni — transcrição local do WhatsApp (Whisper via faster-whisper, CPU), plano B quando a OpenAI recusa.
# Mesmo contrato do voz.ps1: stdin = áudio em base64 → stdout = {"ok":true,"texto64":"<texto UTF-8 em base64>"}.
# Nada sai da máquina: o áudio não vai para serviço nenhum e o modelo fica em disco.
# Ambiente: %LOCALAPPDATA%\omni\voz-local\venv (python -m venv + pip install faster-whisper);
# modelo em %LOCALAPPDATA%\omni\voz-local\modelos, baixado no primeiro uso. OMNI_WHISPER_MODELO troca o modelo.
# Medido em 29/09/2026 (i5-10500H, int8): small carrega em ~2,6 s e transcreve ~3 s por trecho de 30 s;
# large-v3-turbo acerta um pouco mais a pontuação, mas leva ~10 s por trecho. Com a DICA os dois acertam os nomes.
import base64, io, json, os, sys, warnings

warnings.filterwarnings('ignore')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')

DICA = ('Mensagem de voz de WhatsApp em português do Brasil para o Omni, assistente do Weriton. '
        'Nomes: Omni, Weriton, Xuxinha, Barretos Country, GR Group, Claude, Growth, HostDime.')


def responder(dados):
    sys.stdout.write(json.dumps(dados))
    sys.stdout.flush()


def main():
    try:
        audio = base64.b64decode(sys.stdin.read().strip())
        if len(audio) < 32 or len(audio) > 24 * 1024 * 1024:
            raise ValueError('áudio vazio ou maior que 24 MB')
        from faster_whisper import WhisperModel
        nome = os.environ.get('OMNI_WHISPER_MODELO', 'small')
        pasta = os.path.join(os.environ['LOCALAPPDATA'], 'omni', 'voz-local', 'modelos')
        try:
            modelo = WhisperModel(nome, device='cpu', compute_type='int8', download_root=pasta, local_files_only=True)
        except Exception:
            modelo = WhisperModel(nome, device='cpu', compute_type='int8', download_root=pasta)  # primeiro uso: baixa
        trechos, _ = modelo.transcribe(io.BytesIO(audio), language='pt', vad_filter=True, beam_size=5, initial_prompt=DICA)
        texto = ' '.join(t.text.strip() for t in trechos).strip()
        responder({'ok': True, 'texto64': base64.b64encode(texto.encode('utf-8')).decode('ascii')})
    except Exception as e:
        responder({'ok': False, 'erro': 'transcrição local falhou: ' + str(e)[:300]})


main()
