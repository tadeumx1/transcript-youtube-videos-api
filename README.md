# API híbrida de transcrição do YouTube

API em Node.js, Fastify e TypeScript que recebe a URL de um vídeo público do YouTube,
prioriza suas legendas e, quando elas não estão disponíveis, transcreve o áudio com
`muse-spark-1.2-contributor` pelo OpenCode Go. As duas origens produzem o mesmo JSON e um PDF
pesquisável gerado localmente. O resultado pode ser obtido de forma síncrona ou por um job durável,
e o bundle completo fica em cache por tempo limitado para alimentar um fluxo RAG.
Jobs concluídos também podem ser materializados em uma base de conhecimento local com embeddings
E5 e busca híbrida no LanceDB, sem provedor de embedding remoto.

## Como funciona

1. Valida a URL e a transforma no formato canônico do YouTube.
2. Procura legendas na ordem solicitada, usando por padrão `pt-BR`, `pt` e `en`.
3. Somente quando não há legenda utilizável, baixa o áudio com `yt-dlp`.
4. O FFmpeg converte o áudio em MP3 mono, 16 kHz e 48 kbps, dividido em blocos de 10 minutos.
5. Envia cada bloco sequencialmente ao Muse com `reasoning.effort: "minimal"`.
6. Remove os arquivos temporários mesmo quando download, conversão ou transcrição falham.
7. Gera um PDF pesquisável localmente, sem outra chamada de IA, e publica JSON e PDF juntos no
   cache somente quando o bundle está completo.
8. Atende as rotas síncronas imediatamente ou processa jobs em uma fila durável recuperável após
   reinício.

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
| `API_ACCESS_KEY` | sim para rotas protegidas | vazia | Token Bearer que protege transcrição, jobs, RAG e métricas. |
| `YT_DLP_PATH` | não | `yt-dlp` | Caminho do executável `yt-dlp`. |
| `FFMPEG_PATH` | não | `ffmpeg` | Caminho do executável FFmpeg. |
| `MAX_CONCURRENT_TRANSCRIPTS` | não | `1` | Máximo global de transcrições simultâneas, de 1 a 32. |
| `TRANSCRIPT_RETRY_AFTER_SECONDS` | não | `30` | Espera indicada quando a capacidade está cheia, de 1 a 3600 segundos. |
| `YT_DLP_TIMEOUT_MS` | não | `300000` | Limite do download, de 1 a 3600000 milissegundos. |
| `FFMPEG_TIMEOUT_MS` | não | `900000` | Limite da conversão, de 1 a 3600000 milissegundos. |
| `PROCESS_TERMINATION_GRACE_MS` | não | `5000` | Espera entre `SIGTERM` e `SIGKILL`, de 1 a 60000 milissegundos. |
| `MUSE_TIMEOUT_MS` | não | `300000` | Limite de uma requisição ao Muse, de 1 a 3600000 milissegundos. |
| `DATA_ROOT` | não | `.data/transcripts` | caminho não vazio da persistência; no Railway a IaC define `/data/transcripts`. |
| `MAX_QUEUED_JOBS` | não | `100` | Máximo de jobs ativos (`queued + processing`), de 1 a 10000. |
| `ARTIFACT_TTL_SECONDS` | não | `604800` | Retenção de bundles completos, de 60 a 2678400 segundos. |
| `FAILED_JOB_TTL_SECONDS` | não | `86400` | Retenção de jobs falhos, de 60 a 604800 segundos. |
| `JOB_TOMBSTONE_TTL_SECONDS` | não | `86400` | Retenção da indicação de expiração, de 60 a 604800 segundos. |
| `STORAGE_SWEEP_INTERVAL_MS` | não | `60000` | Intervalo da limpeza local, de 1000 a 3600000 milissegundos. |
| `RAG_DATA_ROOT` | não | `.data/lancedb` | caminho não vazio da base RAG; no Railway a IaC define `/data/lancedb`. |
| `RAG_MODEL_ROOT` | não | `.models` | caminho não vazio do modelo E5 local verificado; a imagem usa `/app/models`. |
| `MAX_QUEUED_RAG_INGESTIONS` | não | `25` | Máximo de ingestões RAG em fila, de 1 a 1000. |
| `MAX_CONCURRENT_RAG_SEARCHES` | não | `4` | Máximo de buscas RAG simultâneas, de 1 a 32. |
| `RAG_SEARCH_RETRY_AFTER_SECONDS` | não | `5` | Espera de uma busca sem capacidade, de 1 a 3600 segundos. |
| `FAILED_RAG_INGESTION_TTL_SECONDS` | não | `86400` | Retenção de ingestões concluídas ou falhas, de 60 a 604800 segundos. |
| `RAG_INGESTION_TOMBSTONE_TTL_SECONDS` | não | `86400` | Retenção da indicação de ingestão expirada, de 60 a 604800 segundos. |
| `RAG_SWEEP_INTERVAL_MS` | não | `60000` | Intervalo da limpeza de metadados RAG, de 1000 a 3600000 milissegundos. |
| `RAG_MAX_SOURCE_CODE_POINTS` | não | `5000000` | Máximo de code points por fonte, de 10000 a 20000000. |
| `RAG_MAX_CHUNKS_PER_DOCUMENT` | não | `5000` | Máximo de chunks por documento, de 1 a 20000. |
| `RAG_EMBEDDING_BATCH_SIZE` | não | `8` | Lote local de embeddings, de 1 a 8. |
| `RAG_MIN_FREE_BYTES` | não | `134217728` | Reserva no Volume antes de um miss, de 16777216 a 536870912 bytes. |

`GET /health` e `GET /ready` continuam públicos. Se `API_ACCESS_KEY` estiver vazio, os endpoints de
transcrição, jobs, RAG e métricas falham fechados com HTTP 503; eles nunca ficam públicos por
acidente.

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

A imagem inclui FFmpeg, fixa o `yt-dlp` na versão `2026.8.19` e empacota os cinco artefatos
verificados do modelo E5; a execução não baixa modelo. O entrypoint inicia como root apenas para
criar e ajustar a propriedade da raiz `/data`; em seguida usa `gosu` e substitui o processo pelo
Node como usuário sem privilégios. Como o YouTube muda com frequência, atualize a versão do
`yt-dlp` quando necessário. A verificação descrita em [Qualidade](#qualidade) constrói a mesma
imagem de produção e executa nela o encoder e o LanceDB sem credenciais nem rede.

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
export API_BASE_URL=http://localhost:3000
export VIDEO_URL=https://www.youtube.com/watch?v=SEU_ID_AQUI

curl -X POST ${API_BASE_URL}/v1/transcripts \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"url\":\"${VIDEO_URL}\",\"languages\":[\"pt-BR\",\"pt\",\"en\"]}" \
  --output transcript.json
```

Substitua `SEU_ID_AQUI` por um ID de 11 caracteres de um vídeo público autorizado. `languages` é
opcional, ordenado e aceita de um a cinco códigos. Quando o áudio é transcrito, `source` vale
`muse_transcription`, `isGenerated` vale `true` e `timestampPrecision` vale `chunk`. Cada timestamp
representa o início aproximado de um bloco de até 10 minutos, não o tempo exato de cada palavra.

### PDF

```bash
curl -X POST ${API_BASE_URL}/v1/transcripts/pdf \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"url\":\"${VIDEO_URL}\"}" \
  --output transcript.pdf
```

O PDF contém URL canônica, ID do vídeo, origem da transcrição, idioma, indicador de conteúdo
gerado, precisão dos timestamps, data de extração e todo o texto em ordem cronológica. A renderização
usa PDFKit localmente e não consome tokens do Muse.

As duas rotas síncronas procuram primeiro um bundle verificado para o vídeo canônico e a ordem de
idiomas solicitada. Um hit retorna os bytes retidos sem chamar YouTube, Muse, FFmpeg ou o renderer.
Em um miss, a API produz a transcrição e o PDF uma vez e só então publica o bundle completo. Uma
falha ao completar o cache não transforma uma transcrição JSON já produzida em erro; a rota PDF
preserva o erro de renderização existente.

### Jobs duráveis

Use jobs para não manter uma conexão HTTP aberta durante vídeos longos. Mantenha `VIDEO_URL` com o
placeholder `SEU_ID_AQUI` até escolher um vídeo público autorizado. Todos os comandos abaixo enviam
o mesmo Bearer e gravam a resposta em arquivo, evitando conteúdo de transcrição no terminal.

Envie o job:

```bash
curl -X POST ${API_BASE_URL}/v1/jobs \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"url\":\"${VIDEO_URL}\",\"languages\":[\"pt-BR\",\"pt\",\"en\"]}" \
  --dump-header job-headers.txt \
  --output job-submission.json
```

O servidor responde 202 com `Location`, `Retry-After: 2`, um `jobId` e disposição `miss`, `joined` ou `hit`.
Copie o identificador retornado sem registrá-lo em logs compartilhados:

```bash
export JOB_ID=substitua-pelo-job-id-retornado
```

Consulte o estado `queued`, `processing`, `completed` ou `failed`:

```bash
curl -X GET ${API_BASE_URL}/v1/jobs/${JOB_ID} \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output job-status.json
```

Depois de `completed`, baixe o JSON e o PDF retidos:

```bash
curl -X GET ${API_BASE_URL}/v1/jobs/${JOB_ID}/transcript \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output transcript.json

curl -X GET ${API_BASE_URL}/v1/jobs/${JOB_ID}/pdf \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output transcript.pdf
```

Submissões concorrentes com a mesma identidade canônica têm um único dono: um novo trabalho é
`miss`, seguidores ativos são `joined` e um bundle já verificado é `hit`. Somente um miss novo
consome `MAX_QUEUED_JOBS`; o limite conta `queued + processing`. O worker escolhe jobs em ordem FIFO
e espera a mesma capacidade global usada pelas rotas síncronas, sem rejeitar ou chamar provedores
enquanto não houver um permit.

Os TTLs são fixos e não deslizantes: leituras não prorrogam nenhuma retenção. Bundles completos
expiram após `ARTIFACT_TTL_SECONDS` contados da conclusão; jobs falhos usam
`FAILED_JOB_TTL_SECONDS`; a indicação 410 permanece por `JOB_TOMBSTONE_TTL_SECONDS`. A limpeza roda
no intervalo `STORAGE_SWEEP_INTERVAL_MS`.

Após um reinício, um bundle completo finaliza o job e uma transcrição parcial verificada retoma
somente a geração local do PDF. Se o efeito externo for incerto e não houver transcrição verificada,
o job termina como `JOB_INTERRUPTED`. Não há retry automático de YouTube ou Muse. Para tentar outra
vez e aceitar novo consumo de quota, envie explicitamente um novo `POST /v1/jobs`.

### Base de conhecimento RAG local

A ingestão parte exclusivamente de um job durável `completed` cujo bundle ainda está verificado.
Ela copia um snapshot local da transcrição, divide o texto e publica embeddings E5 no LanceDB. Esse
fluxo não retranscreve o vídeo, não regenera o PDF e não chama YouTube, Muse/OpenCode, LLM, registro
de modelo ou serviço de embedding pela rede; o embedding ocorre localmente com o modelo empacotado.

Use somente os identificadores devolvidos pelas rotas anteriores e não os registre em logs
compartilhados. Envie um job concluído para a fila RAG:

```bash
curl -X POST ${API_BASE_URL}/v1/rag/ingestions \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"jobId\":\"${JOB_ID}\"}" \
  --dump-header rag-ingestion-headers.txt \
  --output rag-ingestion.json
```

O servidor responde 202 com `Location`, `Retry-After: 2` e disposição `miss`, `joined` ou `hit`.
Copie os placeholders da resposta para consultar o processamento sem imprimir o body:

```bash
export RAG_INGESTION_ID=substitua-pelo-ingestion-id-retornado
export RAG_DOCUMENT_ID=substitua-pelo-document-id-retornado

curl -X GET ${API_BASE_URL}/v1/rag/ingestions/${RAG_INGESTION_ID} \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output rag-ingestion-status.json
```

O estado é `queued`, `processing`, `completed` ou `failed`. Depois de `completed`, faça a busca
híbrida. A consulta aceita de 1 a 1000 caracteres, com `topK` padrão 5, de 1 a 20, e filtro opcional
de até 50 `documentIds` distintos:

```bash
export RAG_QUERY=substitua-por-uma-consulta-autorizada

curl -X POST ${API_BASE_URL}/v1/rag/search \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  -H 'content-type: application/json' \
  --data "{\"query\":\"${RAG_QUERY}\",\"topK\":5}" \
  --output rag-search-results.json
```

Remova um documento quando ele não deve mais participar da recuperação:

```bash
curl -X DELETE ${API_BASE_URL}/v1/rag/documents/${RAG_DOCUMENT_ID} \
  -H "authorization: Bearer $API_ACCESS_KEY" \
  --output /dev/null \
  --write-out '%{http_code}\n'
```

Uma remoção concluída responde 204 e produz remoção lógica imediata dos resultados de busca, sem
alterar o job, a transcrição ou o PDF de origem. Isso não oferece apagamento físico seguro:
fragmentos antigos do LanceDB e backups do Railway podem conservar blocos até que as políticas de
compactação e retenção os eliminem. Portanto, a API não deve ser descrita como mecanismo de
destruição criptográfica ou sanitização de mídia.

Ingestões concorrentes da mesma versão usam `miss`, `joined` e `hit`. Somente um miss novo conta no
limite de 25 itens e exige pelo menos 128 MiB livres no Volume compartilhado; a falta de espaço
retorna 507 `RAG_STORAGE_CAPACITY_EXCEEDED`, e a fila cheia retorna 429
`RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED` com `Retry-After: 30`. As quatro buscas simultâneas usam
`RAG_SEARCH_CAPACITY_EXCEEDED` com `Retry-After: 5`; atualização concorrente do mesmo documento usa
409 `RAG_DOCUMENT_UPDATE_IN_PROGRESS` com `Retry-After: 2`. Hits, joins, status, busca e deleção
permanecem disponíveis nas respectivas condições de capacidade.

O chunker limita cada entrada do modelo a 320 tokens, com no máximo 48 tokens de contexto anterior;
não depende de truncamento do modelo. Os TTLs fixos e não deslizantes de 24 horas pertencem ao
recurso de ingestão e ao seu tombstone. O documento publicado continua pesquisável depois que o
artefato e o recurso de ingestão expiram, até uma substituição ou DELETE explícito.

`GET /health` é somente liveness. `GET /ready` retorna 200 apenas depois de armazenamento de
transcrições, repositório RAG, schema e embedding fingerprint do LanceDB, modelo local aquecido,
reconciliação e workers estarem prontos; durante inicialização, desligamento ou degradação retorna
503 `{"status":"not_ready"}`. Operações RAG falham fechadas com códigos fixos, mas liveness e as
rotas existentes de transcrição/jobs continuam com seus contratos próprios.

`GET /metrics` exige o mesmo Bearer. As famílias `youtube_transcript_rag_submissions_total`,
`youtube_transcript_rag_ingestions_current`, `youtube_transcript_rag_component_healthy`,
`youtube_transcript_rag_searches_total` e `youtube_transcript_rag_maintenance_total`, além dos
histogramas e gauges associados, têm somente labels fixos. Métricas e logs
não incluem consulta, texto, vetor, URL, ID, caminho ou credencial. Investigue saúde por componente (`repository`,
`index`, `model`, `worker`) e capacidade pelos resultados agregados, nunca adicionando labels por
documento ou conteúdo.

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
| 404 | `JOB_NOT_FOUND` | Job desconhecido ou nunca retido. |
| 404 | `RAG_INGESTION_NOT_FOUND` | Recurso de ingestão RAG desconhecido ou nunca retido. |
| 404 | `RAG_DOCUMENT_NOT_FOUND` | Documento RAG desconhecido ou já removido. |
| 409 | `JOB_NOT_COMPLETED` | Resultado solicitado enquanto o job ainda está na fila ou processando; use `Retry-After: 2`. |
| 409 | `JOB_FAILED` | Resultado solicitado para um job que terminou com falha; consulte o estado. |
| 409 | `RAG_DOCUMENT_UPDATE_IN_PROGRESS` | A mesma versão do documento está sendo atualizada; use `Retry-After: 2`. |
| 410 | `JOB_EXPIRED` | Job expirado ainda representado por um tombstone retido. |
| 410 | `RAG_INGESTION_EXPIRED` | Ingestão expirada ainda representada por um tombstone retido. |
| 429 | `JOB_QUEUE_CAPACITY_EXCEEDED` | Novo miss excedeu a fila; `joined` e `hit` continuam aceitos. |
| 429 | `RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED` | Novo miss RAG excedeu a fila; use `Retry-After: 30`. |
| 429 | `RAG_SEARCH_CAPACITY_EXCEEDED` | Todas as vagas de busca estão ocupadas; use `Retry-After: 5`. |
| 502 | `YOUTUBE_UPSTREAM_ERROR` | Falha inesperada ao consultar legendas. |
| 503 | `AUDIO_FALLBACK_NOT_CONFIGURED` | O fallback precisa de `OPENCODE_API_KEY`. |
| 503 | `AUDIO_TOOL_UNAVAILABLE` | `yt-dlp` ou FFmpeg não pôde iniciar. |
| 503 | `JOB_STORAGE_UNAVAILABLE` | Volume, bundle ou metadado durável não está verificável. |
| 503 | `RAG_MODEL_UNAVAILABLE` | Modelo local ausente, inválido ou não aquecido. |
| 503 | `RAG_STORAGE_UNAVAILABLE` | Repositório ou índice local não está verificável. |
| 507 | `RAG_STORAGE_CAPACITY_EXCEEDED` | O Volume não mantém a reserva mínima para aceitar um novo miss. |
| 502 | `AUDIO_EXTRACTION_FAILED` | Falha no download ou processamento do áudio. |
| 502 | `AUDIO_CHUNK_TOO_LARGE` | Um bloco ultrapassou o limite interno de 8 MiB. |
| 502 | `MUSE_TRANSCRIPTION_FAILED` | O OpenCode Go ou o Muse não concluiu a transcrição. |
| 500 | `PDF_GENERATION_FAILED` | Não foi possível renderizar o PDF. |
| 503 | `API_AUTH_NOT_CONFIGURED` | `API_ACCESS_KEY` não foi configurada no servidor. |

Não há retry automático. Uma falha interrompe a requisição ou o job para evitar consumo duplicado
da franquia e amplificação de bloqueios do YouTube. O código `JOB_INTERRUPTED` é persistido no estado
do job, não usado para refazer silenciosamente o trabalho externo.

## Railway

O arquivo `.railway/railway.ts` mantém o projeto e o serviço no Infrastructure as Code atual do
Railway. Ele configura `/health` como health check e permite até 300 segundos para a imagem ficar
saudável. A topologia usa uma única réplica e um único Volume de 1024 MB (1 GB), compartilhado,
montado em `/data`: `DATA_ROOT=/data/transcripts` guarda jobs/artefatos e
`RAG_DATA_ROOT=/data/lancedb` guarda metadados e índices locais. O modelo verificado está na imagem,
não no Volume. A IaC preserva os dois segredos existentes e não cria banco, bucket, modelo remoto
ou armazenamento público. O container e o Fastify usam a variável `PORT` fornecida pelo Railway.

O limite de 1 GB é compartilhado pelas duas raízes. Monitore o espaço agregado e preserve a reserva
de 128 MiB; um miss RAG é recusado com 507 antes de consumir essa reserva. Um Volume só pode ficar
anexado ao deployment dessa réplica por vez. Isso causa indisponibilidade breve durante cada redeploy.
O backup é responsabilidade do operador: excluir, recriar ou corromper o Volume sem uma cópia
recuperável pode causar perda permanente de jobs, JSONs, PDFs e da base RAG.

Para revisar mudanças de infraestrutura antes de aplicá-las:

```bash
railway config plan --file .railway/railway.ts
```

Revise a contagem e cada item de add/change/destroy. A configuração não é aplicada automaticamente
pelos testes; execute `railway config apply --file .railway/railway.ts` somente após aprovação
explícita daquele plano exato. O plano de validação desta versão foi somente leitura, portanto não
prova que o estado remoto já foi aplicado.

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

### Backup, restauração e modelo local

Faça uma janela de manutenção que impeça novas escritas. Garanta um backup verificável antes de qualquer compactação
manual, fora do Volume, e preserve as duas raízes em conjunto; esta versão não
expõe endpoint público de compactação. Um fluxo compatível com a CLI atual é criar o arquivo dentro
de uma área operacional temporária, baixá-lo e verificar seu checksum local:

```bash
railway ssh --service transcript-youtube-videos-api --environment production \
  'mkdir -p /data/.ops && tar --exclude=.ops -C /data -czf /data/.ops/volume-backup.tgz transcripts lancedb'
railway volume files download /data/.ops/volume-backup.tgz ./volume-backup.tgz \
  --service transcript-youtube-videos-api --environment production
sha256sum ./volume-backup.tgz
```

Registre o checksum e teste a leitura do arquivo em armazenamento separado. Não trate retenção ou
snapshot eventual da plataforma como substituto desse backup. Para restaurar, mantenha a escrita
interrompida, confira a origem/checksum, envie o arquivo e extraia ambas as raízes como uma unidade:

```bash
railway volume files upload ./volume-backup.tgz /data/.ops/volume-restore.tgz \
  --service transcript-youtube-videos-api --environment production
railway ssh --service transcript-youtube-videos-api --environment production \
  'tar -C /data -xzf /data/.ops/volume-restore.tgz'
```

Depois reinicie a única réplica, confirme `/health`, espere `/ready` voltar a 200 e execute uma busca
autenticada conhecida. Remova os arquivos de `.ops` só depois da validação e mantenha a cópia externa
pela política de retenção aplicável.

Cada namespace LanceDB registra o embedding fingerprint do modelo/chunker. Artefato inválido,
ausente ou com fingerprint diferente falha fechado, deixa `/ready` em 503 e nunca aciona download ou
embedding remoto. A aplicação recusa a migração implícita de um namespace incompatível: restaure o
Volume com a mesma imagem/modelo ou faça uma reingestão explícita em um namespace compatível, mantendo
o backup anterior até validar os resultados.

## Privacidade e limitações

- Áudio e blocos ficam em um diretório temporário exclusivo da requisição e são removidos em um
  bloco `finally`; áudio nunca entra no Volume. JSONs, PDFs e metadados de job bem-sucedidos ficam
  retidos em `DATA_ROOT` somente pelos TTLs configurados.
- Os chunks usam MP3 a 48 kbps, duram até 10 minutos e são enviados ao OpenCode Go como Base64.
- Rotas síncronas e jobs duráveis compartilham `MAX_CONCURRENT_TRANSCRIPTS`; use jobs para vídeos
  que podem exceder o timeout do proxy. `MAX_QUEUED_JOBS` limita novos misses, mas não é uma quota
  individual por cliente.
- O YouTube pode bloquear IPs de datacenter, exigir login, aplicar rate limit ou alterar endpoints.
  Esta versão aceita somente vídeos públicos acessíveis sem cookies e não contorna restrições.
- O Bearer protege submissão, estado e cada leitura de JSON/PDF. Trate os artefatos persistidos como
  conteúdo do vídeo e proteja também backups. Os documentos RAG sobrevivem ao TTL do bundle até
  substituição ou deleção explícita; logs e métricas não incluem IDs, URLs, consulta ou conteúdo.
- Não há retry automático. Preserve `MAX_CONCURRENT_TRANSCRIPTS`, `YT_DLP_TIMEOUT_MS`,
  `FFMPEG_TIMEOUT_MS` e `MUSE_TIMEOUT_MS`; não amplie esses controles para contornar falhas.
- DELETE remove o documento imediatamente da busca, mas é remoção lógica: fragmentos antigos do
  LanceDB e backups podem persistir conforme compactação e retenção. Não prometa destruição física
  segura; trate exportações e cópias segundo a mesma política de dados da transcrição.
- Um `/health` bem-sucedido prova que a API está online; não prova que o YouTube aceitará requisições
  originadas do IP do Railway nem que o RAG está pronto. Use `/ready` para prontidão local e
  diagnostique erros do provedor separadamente.

## Qualidade

Os testes de transcrição usam adapters falsos: não acessam YouTube/OpenCode Go e não executam
`yt-dlp` ou FFmpeg. Os gates RAG usam o tokenizer, o encoder E5 e o LanceDB reais, sempre localmente.

Baixe/verifique os cinco artefatos imutáveis somente durante a aquisição explícita e depois rode a
suíte offline, que bloqueia rede e credenciais:

```bash
npm run rag:model:fetch
npm run test:rag:offline
```

A avaliação contém exatamente 12 documentos automotivos fictícios e 48 qrels PT-BR, cobrindo busca
exata, semântica, desambiguação modelo/ano, acentos/typos, números e distratores. Ela mede vector,
FTS e híbrido, impõe Recall/MRR/nDCG e subgrupos, e exige IDs/ranks idênticos em três índices novos.

Rode também os gates de mutação, documentação/OpenAPI, dependências e container offline:

```bash
npm exec -- vitest run test/integration/lancedb-rag-index.test.ts test/integration/rag-ingestion-worker.test.ts
npm exec -- vitest run test/integration/openapi.test.ts test/unit/rag-readme-contract.test.ts
npm audit --omit=dev
npm ls
docker build -t transcript-rag:local .
docker run --rm --network none transcript-rag:local node scripts/rag-container-smoke.mjs
```

O smoke executado na imagem de produção nega credenciais/rede e comprova vetor real de 384
dimensões, substituição, busca vetorial/FTS, deleção, usuário sem privilégios e escrita em `/data`.
Por fim, execute o gate completo:

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

O primeiro executa `npm ci` e `npm run check` no Node.js 22. O segundo só começa após o primeiro,
constrói e carrega a imagem de produção sem publicá-la e executa nela o smoke com
`docker run --network none`.
