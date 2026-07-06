# Pipeline SEO — Instel Service

Geração e publicação automática de posts de blog (engenharia elétrica) cobrindo
**Serviço × Localidade**, publicando direto no WordPress via GitHub Actions.

## Estrutura da página gerada

A estrutura de cada post foi desenhada com base numa referência de mercado que você indicou,
pensando em SEO, AEO (ser citado em respostas de assistentes de IA), GEO/AIO (ser bem
entendido e reaproveitado por LLMs) e SXO (experiência que converte de fato em contato). A
ordem dos blocos é fixa — só o conteúdo textual interno é gerado pela IA:

1. **Breadcrumb** (Home → Serviços → [Serviço] em [Localidade]) + schema `BreadcrumbList`.
2. **Galeria de imagens** clicável (se houver imagens cadastradas — ver `data/imagens.json`).
3. **Introdução** direta, sem heading, já estabelecendo o serviço, a localidade e a credencial técnica.
4. **H2 "O que é [serviço]?"** com H3 de definição técnica (citando normas) e H3 de quem deve contratar.
5. **H2 "Por que contratar em [localidade]?"** com H3 de contexto local (pode citar bairros vizinhos reais) e H3 de riscos de não contratar.
6. **H2 "O que entregamos"** — 4 a 6 itens em H3, cada um citando a norma técnica correta (NBR 5410, NBR 5419, NR-10, NR-12, AVCB/Corpo de Bombeiros, ANEEL, conforme o serviço).
7. **CTA de WhatsApp** (bloco fixo, não gerado pela IA — link real para `wa.me` com mensagem pré-preenchida).
8. **H2 "Como funciona"** — 3 H3 fixos: agendamento, execução técnica, entrega do laudo.
9. **H2 FAQ** — 5 perguntas em H3 + resposta em `<p>`, formato pensado para ser extraído por motores de IA (AEO/GEO) e schema `FAQPage`.
10. **Segundo CTA de WhatsApp** (final, bloco fixo).
11. **Bloco de orçamento** fixo — preço sempre "a consultar" (nunca a IA decide isso).
12. **H2 "Serviços relacionados em [localidade] e região"** — linkagem interna real (ver abaixo), só aparece quando já existem posts de fato publicados para linkar.
13. **Box de autor**, linkando para `instelservice.com.br/autor/`.
14. Schemas `BreadcrumbList`, `FAQPage` e `Service`/`LocalBusiness` como `<script type="application/ld+json">`.

Importante: a IA nunca decide a ordem dos blocos, nem CTA, nem preço, nem headings de nível 1/2/3
fora dos campos que o script controla — ela só preenche o conteúdo textual de cada seção em JSON
estruturado. Isso evita as armadilhas de markdown fences e de `<h1>` duplicado de forma muito mais
robusta do que depender de instrução + limpeza de texto.

## Linkagem interna ("Serviços relacionados") — como funciona de verdade

Cada post publicado recebe duas tags no WordPress: uma com o nome do serviço e outra com o nome
da localidade. Antes de publicar um novo post, o script consulta a API do WordPress por posts já
publicados com a mesma tag de serviço, e filtra os que **não** são da localidade atual. Só exibe
a seção "Serviços relacionados" quando encontra pelo menos 3 posts reais (configurável via
`MIN_RELACIONADOS`) — assim nunca aparece um link quebrado ou uma seção vazia/forçada. Nos
primeiros dias de execução essa seção vai aparecer pouco (cold start) e vai crescer naturalmente
conforme o catálogo de posts aumenta.

## O que está incluso

- `data/servicos.json` — os 10 serviços da Instel Service (Variável A).
- `data/bairros-sp-capital.json` — os 96 distritos oficiais do município de São Paulo, cada um já
  com a lista de bairros vizinhos reais (mesma subprefeitura) para contexto local factual — fonte:
  dados abertos `codigourbano/distritos-sp`, base IBGE.
- `data/municipios-sp.json` — os 644 municípios do estado de São Paulo, exceto a capital — fonte:
  `kelvins/municipios-brasileiros`, base IBGE.
- `data/localidades.json` — união dos dois arquivos acima (740 localidades), no formato que o
  script consome. **É este arquivo que o script lê.** Se editar os arquivos separados, recombine
  antes de rodar.
- `data/imagens.json` — onde você cadastra as URLs das fotos de portfólio por serviço (ver seção
  "Galeria de imagens" abaixo). Vem vazio, exceto um exemplo ilustrativo em `laudo-nr10`.
- `scripts/gerar-posts.js` — script principal.
- `.github/workflows/gerar-posts.yml` — workflow com disparo manual e agendamento diário.

Total: **10 × 740 = 7.400 combinações**. A 10 posts/dia, o ciclo completo se repete a cada ~740
dias (pouco mais de 2 anos) sem repetir conteúdo antes disso.

## Galeria de imagens

Edite `data/imagens.json`. Cada chave é o `id` de um serviço (os mesmos ids de `data/servicos.json`).
Cada imagem é um objeto `{ "url": "...", "alt": "..." }`. Funciona melhor se as imagens já
estiverem na Biblioteca de Mídia do WordPress (URL pública estável) — pode subir as fotos lá
primeiro e copiar a URL de cada uma.

Você pode:
- Usar a chave `"default"` para uma galeria genérica (mesmas fotos institucionais em todo post), ou
- Preencher por serviço (ex: fotos de painel elétrico em `laudo-nr10`, fotos de unifilares em
  `projetos-unifilares`), para a galeria casar com o conteúdo de cada página.

Se um serviço não tiver imagens cadastradas (nem em `default`), a seção de galeria simplesmente
não aparece no post — sem quebrar nada.

O CSS da galeria é inline e usa `flexbox` direto no HTML do post (não depende do bloco nativo do
editor), exatamente para não sofrer com temas (como o Astra) que forçam blocos de galeria a 100%
de largura. Cada imagem fica dentro de um `<a>` clicável que abre o tamanho real, e há uma media
query para telas abaixo de 600px.

## Passo 1 — Criar o repositório

1. Crie um repositório **privado** no GitHub (ex: `instel-service/seo-pipeline`).
2. Faça upload de todos os arquivos deste projeto mantendo a estrutura de pastas.

## Passo 2 — Application Password no WordPress

1. No wp-admin, vá em **Usuários → Perfil** (do usuário que vai publicar, idealmente um Administrador).
2. Role até **Senhas de Aplicativo**, dê um nome (ex: "GitHub Actions SEO") e clique em **Adicionar Nova Senha de Aplicativo**.
3. Copie a senha gerada — ela só aparece uma vez.

## Passo 3 — Configurar os Secrets no GitHub

Vá em **Settings → Secrets and variables → Actions** no repositório e crie:

| Secret | Exemplo / observação |
|---|---|
| `OPENAI_API_KEY` | sua chave da API da OpenAI |
| `OPENAI_MODEL` | `gpt-4o` (opcional, esse é o padrão) |
| `WP_URL` | `https://instelservice.com.br` (sem barra no final) |
| `WP_USER` | login do usuário admin do WordPress |
| `WP_APP_PASSWORD` | a senha de aplicativo gerada no Passo 2 |
| `WP_STATUS` | `publish` |
| `EMPRESA_NOME` | `Instel Service` |
| `EMPRESA_URL` | `https://instelservice.com.br` |
| `RESPONSAVEL_NOME` | `Juliano Rodrigues` |
| `RESPONSAVEL_CREDENCIAL` | `Engenheiro Eletricista – CREA-SP 5071122659` |
| `RESPONSAVEL_BIO` | bio resumida (já tem um valor padrão sensato no script, baseado na página `/autor/`) |
| `RESPONSAVEL_URL_PERFIL` | `https://instelservice.com.br/autor/` |
| `WP_WHATSAPP` | `(11) 2987-5942` |
| `WP_WHATSAPP_LINK` | opcional — se o número de WhatsApp real for diferente do telefone exibido no site, informe aqui só os dígitos com código do país (ex: `5511987654321`) |
| `WP_EMAIL` | `juliano@instelservice.com.br` |
| `POSTS_POR_DIA` | `10` |
| `MIN_RELACIONADOS` | `3` (opcional — mínimo de posts existentes para exibir a seção "relacionados") |

> Todos os campos acima (exceto os técnicos de API/WordPress) já têm um valor padrão sensato
> direto no script, tirado da página `https://instelservice.com.br/autor/`. Você só *precisa*
> mesmo configurar `OPENAI_API_KEY`, `WP_URL`, `WP_USER`, `WP_APP_PASSWORD` e `WP_STATUS`.

> **Confirme se o WhatsApp `(11) 2987-5942` recebe mensagens pelo `wa.me`** (alguns números
> fixos não funcionam no WhatsApp). Se o número real de atendimento for outro (ex: um celular),
> me avise para eu trocar o padrão, ou configure `WP_WHATSAPP_LINK`.

> Atenção à armadilha do editor web do GitHub: campos de Secrets podem exigir verificação de
> e-mail antes de aceitar a atualização, e o editor de arquivos de código (CodeMirror) não aceita
> colar/injetar valor diretamente — prefira sempre **selecionar tudo + colar** ou editar via API
> do GitHub.

## Passo 4 — Testar manualmente antes de agendar

1. Vá na aba **Actions** do repositório → workflow "Gerar e Publicar Posts SEO" → **Run workflow**.
2. Acompanhe o log. Se algo falhar, o erro de cada combinação aparece no resumo final sem travar as demais.
3. Confira no WordPress se o post saiu: sem `<h1>` duplicado, breadcrumb visível, FAQ visível em H3,
   box de autor renderizando, CTAs de WhatsApp funcionando, e os três `<script type="application/ld+json">`
   (BreadcrumbList + FAQPage + Service) no HTML.

## Passo 5 — Ativar o agendamento

O cron já está configurado para rodar 1x por dia (09h em São Paulo) e publicar os 10 posts daquele
dia em sequência. Não precisa de nenhuma ação adicional — uma vez com os Secrets configurados,
ele roda sozinho.

## Observações técnicas importantes

- **Sem banco de dados / estado persistido para a rotação**: o índice de combinação usa
  `(diaDoAno × postsPorDia) % totalCombinações`, então não depende de nenhum arquivo de controle.
- **Estado real só para tags/linkagem interna**: a única coisa que o script consulta no WordPress
  antes de publicar é a existência de tags e de posts relacionados — isso é necessário para a
  seção "Serviços relacionados" não gerar links quebrados.
- **JSON-LD dentro do conteúdo**: os schemas são injetados como `<script type="application/ld+json">`
  direto no corpo do post. Funciona bem com usuário Administrador, mas alguns plugins de segurança
  (ex: Wordfence) ou configurações de `wp_kses` podem filtrar a tag `<script>` do conteúdo — vale
  checar o HTML final publicado nas primeiras execuções.
- **Preço sempre "a consultar"**: por decisão sua, o post nunca exibe valores. A IA é instruída a
  nunca citar preços, e o script sempre injeta um bloco fixo convidando o leitor a pedir orçamento.
- **Sem dados inventados**: a IA é instruída a nunca citar estatísticas de mercado específicas
  (percentuais de valorização, números de imóveis, etc.) que não possa verificar — só pode citar
  bairros vizinhos reais (que o script já fornece a partir da subprefeitura oficial) e
  características gerais conhecidas da região.
- **Rate limit da OpenAI**: o script roda as 10 gerações em sequência (não em paralelo).
