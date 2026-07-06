// gerar-posts.js
// Pipeline de geração e publicação automática de conteúdo SEO — Instel Service
// Estrutura de página inspirada em referência de mercado, pensada para
// SEO (rankear no Google) + AEO (ser citado em respostas de IA) +
// GEO/AIO (ser entendido e reutilizado por LLMs) + SXO (conversão real via WhatsApp).
// Roda via GitHub Actions (Node 20+, fetch nativo, sem dependências externas).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. CONFIGURAÇÃO (lida de variáveis de ambiente / GitHub Secrets)
// ---------------------------------------------------------------------------
const CONFIG = {
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  wpUrl: requireEnv("WP_URL").replace(/\/+$/, ""), // sem barra final
  wpUser: requireEnv("WP_USER"),
  wpAppPassword: requireEnv("WP_APP_PASSWORD"),
  wpStatus: process.env.WP_STATUS || "publish",
  empresaNome: process.env.EMPRESA_NOME || "Instel Service",
  empresaUrl: process.env.EMPRESA_URL || "https://instelservice.com.br",
  responsavelNome: process.env.RESPONSAVEL_NOME || "Juliano Rodrigues",
  responsavelCredencial:
    process.env.RESPONSAVEL_CREDENCIAL || "Engenheiro Eletricista – CREA-SP 5071122659",
  responsavelBio:
    process.env.RESPONSAVEL_BIO ||
    "Fundador da Instel Service, atua há mais de 10 anos em engenharia elétrica e é responsável técnico por todos os serviços e conteúdos da empresa. Graduado em Engenharia Elétrica pela Universidade Nove de Julho, com certificação NR-10 e especialização em SPDA (NBR 5419).",
  responsavelUrlPerfil: process.env.RESPONSAVEL_URL_PERFIL || "https://instelservice.com.br/autor/",
  whatsapp: process.env.WP_WHATSAPP || "(11) 2987-5942",
  email: process.env.WP_EMAIL || "juliano@instelservice.com.br",
  whatsappLink: process.env.WP_WHATSAPP_LINK || null, // se vazio, é derivado do telefone
  postsPorDia: parseInt(process.env.POSTS_POR_DIA || "10", 10),
  minRelacionadosParaExibir: parseInt(process.env.MIN_RELACIONADOS || "3", 10),
  // Permite forçar um índice inicial específico para testes (opcional)
  indiceForcado:
    process.env.INDICE_FORCADO !== undefined && process.env.INDICE_FORCADO !== ""
      ? parseInt(process.env.INDICE_FORCADO, 10)
      : null,
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function montarLinkWhatsapp(mensagem) {
  const numero =
    CONFIG.whatsappLink || `55${CONFIG.whatsapp.replace(/\D/g, "")}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

// ---------------------------------------------------------------------------
// 2. CARREGAMENTO DOS DADOS (serviços × localidades × imagens)
// ---------------------------------------------------------------------------
async function carregarJson(nomeArquivo, fallback) {
  try {
    const raw = await readFile(path.join(__dirname, "..", "data", nomeArquivo), "utf-8");
    return JSON.parse(raw);
  } catch (erro) {
    if (erro.code === "ENOENT" && fallback !== undefined) return fallback;
    throw erro;
  }
}

async function carregarDados() {
  const [servicos, localidades, imagens] = await Promise.all([
    carregarJson("servicos.json"),
    carregarJson("localidades.json"),
    carregarJson("imagens.json", {}), // opcional — ver README sobre como preencher
  ]);
  return { servicos, localidades, imagens };
}

// ---------------------------------------------------------------------------
// 3. LÓGICA DE ROTAÇÃO (cobre todas as combinações progressivamente)
// ---------------------------------------------------------------------------
function diaDoAno(data = new Date()) {
  const inicioDoAno = new Date(data.getFullYear(), 0, 0);
  const diff = data - inicioDoAno;
  const umDia = 1000 * 60 * 60 * 24;
  return Math.floor(diff / umDia);
}

export function gerarCombinacoesDoDia({ servicos, localidades }) {
  const totalCombinacoes = servicos.length * localidades.length;
  const dia = diaDoAno();
  const indiceBase =
    CONFIG.indiceForcado !== null
      ? CONFIG.indiceForcado
      : (dia * CONFIG.postsPorDia) % totalCombinacoes;

  const combinacoes = [];
  for (let i = 0; i < CONFIG.postsPorDia; i++) {
    const indice = (indiceBase + i) % totalCombinacoes;
    const servicoIdx = indice % servicos.length;
    const localidadeIdx = Math.floor(indice / servicos.length) % localidades.length;
    combinacoes.push({
      servico: servicos[servicoIdx],
      localidade: localidades[localidadeIdx],
      indiceGlobal: indice,
    });
  }
  return combinacoes;
}

// ---------------------------------------------------------------------------
// 4. PROMPT PARA A IA (OpenAI) — pede JSON estruturado por seção,
//    para o script montar a página de forma determinística (sem depender
//    da IA "se comportar" para H1, CTAs, preço, etc.)
// ---------------------------------------------------------------------------
function montarPromptSistema() {
  return `Você é um redator técnico especializado em SEO, AEO e GEO (otimização para motores de busca tradicionais e para IAs generativas), escrevendo para o site da empresa ${CONFIG.empresaNome}.
O responsável técnico do conteúdo é ${CONFIG.responsavelNome} (${CONFIG.responsavelCredencial}).

Responda SEMPRE em JSON válido, sem markdown, sem crases, sem texto fora do JSON, seguindo exatamente este formato:

{
  "titulo": "string, título do post (inclua o nome do serviço e da localidade)",
  "metaDescricao": "string, até 155 caracteres, resumo atrativo para SEO",
  "introducaoHtml": "1 parágrafo <p> de abertura, direto ao ponto, mencionando o serviço, a localidade e a credibilidade técnica (CREA-SP), sem usar heading",
  "secaoOQueE": {
    "tituloH2": "ex: O que é [serviço]?",
    "definicaoTecnica": { "tituloH3": "string", "html": "<p>...</p>" },
    "quemDeveContratar": { "tituloH3": "string", "html": "<p>...</p>" }
  },
  "secaoPorQueContratar": {
    "tituloH2": "ex: Por que contratar [serviço] em [localidade]?",
    "contextoLocal": { "tituloH3": "string", "html": "<p>...</p>" },
    "riscosDeNaoContratar": { "tituloH3": "string", "html": "<p>...</p>" }
  },
  "secaoOQueEntregamos": {
    "tituloH2": "ex: O que avaliamos / entregamos no serviço",
    "itens": [
      { "tituloH3": "string", "html": "<p>...</p>" }
    ]
  },
  "secaoComoFunciona": {
    "tituloH2": "ex: Como funciona o serviço da ${CONFIG.empresaNome} em [localidade]",
    "itens": [
      { "tituloH3": "string", "html": "<p>...</p>" }
    ]
  },
  "faq": [
    { "pergunta": "string", "resposta": "string" }
  ]
}

Regras obrigatórias:
- NUNCA use tags <h1>, <h2> ou <h3> dentro dos campos "html" — esses títulos já são os campos "tituloH2"/"tituloH3" e o script monta os headings.
- "secaoOQueEntregamos.itens": entre 4 e 6 itens, cada um cobrindo um aspecto técnico diferente do serviço (ex: normas específicas verificadas, etapas do levantamento, tipos de não-conformidade comuns), citando normas técnicas/legais aplicáveis (NBR 5410, NBR 5419, NR-10, NR-12, exigências da concessionária/ANEEL, Corpo de Bombeiros/AVCB conforme o caso) de forma natural e correta — nunca cite uma norma errada para o contexto.
- "secaoComoFunciona.itens": exatamente 3 itens, no padrão: 1) como agendar/contratar, 2) como é a execução técnica no local, 3) como é a entrega do laudo/documento final.
- "faq": exatamente 5 perguntas frequentes específicas sobre "${"{{SERVICO}}"} em {{LOCALIDADE}}", com respostas objetivas (2-4 frases).
- "secaoPorQueContratar.contextoLocal": pode mencionar bairros/municípios vizinhos reais se fornecidos no contexto, e características gerais conhecidas da região (perfil residencial/comercial/industrial), mas NUNCA invente números específicos (percentuais de valorização, estatísticas, quantidade de imóveis, dados que você não tem certeza). Se não tiver informação confiável sobre a região, fale em termos gerais sem citar números.
- NUNCA mencione preço, valor, faixa de investimento ou custo em nenhum campo — isso é tratado separadamente pelo site.
- Mínimo de 900 palavras somando todo o conteúdo textual (sem contar tags HTML).
- Use <p>, <ul>/<li> quando fizer sentido. Linguagem clara para leigos, mantendo precisão técnica.`;
}

function montarPromptUsuario({ servico, localidade }) {
  const contextoLocal =
    localidade.tipo === "bairro"
      ? `o bairro de ${localidade.nome}, na cidade de São Paulo (capital)`
      : `o município de ${localidade.nome}, no estado de São Paulo`;

  const vizinhosTexto =
    localidade.vizinhos && localidade.vizinhos.length > 0
      ? `Bairros vizinhos reais (mesma subprefeitura, pode citar): ${localidade.vizinhos.join(", ")}.`
      : "";

  const perfilLocal = localidade.tipo === "bairro"
    ? `Bairro urbano de São Paulo com mix residencial, comercial e industrial.`
    : `Município do interior paulista com perfil predominantemente residencial e agroindustrial.`;

  return `Escreva o conteúdo para uma página sobre o serviço "${servico.nome}" (${servico.descricaoCurta}), com foco em atendimento em ${contextoLocal}.

Empresa: ${CONFIG.empresaNome}.
Responsável técnico: ${CONFIG.responsavelNome}, ${CONFIG.responsavelCredencial}.
Perfil da localidade: ${perfilLocal}
${vizinhosTexto}

Mencione ${localidade.nome} pelo menos 6 vezes. Mencione ${CONFIG.empresaNome} pelo menos 3 vezes.
Siga rigorosamente o formato JSON e as regras definidas nas instruções de sistema.`;
}

// ---------------------------------------------------------------------------
// 5. CHAMADA À API DA OPENAI
// ---------------------------------------------------------------------------
async function gerarConteudoComIA({ servico, localidade }) {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.openaiModel,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: montarPromptSistema() },
        { role: "user", content: montarPromptUsuario({ servico, localidade }) },
      ],
    }),
  });

  if (!resposta.ok) {
    const corpoErro = await resposta.text();
    throw new Error(`Erro na API da OpenAI (${resposta.status}): ${corpoErro}`);
  }

  const dados = await resposta.json();
  const textoBruto = dados.choices?.[0]?.message?.content ?? "";
  return parsearJsonDaIA(textoBruto);
}

// Armadilha conhecida: a API às vezes envolve a resposta em ```json ... ```
// mesmo com response_format=json_object. Limpa antes de parsear.
function parsearJsonDaIA(textoBruto) {
  const limpo = removerMarkdownFences(textoBruto).trim();
  try {
    return JSON.parse(limpo);
  } catch (erro) {
    throw new Error(
      `Falha ao parsear JSON retornado pela IA. Conteúdo recebido (primeiros 500 caracteres): ${limpo.slice(
        0,
        500
      )}`
    );
  }
}

function removerMarkdownFences(texto) {
  return texto.replace(/^```(?:json|html)?\s*/i, "").replace(/```\s*$/i, "");
}

// Strip agressivo de <h1>/<h2>/<h3> em campos de texto livre, por segurança
// (defesa extra — a IA já é instruída a nunca usar headings nesses campos)
function removerHeadingsIndevidos(html) {
  return String(html || "").replace(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi, "");
}

function escapeHtml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(texto) {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// 6. GALERIA DE IMAGENS (opcional — ver data/imagens.json e README)
// ---------------------------------------------------------------------------
function obterImagensDoServico(imagens, servico) {
  const lista = imagens[servico.id] || imagens.default || [];
  return Array.isArray(lista) ? lista.slice(0, 5) : [];
}

// CSS inline para não depender do bloco de galeria nativo do editor
// (armadilha conhecida: temas como Astra forçam a galeria a 100% de largura).
// Cada imagem fica dentro de um <a> clicável que abre o tamanho real.
function montarGaleria(listaImagens, { servico, localidade }) {
  if (!listaImagens || listaImagens.length === 0) return "";

  const altContextos = [
    `${servico.nome} em ${localidade.nome} — inspeção técnica no local`,
    `Laudo elétrico ${localidade.nome} — Instel Service`,
    `${servico.nome} em ${localidade.nome} — Engenheiro CREA-SP`,
    `Instalação elétrica ${localidade.nome} — vistoria com marcações técnicas`,
    `${servico.nome} — laudo com ART do CREA-SP`,
  ];

  const lbId = "lb" + Math.random().toString(36).slice(2, 8);

  const items = listaImagens.map((img, i) =>
    `<figure style="margin:0;flex:0 0 calc(20% - 5px)"><a href="${escapeHtml(img.url)}" data-vlb="${lbId}" data-idx="${i}" style="display:block;cursor:zoom-in"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(altContextos[i] || img.alt)}" loading="${i === 0 ? "eager" : "lazy"}" style="width:100%;height:110px;object-fit:cover;border-radius:4px;display:block;transition:opacity .2s" /></a></figure>`
  ).join("\n");

  const imgsJson = JSON.stringify(listaImagens.map((img, i) => ({ url: img.url, alt: altContextos[i] || img.alt })));

  return `<style>
.vlb-${lbId}{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.92);z-index:99999;align-items:center;justify-content:center;flex-direction:column}
.vlb-${lbId}.open{display:flex}
.vlb-${lbId} img{max-width:90vw;max-height:80vh;object-fit:contain;border-radius:6px}
.vlb-${lbId} .vc{position:fixed;font-size:40px;color:#fff;cursor:pointer;background:none;border:none;z-index:100000;opacity:.8}
.vlb-${lbId} .vc:hover{opacity:1}
.vlb-${lbId} .vx{top:16px;right:20px}
.vlb-${lbId} .vp{top:50%;transform:translateY(-50%);left:8px}
.vlb-${lbId} .vn{top:50%;transform:translateY(-50%);right:8px}
@media(max-width:600px){.gt-${lbId} figure{flex:0 0 calc(33.33% - 4px) !important}}
</style>
<div class="gt-${lbId}" style="display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 24px">
${items}
</div>
<div class="vlb-${lbId}" id="vlb-${lbId}">
  <button class="vc vx" onclick="document.getElementById('vlb-${lbId}').classList.remove('open');document.body.style.overflow=''">&#10005;</button>
  <button class="vc vp" id="vp-${lbId}">&#8249;</button>
  <img id="vi-${lbId}" src="" alt="" />
  <button class="vc vn" id="vn-${lbId}">&#8250;</button>
</div>
<script>
(function(){var I=${imgsJson},c=0,b=document.getElementById('vlb-${lbId}');
function s(i){c=(i+I.length)%I.length;document.getElementById('vi-${lbId}').src=I[c].url;document.getElementById('vi-${lbId}').alt=I[c].alt;}
function o(i){b.classList.add('open');document.body.style.overflow='hidden';s(i);}
document.getElementById('vp-${lbId}').onclick=function(){s(c-1);};
document.getElementById('vn-${lbId}').onclick=function(){s(c+1);};
b.onclick=function(e){if(e.target===b){b.classList.remove('open');document.body.style.overflow='';}};
document.addEventListener('click',function(e){var a=e.target.closest('[data-vlb="${lbId}"]');if(a){e.preventDefault();o(parseInt(a.dataset.idx)||0);}});
document.addEventListener('keydown',function(e){if(!b.classList.contains('open'))return;if(e.key==='ArrowRight')s(c+1);if(e.key==='ArrowLeft')s(c-1);if(e.key==='Escape'){b.classList.remove('open');document.body.style.overflow='';}});
})();
</script>`;
}

// ---------------------------------------------------------------------------
// 7. BREADCRUMB (visível + schema BreadcrumbList)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TABELA DE APLICABILIDADE (inserida após "O que avaliamos")
// ---------------------------------------------------------------------------
function montarTabelaAplicabilidade(servico) {
  const tabelas = {
    "laudo-demanda-eletrica": [
      ["Contratação de nova ligação elétrica", "ANEEL / concessionária", "Obrigatório"],
      ["Adequação de demanda contratada", "ANEEL Resolução 414", "Obrigatório"],
      ["Empresas com consumo acima de 75 kW", "ANEEL / NR-10", "Obrigatório"],
      ["Expansão de capacidade instalada", "NBR 5410", "Recomendado"],
    ],
    "laudo-nr10": [
      ["Trabalhadores em instalações elétricas", "NR-10 item 10.8", "Obrigatório"],
      ["Prontuário das instalações elétricas", "NR-10 item 10.2.4", "Obrigatório"],
      ["Empresas com geração própria de energia", "NR-10 Seção II", "Obrigatório"],
      ["Manutenção em alta tensão", "NR-10 item 10.9", "Obrigatório"],
    ],
    "estudo-de-cargas-eletricas": [
      ["Projeto de instalação residencial nova", "NBR 5410", "Obrigatório"],
      ["Reforma com aumento de carga", "NBR 5410", "Obrigatório"],
      ["Dimensionamento de equipamentos industriais", "NBR 5462", "Recomendado"],
      ["Edificações multifamiliares", "NBR 5410 + ABNT", "Obrigatório"],
    ],
    "spda-para-raios": [
      ["Edificações acima de 5 andares", "NBR 5419", "Obrigatório"],
      ["Estruturas com área superior a 250 m²", "NBR 5419", "Análise de risco"],
      ["Indústrias e áreas classificadas", "NBR 5419 + NR-10", "Obrigatório"],
      ["Instalações com equipamentos sensíveis", "NBR 5419", "Recomendado"],
    ],
  };
  const linhas = tabelas[servico.id] || [
    ["Instalações residenciais e comerciais novas", "NBR 5410", "Obrigatório"],
    ["Reformas e adequações elétricas", "NBR 5410 / ABNT", "Obrigatório"],
    ["Fiscalização técnica", "CREA-SP / ART", "Recomendado"],
    ["Regularização junto a órgãos", "Concessionária / Bombeiros", "Situacional"],
  ];
  return `<h2>Quando o serviço é obrigatório ou recomendado</h2>
<table>
<thead><tr><th>Situação</th><th>Base legal / norma</th><th>Exigência</th></tr></thead>
<tbody>
${linhas.map(([s, b, e]) => `<tr><td>${s}</td><td>${b}</td><td>${e}</td></tr>`).join("\n")}
</tbody></table>
<p>Todos os laudos incluem Anotação de Responsabilidade Técnica (ART) registrada no CREA-SP, com validade jurídica para concessionárias, prefeitura, Corpo de Bombeiros e demais órgãos.</p>`;
}

function montarBreadcrumbHtml({ servico, localidade, tituloPagina }) {
  return `<nav class="instel-breadcrumb" aria-label="breadcrumb" style="font-size:14px;color:#666;margin-bottom:16px;">
  <a href="${escapeHtml(CONFIG.empresaUrl)}">Home</a> &raquo;
  <a href="${escapeHtml(CONFIG.empresaUrl)}/servicos/">Serviços</a> &raquo;
  <span>${escapeHtml(tituloPagina)}</span>
</nav>`;
}

function montarSchemaBreadcrumb({ tituloPagina }) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: CONFIG.empresaUrl },
      {
        "@type": "ListItem",
        position: 2,
        name: "Serviços",
        item: `${CONFIG.empresaUrl}/servicos/`,
      },
      { "@type": "ListItem", position: 3, name: tituloPagina },
    ],
  };
}

// ---------------------------------------------------------------------------
// 8. BLOCOS FIXOS (CTA WhatsApp, orçamento, box de autor) — não dependem da IA
// ---------------------------------------------------------------------------
function montarCtaWhatsapp({ servico, localidade, variante }) {
  const mensagem =
    variante === "meio"
      ? `Olá! Vi o conteúdo sobre ${servico.nome} em ${localidade.nome} e quero falar com ${CONFIG.responsavelNome}.`
      : `Olá! Preciso de ${servico.nome} em ${localidade.nome}. Pode me ajudar?`;

  const textoBotao =
    variante === "meio" ? "📲 Falar agora pelo WhatsApp →" : "📲 Solicitar orçamento pelo WhatsApp →";

  const pergunta =
    variante === "meio"
      ? `<strong>Precisa de ${escapeHtml(servico.nome)} em ${escapeHtml(localidade.nome)}?</strong> Fale agora com ${escapeHtml(CONFIG.responsavelNome)} pelo WhatsApp.`
      : `<strong>Pronto para agendar ${escapeHtml(servico.nome)} em ${escapeHtml(localidade.nome)}?</strong> Solicite um orçamento sem compromisso.`;

  return `<p>${pergunta}</p>
<p><a href="${montarLinkWhatsapp(mensagem)}" target="_blank" rel="noopener">${textoBotao}</a></p>`;
}

function montarBlocoOrcamento() {
  return `<p><strong>Investimento:</strong> os valores variam conforme o escopo e as características do imóvel ou empresa — <a href="${escapeHtml(
    CONFIG.empresaUrl
  )}/contato">solicite um orçamento personalizado</a> (a consultar).</p>`;
}

function montarBoxAutor() {
  return `
<div class="instel-box-autor" style="margin-top:40px;padding:20px;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa;">
  <p style="margin:0 0 6px;font-weight:bold;">
    <a href="${escapeHtml(CONFIG.responsavelUrlPerfil)}">${escapeHtml(CONFIG.responsavelNome)}</a>
  </p>
  <p style="margin:0 0 6px;color:#555;">${escapeHtml(CONFIG.responsavelCredencial)}</p>
  <p style="margin:0;color:#555;">${escapeHtml(CONFIG.responsavelBio)}</p>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// 9. SCHEMAS JSON-LD (FAQPage + Service/LocalBusiness + BreadcrumbList)
// ---------------------------------------------------------------------------
function montarSchemaFaqPage(faq) {
  if (!faq || faq.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.pergunta,
      acceptedAnswer: { "@type": "Answer", text: item.resposta },
    })),
  };
}

function montarSchemaService({ servico, localidade }) {
  const areaServida =
    localidade.tipo === "bairro" ? `${localidade.nome}, São Paulo, SP` : `${localidade.nome}, SP`;

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: servico.nome,
    provider: {
      "@type": "LocalBusiness",
      name: CONFIG.empresaNome,
      url: CONFIG.empresaUrl,
      telephone: CONFIG.whatsapp,
      email: CONFIG.email,
    },
    areaServed: { "@type": "Place", name: areaServida },
    description: servico.descricaoCurta,
  };
}

function montarScriptsJsonLd(schemas) {
  return schemas
    .filter(Boolean)
    .map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// 10. TAGS DO WORDPRESS + "SERVIÇOS RELACIONADOS" (internal linking real,
//     sem links quebrados: só lista posts que já existem de fato)
// ---------------------------------------------------------------------------
function authHeaderWp() {
  const auth = Buffer.from(`${CONFIG.wpUser}:${CONFIG.wpAppPassword}`).toString("base64");
  return { Authorization: `Basic ${auth}` };
}

async function buscarOuCriarTag(nome) {
  const buscaUrl = `${CONFIG.wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(nome)}&per_page=10`;
  const respostaBusca = await fetch(buscaUrl, { headers: authHeaderWp() });
  if (!respostaBusca.ok) {
    throw new Error(`Erro ao buscar tag "${nome}" (${respostaBusca.status})`);
  }
  const encontradas = await respostaBusca.json();
  const exata = encontradas.find((t) => t.name.toLowerCase() === nome.toLowerCase());
  if (exata) return exata.id;

  const respostaCriacao = await fetch(`${CONFIG.wpUrl}/wp-json/wp/v2/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaderWp() },
    body: JSON.stringify({ name: nome, slug: slugify(nome) }),
  });
  if (!respostaCriacao.ok) {
    // Pode falhar por concorrência (outra execução criou a tag ao mesmo tempo) — tenta buscar de novo.
    const segundaBusca = await fetch(buscaUrl, { headers: authHeaderWp() });
    const segundaLista = segundaBusca.ok ? await segundaBusca.json() : [];
    const achou = segundaLista.find((t) => t.name.toLowerCase() === nome.toLowerCase());
    if (achou) return achou.id;
    const corpoErro = await respostaCriacao.text();
    throw new Error(`Erro ao criar tag "${nome}" (${respostaCriacao.status}): ${corpoErro}`);
  }
  const criada = await respostaCriacao.json();
  return criada.id;
}

async function buscarPostsRelacionados({ tagServicoId, tagLocalidadeAtualId }) {
  const url = `${CONFIG.wpUrl}/wp-json/wp/v2/posts?tags=${tagServicoId}&per_page=10&_fields=id,title,link,tags`;
  const resposta = await fetch(url, { headers: authHeaderWp() });
  if (!resposta.ok) return []; // não trava a publicação por causa do link building

  const posts = await resposta.json();
  const relacionados = posts.filter((p) => !p.tags?.includes(tagLocalidadeAtualId));

  if (relacionados.length < CONFIG.minRelacionadosParaExibir) return [];
  return relacionados.slice(0, 5).map((p) => ({ titulo: p.title.rendered, link: p.link }));
}

function montarSecaoRelacionados(relacionados, { servico, localidade }) {
  if (!relacionados || relacionados.length === 0) return "";
  const itens = relacionados
    .map((r) => `<li><a href="${escapeHtml(r.link)}">${r.titulo}</a></li>`)
    .join("\n");
  return `<h2>Serviços relacionados em ${escapeHtml(localidade.nome)} e região</h2>
<ul>
${itens}
</ul>`;
}

// ---------------------------------------------------------------------------
// 11. MONTAGEM DO HTML FINAL (junta tudo na ordem da estrutura de referência)
// ---------------------------------------------------------------------------
function montarSecaoComItens(secao) {
  if (!secao) return "";
  const itensHtml = (secao.itens || [])
    .map(
      (item) =>
        `<h3>${escapeHtml(item.tituloH3)}</h3>\n${removerHeadingsIndevidos(item.html)}`
    )
    .join("\n");
  return `<h2>${escapeHtml(secao.tituloH2)}</h2>\n${itensHtml}`;
}

function montarSecaoDuasPartes(secao, chaveA, chaveB) {
  if (!secao) return "";
  const a = secao[chaveA];
  const b = secao[chaveB];
  return `<h2>${escapeHtml(secao.tituloH2)}</h2>
<h3>${escapeHtml(a.tituloH3)}</h3>
${removerHeadingsIndevidos(a.html)}
<h3>${escapeHtml(b.tituloH3)}</h3>
${removerHeadingsIndevidos(b.html)}`;
}

function montarSecaoFaq(faq, { servico, localidade }) {
  if (!faq || faq.length === 0) return "";
  const itens = faq
    .map(
      (item) =>
        `<h3>${escapeHtml(item.pergunta)}</h3>\n<p>${escapeHtml(item.resposta)}</p>`
    )
    .join("\n");
  return `<h2>Perguntas frequentes sobre ${escapeHtml(servico.nome)} em ${escapeHtml(
    localidade.nome
  )}</h2>
${itens}`;
}

export function montarHtmlFinal({ conteudo, servico, localidade, listaImagens, relacionados, tituloPagina }) {
  const blocos = [
    montarBreadcrumbHtml({ servico, localidade, tituloPagina }),
    montarGaleria(listaImagens, { servico, localidade }),
    removerHeadingsIndevidos(conteudo.introducaoHtml),
    montarSecaoDuasPartes(conteudo.secaoOQueE, "definicaoTecnica", "quemDeveContratar"),
    montarSecaoDuasPartes(conteudo.secaoPorQueContratar, "contextoLocal", "riscosDeNaoContratar"),
    montarSecaoComItens(conteudo.secaoOQueEntregamos),
    montarTabelaAplicabilidade(servico),
    montarCtaWhatsapp({ servico, localidade, variante: "meio" }),
    montarSecaoComItens(conteudo.secaoComoFunciona),
    montarSecaoFaq(conteudo.faq, { servico, localidade }),
    montarCtaWhatsapp({ servico, localidade, variante: "final" }),
    montarBlocoOrcamento(),
    montarSecaoRelacionados(relacionados, { servico, localidade }),
    montarBoxAutor(),
    montarScriptsJsonLd([
      montarSchemaBreadcrumb({ tituloPagina }),
      montarSchemaFaqPage(conteudo.faq),
      montarSchemaService({ servico, localidade }),
      {
        "@context": "https://schema.org",
        "@type": "Person",
        name: CONFIG.responsavelNome,
        jobTitle: "Engenheiro Eletricista",
        hasCredential: CONFIG.responsavelCredencial,
        url: CONFIG.responsavelUrlPerfil,
        worksFor: { "@type": "Organization", name: CONFIG.empresaNome, url: CONFIG.empresaUrl },
      },
    ]),
  ];

  return blocos.filter((bloco) => bloco && bloco.trim().length > 0).join("\n\n");
}

// ---------------------------------------------------------------------------
// 12. PUBLICAÇÃO NO WORDPRESS (REST API + Application Password)
// ---------------------------------------------------------------------------
async function publicarNoWordpress({ titulo, metaDescricao, htmlFinal, tagIds }) {
  const resposta = await fetch(`${CONFIG.wpUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaderWp() },
    body: JSON.stringify({
      title: titulo,
      content: htmlFinal,
      status: CONFIG.wpStatus,
      excerpt: metaDescricao,
      tags: tagIds,
    }),
  });

  if (!resposta.ok) {
    const corpoErro = await resposta.text();
    throw new Error(`Erro ao publicar no WordPress (${resposta.status}): ${corpoErro}`);
  }

  return resposta.json();
}

// ---------------------------------------------------------------------------
// 13. ORQUESTRAÇÃO PRINCIPAL
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Iniciando geração de ${CONFIG.postsPorDia} post(s) para ${CONFIG.empresaNome}...`);

  const dados = await carregarDados();
  const combinacoes = gerarCombinacoesDoDia(dados);

  console.log(`Total de combinações possíveis: ${dados.servicos.length * dados.localidades.length}`);

  const resultados = [];

  // Processado sequencialmente (não em paralelo) para evitar rate limit
  // na OpenAI e excesso de chamadas simultâneas na API do WordPress.
  for (const combinacao of combinacoes) {
    const { servico, localidade, indiceGlobal } = combinacao;
    const rotulo = `[${indiceGlobal}] ${servico.nome} × ${localidade.nome}`;

    try {
      console.log(`Gerando conteúdo: ${rotulo}`);
      const conteudo = await gerarConteudoComIA({ servico, localidade });
      const tituloPagina = conteudo.titulo;

      console.log(`Resolvendo tags no WordPress: ${rotulo}`);
      const tagServicoId = await buscarOuCriarTag(servico.nome);
      const tagLocalidadeId = await buscarOuCriarTag(localidade.nome);

      const relacionados = await buscarPostsRelacionados({
        tagServicoId,
        tagLocalidadeAtualId: tagLocalidadeId,
      });

      const listaImagens = obterImagensDoServico(dados.imagens, servico);

      const htmlFinal = montarHtmlFinal({
        conteudo,
        servico,
        localidade,
        listaImagens,
        relacionados,
        tituloPagina,
      });

      console.log(`Publicando no WordPress: ${rotulo}`);
      const post = await publicarNoWordpress({
        titulo: tituloPagina,
        metaDescricao: conteudo.metaDescricao,
        htmlFinal,
        tagIds: [tagServicoId, tagLocalidadeId],
      });

      console.log(`OK -> Post publicado: ${post.link || post.id}`);
      resultados.push({ rotulo, sucesso: true, postId: post.id, link: post.link });
    } catch (erro) {
      console.error(`FALHOU -> ${rotulo}: ${erro.message}`);
      resultados.push({ rotulo, sucesso: false, erro: erro.message });
    }
  }

  const falhas = resultados.filter((r) => !r.sucesso);
  console.log(`\nResumo: ${resultados.length - falhas.length} ok, ${falhas.length} falha(s).`);

  if (falhas.length > 0) {
    console.error("Combinações que falharam:", JSON.stringify(falhas, null, 2));
    process.exitCode = 1; // marca o workflow como falho para alertar (sem travar os que deram certo)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((erro) => {
    console.error("Erro fatal no pipeline:", erro);
    process.exit(1);
  });
}

