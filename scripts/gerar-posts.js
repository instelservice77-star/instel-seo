// gerar-posts.js — Instel Service SEO Pipeline v2
// Melhorias v2: galeria com lightbox (estilo Vistoh), bootstrap automático de imagens,
// tabela de obrigatoriedade no conteúdo, schemas Person + LocalBusiness,
// prompt enriquecido com contexto por localidade.

import { readFile, writeFile, existsSync } from "node:fs/promises";
import { existsSync as existsSync_ } from "node:fs";
import { createReadStream } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. CONFIGURAÇÃO
// ---------------------------------------------------------------------------
const CONFIG = {
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  wpUrl: requireEnv("WP_URL").replace(/\/+$/, ""),
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
  whatsappLink: process.env.WP_WHATSAPP_LINK || null,
  email: process.env.WP_EMAIL || "contato@instelservice.com.br",
  postsPorDia: parseInt(process.env.POSTS_POR_DIA || "10", 10),
  minRelacionadosParaExibir: parseInt(process.env.MIN_RELACIONADOS || "3", 10),
  indiceForcado:
    process.env.INDICE_FORCADO !== undefined && process.env.INDICE_FORCADO !== ""
      ? parseInt(process.env.INDICE_FORCADO, 10)
      : null,
  // Cache de imagens já enviadas ao WP (evita re-upload a cada run)
  imagensCache: "/tmp/instel-imagens-wp.json",
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function montarLinkWhatsapp(mensagem) {
  const numero = CONFIG.whatsappLink || `55${CONFIG.whatsapp.replace(/\D/g, "")}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

// ---------------------------------------------------------------------------
// 2. BANCO DE IMAGENS — metadados SEO por foto
//    Adicione arquivos .webp em instel-seo/imagens/ com esses nomes exatos.
//    Na primeira execução eles serão enviados ao WordPress e cacheados.
//    Se o arquivo não existir, a imagem é simplesmente ignorada (sem erro).
// ---------------------------------------------------------------------------
const IMAGENS_META = [
  { arquivo: "eletrica-01.webp", alt: "engenheiro elétrico realizando inspeção em painel elétrico de baixa tensão" },
  { arquivo: "eletrica-02.webp", alt: "quadro de distribuição elétrica com disjuntores identificados em laudo técnico" },
  { arquivo: "eletrica-03.webp", alt: "medição de corrente elétrica com alicate amperímetro em instalação comercial" },
  { arquivo: "eletrica-04.webp", alt: "fiação elétrica com inconformidade identificada e marcada em vistoria NR-10" },
  { arquivo: "eletrica-05.webp", alt: "aterramento elétrico sendo verificado em medição de resistência" },
  { arquivo: "eletrica-06.webp", alt: "inspeção de instalação elétrica em área classificada com risco de explosão" },
  { arquivo: "eletrica-07.webp", alt: "laudo elétrico com relatório de não conformidades e recomendações técnicas" },
  { arquivo: "eletrica-08.webp", alt: "tomada e ponto elétrico com marcação técnica em vistoria de imóvel" },
  { arquivo: "eletrica-09.webp", alt: "SPDA para-raios sendo inspecionado conforme NBR 5419 em edificação" },
  { arquivo: "eletrica-10.webp", alt: "medidor de tensão verificando conformidade de instalação elétrica residencial" },
];

// ---------------------------------------------------------------------------
// 3. UPLOAD AUTOMÁTICO DE IMAGENS AO WORDPRESS (na 1ª execução)
// ---------------------------------------------------------------------------
function httpRequestNode(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const data = Buffer.concat(chunks);
        try { resolve({ status: res.statusCode, body: JSON.parse(data.toString()) }); }
        catch { resolve({ status: res.statusCode, body: data.toString() }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function bootstrapImagens() {
  // Verificar cache
  try {
    const cache = JSON.parse(await readFile(CONFIG.imagensCache, "utf-8"));
    if (cache.length === IMAGENS_META.length) {
      console.log(`📸 ${cache.length} imagens já no WordPress (cache)`);
      return cache;
    }
  } catch { /* cache não existe ainda */ }

  console.log("📸 Verificando imagens para upload...");
  const uploaded = [];
  const wpHost = new URL(CONFIG.wpUrl).hostname;
  const wpAuth = "Basic " + Buffer.from(`${CONFIG.wpUser}:${CONFIG.wpAppPassword}`).toString("base64");

  for (const meta of IMAGENS_META) {
    const imgPath = path.join(__dirname, "..", "imagens", meta.arquivo);

    if (!existsSync_(imgPath)) {
      console.log(`  ⚠️  ${meta.arquivo} não encontrado em ./imagens/ — pulando`);
      uploaded.push({ arquivo: meta.arquivo, url: null, id: null, alt: meta.alt });
      continue;
    }

    const imgData = await readFile(imgPath);

    try {
      const res = await httpRequestNode({
        hostname: wpHost,
        path: "/wp-json/wp/v2/media",
        method: "POST",
        headers: {
          Authorization: wpAuth,
          "Content-Type": "image/webp",
          "Content-Disposition": `attachment; filename="${meta.arquivo}"`,
          "Content-Length": imgData.length,
        },
      }, imgData);

      if (res.body?.id) {
        const mediaId = res.body.id;
        const mediaUrl = res.body.source_url;
        // Atualizar alt text
        const updateBody = Buffer.from(JSON.stringify({ alt_text: meta.alt, caption: `Instel Service — ${meta.alt}`, title: meta.arquivo.replace(".webp", "") }));
        await httpRequestNode({
          hostname: wpHost,
          path: `/wp-json/wp/v2/media/${mediaId}`,
          method: "POST",
          headers: { Authorization: wpAuth, "Content-Type": "application/json", "Content-Length": updateBody.length },
        }, updateBody);
        uploaded.push({ arquivo: meta.arquivo, url: mediaUrl, id: mediaId, alt: meta.alt });
        console.log(`  ✅ ${meta.arquivo} → ID ${mediaId}`);
      } else {
        console.log(`  ❌ ${meta.arquivo}: ${JSON.stringify(res.body).substring(0, 100)}`);
        uploaded.push({ arquivo: meta.arquivo, url: null, id: null, alt: meta.alt });
      }
    } catch (err) {
      console.log(`  ❌ ${meta.arquivo}: ${err.message}`);
      uploaded.push({ arquivo: meta.arquivo, url: null, id: null, alt: meta.alt });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  const sucesso = uploaded.filter((u) => u.url).length;
  console.log(`📸 Imagens: ${sucesso}/${IMAGENS_META.length} disponíveis`);
  await writeFile(CONFIG.imagensCache, JSON.stringify(uploaded, null, 2));
  return uploaded;
}

// Seleciona 5 imagens rotativas por post (mesmo seed = mesmo conjunto, evita repetição sequencial)
function selecionarImagens(imagensWP, postIndex) {
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
  const seed = dayOfYear * CONFIG.postsPorDia + postIndex;
  const disponiveis = imagensWP.filter((i) => i.url);
  if (disponiveis.length === 0) return [];
  const selecionadas = [];
  for (let i = 0; i < 5; i++) {
    selecionadas.push(disponiveis[(seed + i * 7) % disponiveis.length]);
  }
  return selecionadas;
}

// ---------------------------------------------------------------------------
// 4. GALERIA COM LIGHTBOX (estilo Vistoh)
// ---------------------------------------------------------------------------
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

  const galeriaHtml = `<style>
.gt-${lbId}{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 24px}
.gt-${lbId} figure{margin:0;flex:0 0 calc(20% - 5px)}
.gt-${lbId} a{display:block;cursor:zoom-in}
.gt-${lbId} img{width:100%;height:110px;object-fit:cover;border-radius:4px;display:block;transition:opacity .2s}
.gt-${lbId} img:hover{opacity:.8}
@media(max-width:600px){.gt-${lbId} figure{flex:0 0 calc(33.33% - 4px)}.gt-${lbId} img{height:80px}}
.vlb-${lbId}{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.92);z-index:99999;align-items:center;justify-content:center;flex-direction:column}
.vlb-${lbId}.open{display:flex}
.vlb-${lbId} img{max-width:90vw;max-height:80vh;object-fit:contain;border-radius:6px;box-shadow:0 4px 32px rgba(0,0,0,.5)}
.vlb-${lbId} .vlb-close{position:fixed;top:16px;right:20px;font-size:36px;color:#fff;cursor:pointer;line-height:1;opacity:.85;background:none;border:none;z-index:100000}
.vlb-${lbId} .vlb-prev,.vlb-${lbId} .vlb-next{position:fixed;top:50%;transform:translateY(-50%);font-size:48px;color:#fff;cursor:pointer;opacity:.75;background:none;border:none;z-index:100000;padding:0 12px;line-height:1}
.vlb-${lbId} .vlb-prev{left:8px}.vlb-${lbId} .vlb-next{right:8px}
.vlb-${lbId} .vlb-prev:hover,.vlb-${lbId} .vlb-next:hover,.vlb-${lbId} .vlb-close:hover{opacity:1}
.vlb-${lbId} .vlb-counter{color:rgba(255,255,255,.7);font-size:14px;margin-top:10px;font-family:sans-serif}
.vlb-${lbId} .vlb-caption{color:rgba(255,255,255,.85);font-size:13px;margin-top:6px;font-family:sans-serif;text-align:center;max-width:80vw}
</style>
<div class="gt-${lbId}">
${listaImagens.map((img, i) =>
  `<figure><a href="${escapeHtml(img.url)}" data-vlb="${lbId}" data-idx="${i}"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(altContextos[i] || img.alt)}" loading="${i === 0 ? "eager" : "lazy"}" width="800" height="533" /></a></figure>`
).join("\n")}
</div>
<div class="vlb-${lbId}" id="vlb-${lbId}">
  <button class="vlb-close" id="vlb-x-${lbId}" aria-label="Fechar">&#10005;</button>
  <button class="vlb-prev" id="vlb-p-${lbId}" aria-label="Anterior">&#8249;</button>
  <img id="vlb-img-${lbId}" src="" alt="" />
  <button class="vlb-next" id="vlb-n-${lbId}" aria-label="Próxima">&#8250;</button>
  <div class="vlb-counter" id="vlb-cnt-${lbId}"></div>
  <div class="vlb-caption" id="vlb-cap-${lbId}"></div>
</div>
<script type="text/javascript">
(function(){
  var IMGS=${JSON.stringify(listaImagens.map((img, i) => ({ url: img.url, alt: altContextos[i] || img.alt })))};
  var cur=0,box=document.getElementById('vlb-${lbId}');
  function show(i){cur=(i+IMGS.length)%IMGS.length;var el=document.getElementById('vlb-img-${lbId}');el.src=IMGS[cur].url;el.alt=IMGS[cur].alt;document.getElementById('vlb-cnt-${lbId}').textContent=(cur+1)+' / '+IMGS.length;document.getElementById('vlb-cap-${lbId}').textContent=IMGS[cur].alt;}
  function openLB(i){box.classList.add('open');document.body.style.overflow='hidden';show(i);}
  function closeLB(){box.classList.remove('open');document.body.style.overflow='';}
  document.getElementById('vlb-x-${lbId}').addEventListener('click',closeLB);
  document.getElementById('vlb-p-${lbId}').addEventListener('click',function(){show(cur-1);});
  document.getElementById('vlb-n-${lbId}').addEventListener('click',function(){show(cur+1);});
  box.addEventListener('click',function(e){if(e.target===box)closeLB();});
  document.addEventListener('click',function(e){var a=e.target.closest('[data-vlb="${lbId}"]');if(a){e.preventDefault();openLB(parseInt(a.getAttribute('data-idx'))||0);}});
  document.addEventListener('keydown',function(e){if(!box.classList.contains('open'))return;if(e.key==='ArrowRight')show(cur+1);if(e.key==='ArrowLeft')show(cur-1);if(e.key==='Escape')closeLB();});
})();
</script>`;

  return galeriaHtml;
}

// ---------------------------------------------------------------------------
// 5. TABELA DE APLICABILIDADE DO SERVIÇO
//    Inserida após o bloco "O que avaliamos" — contexto sem preço (a consultar)
// ---------------------------------------------------------------------------
function montarTabelaAplicabilidade(servico) {
  // Mapeamento por tipo de serviço → linhas da tabela
  const tabelas = {
    "laudo-demanda-eletrica": [
      ["Contratação de nova ligação", "ANEEL / concessionária", "Obrigatório"],
      ["Adequação de demanda contratada", "ANEEL Resolução 414", "Obrigatório"],
      ["Expansão de capacidade instalada", "NBR 5410", "Recomendado"],
      ["Empresas com consumo acima de 75 kW", "ANEEL / NR-10", "Obrigatório"],
    ],
    "laudo-nr10": [
      ["Trabalhadores que atuam em instalações elétricas", "NR-10 item 10.8", "Obrigatório"],
      ["Prontuário das instalações elétricas", "NR-10 item 10.2.4", "Obrigatório"],
      ["Empresas com geração própria", "NR-10 Seção II", "Obrigatório"],
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
      ["Instalações com equipamentos sensíveis", "NBR 5419", "Recomendado"],
      ["Indústrias e áreas classificadas", "NBR 5419 + NR-10", "Obrigatório"],
    ],
  };

  const linhas = tabelas[servico.id] || [
    ["Instalações residenciais e comerciais novas", "NBR 5410", "Obrigatório"],
    ["Reformas e adequações elétricas", "NBR 5410 / ABNT", "Obrigatório"],
    ["Fiscalização e vistoria técnica", "CREA-SP / ART", "Recomendado"],
    ["Regularização junto a órgãos", "Concessionária / Bombeiros", "Situacional"],
  ];

  return `<h2>Quando o serviço é obrigatório ou recomendado</h2>
<table>
<thead><tr><th>Situação</th><th>Base legal / norma</th><th>Exigência</th></tr></thead>
<tbody>
${linhas.map(([s, b, e]) => `<tr><td>${s}</td><td>${b}</td><td>${e}</td></tr>`).join("\n")}
</tbody>
</table>
<p>Todos os laudos incluem Anotação de Responsabilidade Técnica (ART) registrada no CREA-SP, documento com validade jurídica necessário para apresentação a concessionárias, prefeitura, Corpo de Bombeiros e outros órgãos.</p>`;
}

// ---------------------------------------------------------------------------
// 6. CARREGAMENTO DOS DADOS
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
  const [servicos, localidades] = await Promise.all([
    carregarJson("servicos.json"),
    carregarJson("localidades.json"),
  ]);
  return { servicos, localidades };
}

// ---------------------------------------------------------------------------
// 7. ROTAÇÃO DE COMBINAÇÕES
// ---------------------------------------------------------------------------
function diaDoAno(data = new Date()) {
  const inicioDoAno = new Date(data.getFullYear(), 0, 0);
  return Math.floor((data - inicioDoAno) / (1000 * 60 * 60 * 24));
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
      postIndex: i,
    });
  }
  return combinacoes;
}

// ---------------------------------------------------------------------------
// 8. PROMPT PARA A IA — enriquecido com contexto de localidade
// ---------------------------------------------------------------------------
function montarPromptSistema() {
  return `Você é um redator técnico especializado em SEO, AEO e GEO, escrevendo para o site da empresa ${CONFIG.empresaNome}.
O responsável técnico é ${CONFIG.responsavelNome} (${CONFIG.responsavelCredencial}).

Responda SEMPRE em JSON válido, sem markdown, sem crases, sem texto fora do JSON:

{
  "titulo": "string — título do post com serviço + localidade (máx 60 chars)",
  "metaDescricao": "string — até 155 chars, serviço + localidade + ART CREA-SP + falar pelo WhatsApp",
  "introducaoHtml": "<p> de abertura direta, com serviço, localidade e credencial CREA-SP, sem heading",
  "secaoOQueE": {
    "tituloH2": "O que é [serviço]?",
    "definicaoTecnica": { "tituloH3": "string", "html": "<p>...</p>" },
    "quemDeveContratar": { "tituloH3": "string", "html": "<p>...</p>" }
  },
  "secaoPorQueContratar": {
    "tituloH2": "Por que contratar [serviço] em [localidade]?",
    "contextoLocal": { "tituloH3": "string", "html": "<p>...</p>" },
    "riscosDeNaoContratar": { "tituloH3": "string", "html": "<p>...</p>" }
  },
  "secaoOQueEntregamos": {
    "tituloH2": "O que avaliamos e entregamos no serviço",
    "itens": [ { "tituloH3": "string", "html": "<p>...</p>" } ]
  },
  "secaoComoFunciona": {
    "tituloH2": "Como funciona o serviço da ${CONFIG.empresaNome} em [localidade]",
    "itens": [ { "tituloH3": "string", "html": "<p>...</p>" } ]
  },
  "faq": [ { "pergunta": "string", "resposta": "string" } ]
}

Regras obrigatórias:
- NUNCA use <h1>, <h2>, <h3> dentro dos campos "html"
- "secaoOQueEntregamos.itens": 4 a 6 itens com normas técnicas reais (NBR 5410, NR-10, NBR 5419, NBR 5462, exigências ANEEL/concessionária, Corpo de Bombeiros conforme o serviço)
- "secaoComoFunciona.itens": exatamente 3 itens: 1) agendamento, 2) execução técnica, 3) entrega do laudo/ART
- "faq": exatamente 5 perguntas específicas sobre o serviço na localidade, respostas de 2–4 frases cada
- "contextoLocal": mencione características reais da localidade (perfil residencial/industrial/comercial, bairros ou municípios vizinhos se fornecidos), SEM inventar estatísticas ou percentuais
- NUNCA mencione preço, valor ou custo — a consulta é feita diretamente com a empresa
- Mínimo 900 palavras de conteúdo textual
- Use <ul>/<li> quando listar itens`;
}

function montarPromptUsuario({ servico, localidade }) {
  const contextoLocal =
    localidade.tipo === "bairro"
      ? `o bairro de ${localidade.nome}, na cidade de São Paulo (capital)`
      : `o município de ${localidade.nome}, no estado de São Paulo`;

  const vizinhosTexto =
    localidade.vizinhos && localidade.vizinhos.length > 0
      ? `Localidades vizinhas (pode citar naturalmente): ${localidade.vizinhos.join(", ")}.`
      : "";

  const perfilLocal =
    localidade.tipo === "bairro"
      ? "Bairro urbano de São Paulo com mix residencial, comercial e industrial."
      : `Município do interior paulista com perfil predominantemente ${localidade.nome.includes("Campinas") || localidade.nome.includes("Sorocaba") || localidade.nome.includes("São José") ? "urbano e industrial" : "residencial e agroindustrial"}.`;

  return `Escreva o conteúdo para uma página sobre o serviço "${servico.nome}" (${servico.descricaoCurta}), com foco em atendimento em ${contextoLocal}.

Empresa: ${CONFIG.empresaNome}.
Responsável técnico: ${CONFIG.responsavelNome}, ${CONFIG.responsavelCredencial}.
Perfil da localidade: ${perfilLocal}
${vizinhosTexto}

Mencione ${localidade.nome} pelo menos 6 vezes no texto. Mencione ${CONFIG.empresaNome} pelo menos 3 vezes.
Siga rigorosamente o formato JSON e as regras definidas no sistema.`;
}

// ---------------------------------------------------------------------------
// 9. CHAMADA À API DA OPENAI
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

function parsearJsonDaIA(textoBruto) {
  const limpo = textoBruto.replace(/^```(?:json|html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(limpo); }
  catch (erro) {
    throw new Error(`Falha ao parsear JSON da IA: ${limpo.slice(0, 500)}`);
  }
}

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
// 10. BREADCRUMB
// ---------------------------------------------------------------------------
function montarBreadcrumbHtml({ servico, localidade, tituloPagina }) {
  return `<nav class="instel-breadcrumb" aria-label="breadcrumb" style="font-size:14px;color:#666;margin-bottom:16px;">
  <a href="${escapeHtml(CONFIG.empresaUrl)}">Home</a> &raquo;
  <a href="${escapeHtml(CONFIG.empresaUrl)}/servicos/">Serviços</a> &raquo;
  <span>${escapeHtml(tituloPagina)}</span>
</nav>`;
}

// ---------------------------------------------------------------------------
// 11. BLOCOS FIXOS (CTA, orçamento, box autor)
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
      : `<strong>Pronto para solicitar ${escapeHtml(servico.nome)} em ${escapeHtml(localidade.nome)}?</strong> Entre em contato sem compromisso.`;

  return `<div class="instel-cta-wp" style="background:#f0f7ff;border-left:4px solid #0066cc;padding:16px 20px;margin:24px 0;border-radius:4px;">
<p style="margin:0 0 10px;">${pergunta}</p>
<a href="${montarLinkWhatsapp(mensagem)}" target="_blank" rel="noopener" style="display:inline-block;background:#25d366;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">${textoBotao}</a>
</div>`;
}

function montarBlocoOrcamento() {
  return `<p><strong>Investimento:</strong> os valores variam conforme o escopo e as características da instalação — <a href="${escapeHtml(CONFIG.empresaUrl)}/contato">solicite um orçamento personalizado</a> (a consultar).</p>`;
}

function montarBoxAutor() {
  return `<div class="instel-box-autor" style="margin-top:40px;padding:20px;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa;">
  <p style="margin:0 0 4px;font-weight:bold;"><a href="${escapeHtml(CONFIG.responsavelUrlPerfil)}">${escapeHtml(CONFIG.responsavelNome)}</a></p>
  <p style="margin:0 0 6px;color:#555;">${escapeHtml(CONFIG.responsavelCredencial)}</p>
  <p style="margin:0;color:#555;">${escapeHtml(CONFIG.responsavelBio)}</p>
</div>`;
}

// ---------------------------------------------------------------------------
// 12. SCHEMAS JSON-LD (FAQPage + Service + LocalBusiness + Person + Breadcrumb)
// ---------------------------------------------------------------------------
function montarSchemas({ servico, localidade, faq, tituloPagina }) {
  const areaServida =
    localidade.tipo === "bairro" ? `${localidade.nome}, São Paulo, SP` : `${localidade.nome}, SP`;

  const schemas = [
    // BreadcrumbList
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: CONFIG.empresaUrl },
        { "@type": "ListItem", position: 2, name: "Serviços", item: `${CONFIG.empresaUrl}/servicos/` },
        { "@type": "ListItem", position: 3, name: tituloPagina },
      ],
    },
    // FAQPage
    faq && faq.length > 0 && {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.pergunta,
        acceptedAnswer: { "@type": "Answer", text: item.resposta },
      })),
    },
    // Service
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: servico.nome,
      provider: {
        "@type": "LocalBusiness",
        name: CONFIG.empresaNome,
        url: CONFIG.empresaUrl,
        telephone: CONFIG.whatsapp,
      },
      areaServed: { "@type": "Place", name: areaServida },
      description: servico.descricaoCurta,
    },
    // LocalBusiness
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: CONFIG.empresaNome,
      url: CONFIG.empresaUrl,
      telephone: CONFIG.whatsapp,
      email: CONFIG.email,
      address: {
        "@type": "PostalAddress",
        addressLocality: "São Paulo",
        addressRegion: "SP",
        addressCountry: "BR",
      },
      areaServed: { "@type": "Place", name: areaServida },
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Serviços de Engenharia Elétrica",
        itemListElement: [{
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: `${servico.nome} em ${localidade.nome}` },
        }],
      },
    },
    // Person
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: CONFIG.responsavelNome,
      jobTitle: "Engenheiro Eletricista",
      hasCredential: "CREA-SP 5071122659",
      url: CONFIG.responsavelUrlPerfil,
      worksFor: { "@type": "Organization", name: CONFIG.empresaNome },
      description: CONFIG.responsavelBio,
    },
  ].filter(Boolean);

  return schemas
    .map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// 13. TAGS E POSTS RELACIONADOS (WordPress)
// ---------------------------------------------------------------------------
function authHeaderWp() {
  const auth = Buffer.from(`${CONFIG.wpUser}:${CONFIG.wpAppPassword}`).toString("base64");
  return { Authorization: `Basic ${auth}` };
}

async function buscarOuCriarTag(nome) {
  const buscaUrl = `${CONFIG.wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(nome)}&per_page=10`;
  const respostaBusca = await fetch(buscaUrl, { headers: authHeaderWp() });
  if (!respostaBusca.ok) throw new Error(`Erro ao buscar tag "${nome}" (${respostaBusca.status})`);
  const encontradas = await respostaBusca.json();
  const exata = encontradas.find((t) => t.name.toLowerCase() === nome.toLowerCase());
  if (exata) return exata.id;

  const respostaCriacao = await fetch(`${CONFIG.wpUrl}/wp-json/wp/v2/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaderWp() },
    body: JSON.stringify({ name: nome, slug: slugify(nome) }),
  });
  if (!respostaCriacao.ok) {
    const seg = await fetch(buscaUrl, { headers: authHeaderWp() });
    const lista = seg.ok ? await seg.json() : [];
    const achou = lista.find((t) => t.name.toLowerCase() === nome.toLowerCase());
    if (achou) return achou.id;
    throw new Error(`Erro ao criar tag "${nome}" (${respostaCriacao.status})`);
  }
  return (await respostaCriacao.json()).id;
}

async function buscarPostsRelacionados({ tagServicoId, tagLocalidadeAtualId }) {
  const url = `${CONFIG.wpUrl}/wp-json/wp/v2/posts?tags=${tagServicoId}&per_page=10&_fields=id,title,link,tags`;
  const resposta = await fetch(url, { headers: authHeaderWp() });
  if (!resposta.ok) return [];
  const posts = await resposta.json();
  const relacionados = posts.filter((p) => !p.tags?.includes(tagLocalidadeAtualId));
  if (relacionados.length < CONFIG.minRelacionadosParaExibir) return [];
  return relacionados.slice(0, 6).map((p) => ({ titulo: p.title.rendered, link: p.link }));
}

function montarSecaoRelacionados(relacionados, { servico, localidade }) {
  if (!relacionados || relacionados.length === 0) return "";
  const itens = relacionados
    .map((r) => `<li><a href="${escapeHtml(r.link)}">${r.titulo}</a></li>`)
    .join("\n");
  return `<h2>Serviços relacionados em ${escapeHtml(localidade.nome)} e região</h2>
<ul>${itens}</ul>`;
}

// ---------------------------------------------------------------------------
// 14. MONTAGEM DO HTML FINAL
// ---------------------------------------------------------------------------
function montarSecaoComItens(secao) {
  if (!secao) return "";
  const itensHtml = (secao.itens || [])
    .map((item) => `<h3>${escapeHtml(item.tituloH3)}</h3>\n${removerHeadingsIndevidos(item.html)}`)
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
    .map((item) => `<h3>${escapeHtml(item.pergunta)}</h3>\n<p>${escapeHtml(item.resposta)}</p>`)
    .join("\n");
  return `<h2>Perguntas frequentes sobre ${escapeHtml(servico.nome)} em ${escapeHtml(localidade.nome)}</h2>\n${itens}`;
}

export function montarHtmlFinal({ conteudo, servico, localidade, listaImagens, relacionados, tituloPagina }) {
  const blocos = [
    montarSchemas({ servico, localidade, faq: conteudo.faq, tituloPagina }),
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
  ];
  return blocos.filter((b) => b && b.trim().length > 0).join("\n\n");
}

// ---------------------------------------------------------------------------
// 15. PUBLICAÇÃO NO WORDPRESS
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
// 16. ORQUESTRAÇÃO PRINCIPAL
// ---------------------------------------------------------------------------
async function main() {
  console.log(`🚀 Instel Service SEO Pipeline v2 — ${new Date().toISOString()}`);

  // Bootstrap de imagens (faz upload para WP se arquivos existirem em ./imagens/)
  const imagensWP = await bootstrapImagens();

  const dados = await carregarDados();
  const combinacoes = gerarCombinacoesDoDia(dados);
  console.log(`📋 ${dados.servicos.length} serviços × ${dados.localidades.length} localidades = ${dados.servicos.length * dados.localidades.length} combinações possíveis`);

  const resultados = [];

  for (const combinacao of combinacoes) {
    const { servico, localidade, indiceGlobal, postIndex } = combinacao;
    const rotulo = `[${indiceGlobal}] ${servico.nome} × ${localidade.nome}`;

    try {
      console.log(`\n📝 Gerando: ${rotulo}`);

      console.log("  → Conteúdo via IA...");
      const conteudo = await gerarConteudoComIA({ servico, localidade });
      const tituloPagina = conteudo.titulo;

      console.log("  → Tags no WordPress...");
      const tagServicoId = await buscarOuCriarTag(servico.nome);
      const tagLocalidadeId = await buscarOuCriarTag(localidade.nome);

      const relacionados = await buscarPostsRelacionados({
        tagServicoId,
        tagLocalidadeAtualId: tagLocalidadeId,
      });

      const listaImagens = selecionarImagens(imagensWP, postIndex);

      const htmlFinal = montarHtmlFinal({
        conteudo,
        servico,
        localidade,
        listaImagens,
        relacionados,
        tituloPagina,
      });

      console.log("  → Publicando...");
      const post = await publicarNoWordpress({
        titulo: tituloPagina,
        metaDescricao: conteudo.metaDescricao,
        htmlFinal,
        tagIds: [tagServicoId, tagLocalidadeId],
      });

      console.log(`  ✅ ID ${post.id} — ${post.link || ""}`);
      resultados.push({ rotulo, sucesso: true, postId: post.id, link: post.link });
    } catch (erro) {
      console.error(`  ❌ FALHOU — ${rotulo}: ${erro.message}`);
      resultados.push({ rotulo, sucesso: false, erro: erro.message });
    }
  }

  const falhas = resultados.filter((r) => !r.sucesso);
  console.log(`\n✅ Resumo: ${resultados.length - falhas.length} ok, ${falhas.length} falha(s).`);
  if (falhas.length > 0) {
    console.error("Falhas:", JSON.stringify(falhas, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((erro) => {
    console.error("Erro fatal:", erro);
    process.exit(1);
  });
}
