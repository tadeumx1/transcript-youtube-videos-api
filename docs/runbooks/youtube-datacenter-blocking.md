# Diagnóstico de bloqueio do YouTube em datacenter

Este runbook separa uma falha da plataforma de uma recusa do YouTube ou outro provedor. Ele não
faz uma transcrição de diagnóstico, não imprime conteúdo do vídeo e não altera configuração. Use
somente os placeholders mostrados e mantenha os limites de tempo e saída.

Evidência read-only na criação deste runbook, em 26 de agosto de 2026: o deployment ativo do
serviço estava `SUCCESS/RUNNING`, com uma réplica e health check em `/health`. Esse registro não
substitui a verificação atual abaixo.

## 1. Plataforma, liveness, readiness e autenticação

Confirme primeiro o contexto, o deployment e as três fronteiras HTTP. Não avance se liveness ou
readiness falhar. Os comandos retornam apenas estado, status HTTP e metadados operacionais
limitados.

```bash
timeout 20s railway status --json | head -c 32768
timeout 20s railway deployment list --service <SERVICE> --limit 3 --json | head -c 32768
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://<API_HOST>/health
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://<API_HOST>/ready
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' -X POST -H 'authorization: Bearer <API_ACCESS_KEY>' -H 'content-type: application/json' --data '{"url":"https://www.youtube.com/watch?v=<VIDEO_ID>"}' https://<API_HOST>/v1/transcripts
```

Interpretação:

- `/health` diferente de 200 ou deployment fora de `SUCCESS/RUNNING`: problema de plataforma ou
  processo, ainda não uma evidência de bloqueio do YouTube.
- `/ready` em 503 com `not_ready`: processo em encerramento; aguarde um deployment saudável.
- `UNAUTHORIZED`: credencial ausente ou incorreta no cliente.
- `API_AUTH_NOT_CONFIGURED`: credencial ausente no serviço.
- HTTP 429 com `TRANSCRIPT_CAPACITY_EXCEEDED`: capacidade cheia. Respeite `Retry-After`.

O POST descarta o body para não imprimir transcrição. Consulte apenas códigos sanitizados nos
logs nas etapas seguintes.

## 2. Recuperação de legendas

Filtre uma janela curta por códigos. O logger da aplicação registra código e status, não URL,
idioma, ID de vídeo, texto ou resposta do provedor.

```bash
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'CAPTIONS_UNAVAILABLE OR VIDEO_NOT_AVAILABLE OR YOUTUBE_UPSTREAM_ERROR' --json | head -c 32768
```

Interpretação:

- `VIDEO_NOT_AVAILABLE`: o vídeo não está publicamente disponível para a aplicação.
- `CAPTIONS_UNAVAILABLE`: nenhuma legenda utilizável foi encontrada; o fallback de áudio pode ser
  iniciado.
- `YOUTUBE_UPSTREAM_ERROR`: a consulta de legendas falhou de forma inesperada. A aplicação não
  entra no fallback nesse caso.

Se o deployment e `/health` estão saudáveis, esses códigos mantêm a falha do YouTube separada da
saúde do Railway.

## 3. Download de áudio com yt-dlp

Faça apenas uma simulação silenciosa para o mesmo vídeo público. O comando imprime somente o exit
code e descarta stdout/stderr, sem salvar áudio, cookies, página ou resposta do YouTube.

```bash
timeout 30s railway ssh --service <SERVICE> -- "timeout 20s sh -c 'yt-dlp --simulate --no-playlist --quiet --no-warnings \"https://www.youtube.com/watch?v=<VIDEO_ID>\" >/dev/null 2>/dev/null; printf \"yt_dlp_exit=%s\\n\" \"\$?\"'" | head -c 4096
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'AUDIO_TOOL_UNAVAILABLE OR AUDIO_EXTRACTION_FAILED OR AUDIO_PROCESS_TIMEOUT' --json | head -c 32768
```

Interpretação:

- `AUDIO_TOOL_UNAVAILABLE`: o executável não iniciou; verifique a imagem, não o YouTube.
- `AUDIO_EXTRACTION_FAILED`: o processo iniciou, mas o download ou processamento falhou.
- `AUDIO_PROCESS_TIMEOUT`: yt-dlp ou FFmpeg excedeu o limite configurado.
- `AUDIO_PROCESS_ABORTED`: shutdown ou cancelamento encerrou o processo.

Um exit code não zero com Railway saudável indica falha do acesso público a partir do egress ou
mudança do YouTube. Ele não autoriza tentar outra identidade ou origem de rede.

## 4. Conversão com FFmpeg

Confirme somente que o binário da imagem inicia. Não leia nem produza mídia durante o diagnóstico.

```bash
timeout 20s railway ssh --service <SERVICE> -- "timeout 10s ffmpeg -version 2>/dev/null | head -n 1" | head -c 4096
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'AUDIO_TOOL_UNAVAILABLE OR AUDIO_EXTRACTION_FAILED OR AUDIO_PROCESS_TIMEOUT OR AUDIO_PROCESS_ABORTED' --json | head -c 32768
```

Se yt-dlp conclui e FFmpeg não inicia, trate como imagem/ferramenta. Se ambos iniciam e aparece
`AUDIO_EXTRACTION_FAILED`, preserve o erro sanitizado e investigue a versão fixada das ferramentas
em um ambiente não produtivo.

## 5. Transcrição com Muse

Verifique somente a presença da configuração, nunca seu valor. Em seguida leia códigos limitados.
Não envie áudio de teste e não imprima body do OpenCode Go.

```bash
timeout 15s railway ssh --service <SERVICE> -- 'timeout 5s sh -c '\''if test -n "$OPENCODE_API_KEY"; then printf "muse_config=configured\n"; else printf "muse_config=missing\n"; fi'\''' | head -c 4096
timeout 20s railway logs --service <SERVICE> --since 15m --lines 100 --filter 'MUSE_AUTHENTICATION_FAILED OR MUSE_QUOTA_EXCEEDED OR MUSE_TIMEOUT OR MUSE_UPSTREAM_UNAVAILABLE OR MUSE_INVALID_RESPONSE' --json | head -c 32768
```

Interpretação:

- `MUSE_AUTHENTICATION_FAILED`: credencial inválida ou sem autorização.
- `MUSE_QUOTA_EXCEEDED`: franquia esgotada; respeite o `Retry-After` validado.
- `MUSE_TIMEOUT`: requisição excedeu o limite configurado.
- `MUSE_UPSTREAM_UNAVAILABLE`: rede ou serviço upstream indisponível.
- `MUSE_INVALID_RESPONSE`: resposta não pôde ser validada.

Esses códigos são falhas do Muse/OpenCode Go, não evidência de bloqueio do YouTube.

## Política de suporte e encerramento

A API suporta somente vídeos públicos acessíveis sem estado de conta. O uso de cookies, proxies residenciais, resolução de CAPTCHA, rotação de IP e contorno de restrições são explicitamente incompatíveis com este serviço e com este runbook.

Durante um incidente:

- não reduza nem desative a autenticação Bearer;
- não aumente nem remova os timeouts;
- não aumente nem remova o limite de concorrência;
- não registre transcript, áudio, Base64, tokens, cookies, bodies de provedor ou IDs/URLs reais;
- não repita automaticamente chamadas ao Muse.

Encerre o diagnóstico com o primeiro estágio comprovadamente falho. Registre apenas horário,
deployment, estágio, status HTTP, código sanitizado e exit code. Se a plataforma está saudável e
o estágio do YouTube falha, preserve essa distinção no incidente em vez de enfraquecer controles.
