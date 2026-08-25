# API híbrida de transcrição do YouTube

API em Node.js, Fastify e TypeScript que recebe a URL de um vídeo público do YouTube,
prioriza suas legendas e, quando elas não estão disponíveis, extrai o áudio e usa o modelo
`gpt-transcribe` da OpenAI. As duas origens produzem o mesmo JSON e o mesmo PDF pesquisável,
prontos para serem usados como fonte de um fluxo RAG.

## Como funciona

1. Valida a URL e a transforma no formato canônico do YouTube.
2. Procura legendas na ordem solicitada, usando por padrão `pt-BR`, `pt` e `en`.
3. Somente quando não há legenda utilizável, baixa o áudio com `yt-dlp`.
4. O FFmpeg converte o áudio em MP3 mono, 16 kHz e 48 kbps, dividido em blocos de 20 minutos.
5. Envia cada bloco sequencialmente ao `gpt-transcribe` e remove os arquivos temporários.
6. Retorna o contrato unificado como JSON ou gera um PDF pesquisável com metadados de origem.

O fallback pago não é usado quando as legendas funcionam e não é acionado para erros inesperados
do YouTube.

## ChatGPT e faturamento da API

O plano ChatGPT Free, Go, Plus, Pro, Business ou Enterprise **não fornece saldo para esta API**.
ChatGPT e API Platform têm faturamentos separados, conforme a
[documentação oficial de cobrança](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform).

Para usar o fallback de áudio:

1. Crie ou acesse um projeto em [platform.openai.com](https://platform.openai.com/).
2. Configure o faturamento desse projeto na API Platform.
3. Crie uma API key do projeto.
4. Defina a chave apenas no servidor como `OPENAI_API_KEY`.

Sem essa chave, vídeos com legenda continuam funcionando. Um vídeo sem legenda recebe HTTP 503
com `AUDIO_FALLBACK_NOT_CONFIGURED`. Consulte também o
[guia oficial de speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text)
e os [preços atuais da API](https://developers.openai.com/api/docs/pricing).

## Requisitos locais

- Node.js 22 ou superior
- `yt-dlp`
- FFmpeg
- Uma API key da OpenAI Platform somente para vídeos sem legenda

O Dockerfile já instala os dois executáveis de mídia. Para desenvolvimento sem Docker, confirme:

```bash
node --version
yt-dlp --version
ffmpeg -version
```

## Configuração

```bash
npm ci
cp .env.example .env
```

O projeto não carrega `.env` automaticamente. Exporte as variáveis no shell, use seu gerenciador de
segredos ou execute com Docker usando `--env-file`.

| Variável | Obrigatória | Padrão | Uso |
| --- | --- | --- | --- |
| `HOST` | não | `0.0.0.0` | Endereço em que o Fastify escuta. |
| `PORT` | não | `3000` | Porta TCP, de 1 a 65535. |
| `OPENAI_API_KEY` | apenas no fallback | vazia | Chave de projeto da API Platform. |
| `YT_DLP_PATH` | não | `yt-dlp` | Caminho do executável `yt-dlp`. |
| `FFMPEG_PATH` | não | `ffmpeg` | Caminho do executável FFmpeg. |

Nunca envie `OPENAI_API_KEY` no body, em commits ou para o cliente da API.

## Executar

Em desenvolvimento:

```bash
export OPENAI_API_KEY="sua-chave-da-api-platform"
npm run dev
```

Build de produção:

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t youtube-transcript-api .
docker run --rm \
  -p 3000:3000 \
  -e OPENAI_API_KEY="sua-chave-da-api-platform" \
  youtube-transcript-api
```

A imagem executa a aplicação compilada como usuário sem privilégios, inclui FFmpeg e fixa o
`yt-dlp` na versão `2026.8.19` publicada no
[PyPI oficial](https://pypi.org/project/yt-dlp/). Como o YouTube muda com frequência, atualize a
versão fixada no Dockerfile quando necessário.

## Rotas

### Saúde

```bash
curl http://localhost:3000/health
```

Resposta:

```json
{"status":"ok"}
```

### Transcrição JSON

```bash
curl -X POST http://localhost:3000/v1/transcripts \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "languages": ["pt-BR", "pt", "en"]
  }'
```

`languages` é opcional, ordenado e aceita de um a cinco códigos. Exemplo de resposta:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "sourceUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "source": "youtube_captions",
  "language": "pt-BR",
  "isGenerated": false,
  "timestampPrecision": "caption",
  "extractedAt": "2026-08-25T12:00:00.000Z",
  "text": "Transcrição completa...",
  "segments": [
    {
      "text": "Primeiro trecho.",
      "startSeconds": 0,
      "durationSeconds": 2.5
    }
  ]
}
```

Quando o áudio é transcrito, `source` vale `openai_transcription`, `isGenerated` vale `true` e
`timestampPrecision` vale `chunk`. Nesse caminho, cada timestamp representa o início aproximado de
um bloco de até 20 minutos, não o tempo exato de cada palavra.

### PDF

```bash
curl -X POST http://localhost:3000/v1/transcripts/pdf \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ"}' \
  --output transcript.pdf
```

O PDF contém URL canônica, ID do vídeo, origem da transcrição, idioma, indicador de conteúdo
gerado, precisão dos timestamps, data de extração e todo o texto em ordem cronológica.

## Erros

Erros têm o formato:

```json
{
  "error": {
    "code": "VIDEO_NOT_AVAILABLE",
    "message": "The YouTube video is not available"
  }
}
```

| HTTP | Código | Significado |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Body ausente, campo desconhecido ou idiomas inválidos. |
| 400 | `INVALID_YOUTUBE_URL` | URL não suportada ou ID inválido. |
| 404 | `VIDEO_NOT_AVAILABLE` | Vídeo privado, restrito ou indisponível. |
| 502 | `YOUTUBE_UPSTREAM_ERROR` | Falha inesperada ao consultar legendas. |
| 503 | `AUDIO_FALLBACK_NOT_CONFIGURED` | O fallback precisa de `OPENAI_API_KEY`. |
| 503 | `AUDIO_TOOL_UNAVAILABLE` | `yt-dlp` ou FFmpeg não pôde iniciar. |
| 502 | `AUDIO_EXTRACTION_FAILED` | Falha no download ou processamento do áudio. |
| 502 | `AUDIO_CHUNK_TOO_LARGE` | Um bloco ultrapassou o limite interno de 24 MB. |
| 502 | `OPENAI_TRANSCRIPTION_FAILED` | A API de transcrição falhou. |
| 500 | `PDF_GENERATION_FAILED` | Não foi possível renderizar o PDF. |

Não há retry automático: isso evita cobranças duplicadas e amplificação de bloqueios do YouTube.

## Privacidade e limitações

- Áudio e blocos são criados em um diretório temporário exclusivo da requisição e removidos em um
  bloco `finally`, tanto no sucesso quanto no erro. JSONs e PDFs não são persistidos pela API.
- O limite interno por bloco é 24 MB, abaixo do limite documentado de upload de 25 MB da OpenAI.
- A transcrição é síncrona. Vídeos longos podem exceder o timeout de um proxy ou plataforma; para
  produção em grande escala, considere uma fila assíncrona.
- O YouTube pode bloquear IPs de datacenter, exigir login, aplicar rate limit ou alterar endpoints.
  A primeira versão aceita somente vídeos públicos acessíveis sem cookies e não tenta contornar
  restrições.
- Use somente conteúdo que você tem autorização para processar e respeite direitos autorais e os
  termos das plataformas envolvidas.
- Autenticação, quotas, rate limiting e ingestão no banco vetorial/RAG ficam fora deste MVP e devem
  ser adicionados antes de expor a API publicamente.

## Qualidade

Todos os testes usam adapters falsos: não acessam YouTube/OpenAI e não executam `yt-dlp` ou FFmpeg.

```bash
npm run check
```

O comando executa lint, verificação estrita de tipos, testes unitários e de integração e o build.
