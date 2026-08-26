# API híbrida de transcrição do YouTube

API em Node.js, Fastify e TypeScript que recebe a URL de um vídeo público do YouTube,
prioriza suas legendas e, quando elas não estão disponíveis, transcreve o áudio com
`muse-spark-1.2-contributor` pelo OpenCode Go. As duas origens produzem o mesmo JSON e um PDF
pesquisável gerado localmente, prontos para alimentar um fluxo RAG.

## Como funciona

1. Valida a URL e a transforma no formato canônico do YouTube.
2. Procura legendas na ordem solicitada, usando por padrão `pt-BR`, `pt` e `en`.
3. Somente quando não há legenda utilizável, baixa o áudio com `yt-dlp`.
4. O FFmpeg converte o áudio em MP3 mono, 16 kHz e 48 kbps, dividido em blocos de 10 minutos.
5. Envia cada bloco sequencialmente ao Muse com `reasoning.effort: "minimal"`.
6. Remove os arquivos temporários mesmo quando download, conversão ou transcrição falham.
7. Retorna o contrato unificado como JSON ou gera um PDF pesquisável sem outra chamada de IA.

O Muse não é acionado quando as legendas funcionam nem quando o provedor de legendas falha de
forma inesperada.

## OpenCode Go e política de dados

O fallback usa a assinatura OpenCode Go e a chave do workspace em `OPENCODE_API_KEY`. O modelo
Contributor exige que a opção **“Permitir modelos que usam dados de solicitações para
treinamento”** esteja habilitada no workspace.

Esse consentimento permite que solicitações, inclusive o áudio enviado, sejam usadas para melhorar
o modelo. Use apenas vídeos públicos que você tem autorização para processar. Não envie gravações
privadas, credenciais, dados pessoais sensíveis ou conteúdo confidencial.

Consulte a [documentação oficial do OpenCode Go](https://dev.opencode.ai/docs/go/) para modelos,
limites e endpoints atuais.

## Requisitos locais

- Node.js 22 ou superior
- `yt-dlp`
- FFmpeg
- Assinatura OpenCode Go e `OPENCODE_API_KEY` para vídeos sem legenda

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

Preencha somente o arquivo `.env`, que já está ignorado pelo Git:

```dotenv
OPENCODE_API_KEY=sua-chave-do-opencode-go
API_ACCESS_KEY=um-token-longo-e-aleatorio
```

Os scripts `dev` e `start` carregam o `.env` da raiz quando ele existe. Variáveis fornecidas pelo
ambiente da hospedagem também são aceitas.

| Variável | Obrigatória | Padrão | Uso |
| --- | --- | --- | --- |
| `HOST` | não | `0.0.0.0` | Endereço em que o Fastify escuta. |
| `PORT` | não | `3000` | Porta TCP, de 1 a 65535. |
| `OPENCODE_API_KEY` | apenas no fallback | vazia | Chave do workspace OpenCode Go. |
| `API_ACCESS_KEY` | sim para transcrever | vazia | Token Bearer que protege os dois endpoints de transcrição. |
| `YT_DLP_PATH` | não | `yt-dlp` | Caminho do executável `yt-dlp`. |
| `FFMPEG_PATH` | não | `ffmpeg` | Caminho do executável FFmpeg. |
| `MAX_CONCURRENT_TRANSCRIPTS` | não | `1` | Máximo global de transcrições simultâneas, de 1 a 32. |
| `TRANSCRIPT_RETRY_AFTER_SECONDS` | não | `30` | Espera indicada quando a capacidade está cheia, de 1 a 3600 segundos. |
| `YT_DLP_TIMEOUT_MS` | não | `300000` | Limite do download, de 1 a 3600000 milissegundos. |
| `FFMPEG_TIMEOUT_MS` | não | `900000` | Limite da conversão, de 1 a 3600000 milissegundos. |
| `PROCESS_TERMINATION_GRACE_MS` | não | `5000` | Espera entre `SIGTERM` e `SIGKILL`, de 1 a 60000 milissegundos. |
| `MUSE_TIMEOUT_MS` | não | `300000` | Limite de uma requisição ao Muse, de 1 a 3600000 milissegundos. |

`GET /health` continua público. Se `API_ACCESS_KEY` estiver vazio, os endpoints de transcrição
falham fechados com HTTP 503; eles nunca ficam públicos por acidente.

Nunca envie `OPENCODE_API_KEY` no body, em commits ou ao cliente da API. Envie `API_ACCESS_KEY`
somente no header `Authorization` e trate-o como credencial de produção.

## Executar

Em desenvolvimento:

```bash
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
  --env-file .env \
  youtube-transcript-api
```

A imagem executa a aplicação compilada como usuário sem privilégios, inclui FFmpeg e fixa o
`yt-dlp` na versão `2026.8.19`. Como o YouTube muda com frequência, atualize essa versão quando
necessário.

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
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "languages": ["pt-BR", "pt", "en"]
  }'
```

`languages` é opcional, ordenado e aceita de um a cinco códigos. Exemplo de resposta por legenda:

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

Quando o áudio é transcrito, `source` vale `muse_transcription`, `isGenerated` vale `true` e
`timestampPrecision` vale `chunk`. Cada timestamp representa o início aproximado de um bloco de
até 10 minutos, não o tempo exato de cada palavra.

### PDF

```bash
curl -X POST http://localhost:3000/v1/transcripts/pdf \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ"}' \
  --output transcript.pdf
```

O PDF contém URL canônica, ID do vídeo, origem da transcrição, idioma, indicador de conteúdo
gerado, precisão dos timestamps, data de extração e todo o texto em ordem cronológica. A renderização
usa PDFKit localmente e não consome tokens do Muse.

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
| 401 | `UNAUTHORIZED` | Bearer token ausente, malformado ou incorreto. |
| 400 | `INVALID_REQUEST` | Body ausente, campo desconhecido ou idiomas inválidos. |
| 400 | `INVALID_YOUTUBE_URL` | URL não suportada ou ID inválido. |
| 404 | `VIDEO_NOT_AVAILABLE` | Vídeo privado, restrito ou indisponível. |
| 502 | `YOUTUBE_UPSTREAM_ERROR` | Falha inesperada ao consultar legendas. |
| 503 | `AUDIO_FALLBACK_NOT_CONFIGURED` | O fallback precisa de `OPENCODE_API_KEY`. |
| 503 | `AUDIO_TOOL_UNAVAILABLE` | `yt-dlp` ou FFmpeg não pôde iniciar. |
| 502 | `AUDIO_EXTRACTION_FAILED` | Falha no download ou processamento do áudio. |
| 502 | `AUDIO_CHUNK_TOO_LARGE` | Um bloco ultrapassou o limite interno de 8 MiB. |
| 502 | `MUSE_TRANSCRIPTION_FAILED` | O OpenCode Go ou o Muse não concluiu a transcrição. |
| 500 | `PDF_GENERATION_FAILED` | Não foi possível renderizar o PDF. |
| 503 | `API_AUTH_NOT_CONFIGURED` | `API_ACCESS_KEY` não foi configurada no servidor. |

Não há retry automático. Uma falha interrompe a requisição para evitar consumo duplicado da
franquia e amplificação de bloqueios do YouTube.

## Railway

O arquivo `.railway/railway.ts` mantém o projeto e o serviço no Infrastructure as Code atual do
Railway. Ele configura `/health` como health check e permite até 300 segundos para a imagem ficar
saudável. O serviço usa o Dockerfile da raiz e a política padrão limitada de reinício por falha. O
container e o Fastify usam a variável `PORT` fornecida pelo Railway.

Para revisar mudanças de infraestrutura antes de aplicá-las:

```bash
railway config plan
railway config apply
```

No primeiro deploy, execute na raiz do projeto:

```bash
railway up
```

Depois configure os dois segredos no serviço. Passe os valores por stdin para não gravá-los no
histórico do shell:

```bash
printf '%s' "$OPENCODE_API_KEY" | railway variable set OPENCODE_API_KEY --stdin --service transcript-youtube-videos-api
printf '%s' "$API_ACCESS_KEY" | railway variable set API_ACCESS_KEY --stdin --service transcript-youtube-videos-api
```

Uma alteração de variável dispara novo deploy. Gere o domínio público e confirme o estado:

```bash
railway domain --service transcript-youtube-videos-api --json
railway deployment list --service transcript-youtube-videos-api --json
```

Use o domínio retornado nos mesmos exemplos de `curl`. Primeiro confirme `/health` sem credencial;
em seguida confirme que um `POST /v1/transcripts` sem Bearer retorna 401 antes de testar a chamada
autenticada. O valor real de `API_ACCESS_KEY` deve permanecer apenas no gerenciador de segredos e
nos clientes autorizados.

Depois de copiar `API_ACCESS_KEY` para um gerenciador de senhas, você pode usar a ação **Seal** na
aba Variables do Railway. O seal é irreversível e impede recuperar o valor pelo painel ou CLI, então
faça isso somente depois de confirmar que o cliente autorizado guardou o token.

Para separar saúde da plataforma, legendas, download, FFmpeg e Muse sem expor conteúdo, siga o
[runbook de bloqueio do YouTube em datacenter](docs/runbooks/youtube-datacenter-blocking.md). Mesmo
durante um incidente, preserve o Bearer, `MAX_CONCURRENT_TRANSCRIPTS`, `YT_DLP_TIMEOUT_MS`,
`FFMPEG_TIMEOUT_MS` e `MUSE_TIMEOUT_MS`; não desative nem amplie esses controles para contornar uma
falha de provedor.

## Privacidade e limitações

- Áudio e blocos ficam em um diretório temporário exclusivo da requisição e são removidos em um
  bloco `finally`. JSONs e PDFs não são persistidos pela API.
- Os chunks usam MP3 a 48 kbps, duram até 10 minutos e são enviados ao OpenCode Go como Base64.
- A transcrição é síncrona. Vídeos longos podem exceder o timeout do proxy ou da hospedagem; uma
  fila assíncrona é recomendada para produção em escala.
- O YouTube pode bloquear IPs de datacenter, exigir login, aplicar rate limit ou alterar endpoints.
  Esta versão aceita somente vídeos públicos acessíveis sem cookies e não contorna restrições.
- Um Bearer token protege os endpoints, mas limite de concorrência, quotas por cliente, fila
  assíncrona e ingestão no banco vetorial/RAG ainda não foram implementados.
- Um `/health` bem-sucedido prova que a API está online; não prova que o YouTube aceitará requisições
  originadas do IP do Railway. Erros do provedor devem ser diagnosticados separadamente.

## Qualidade

Os testes usam adapters falsos: não acessam YouTube/OpenCode Go e não executam `yt-dlp` ou FFmpeg.

```bash
npm run check
```

O comando executa lint, verificação estrita de tipos, testes unitários e de integração e o build.

### Integração contínua

O GitHub Actions executa os mesmos gates em pushes para `main` e em pull requests. O workflow não
recebe `OPENCODE_API_KEY` nem `API_ACCESS_KEY`: os testes usam adapters locais e o build do
Dockerfile não acessa provedores.

Se branch protection estiver habilitado em `main`, configure exatamente estes checks como
obrigatórios:

- `Source checks`
- `Container build`

O primeiro executa `npm ci` e `npm run check` no Node.js 22. O segundo só começa após o primeiro e
constrói a imagem Docker sem publicá-la.
