/* Cartazeiro Celular
 * Anota os preços que mudaram (lista do dia) e manda para o Cartazeiro do PC
 * pelo QR Code. Tudo fica salvo no próprio celular.
 * Os campos de cada etiqueta são os mesmos do programa de PC.
 */
"use strict";

// ------------------------------------------------------------------ dados
const FORMATOS = [
  ["A6 Vertical (6 por A4)", "A6 (6 por folha)"],
  ["A5 Vertical (2 por A4)", "A5 (2 por folha)"],
  ["A4 / A3 Vertical (1 por folha)", "A4 em pé"],
  ["A4 / A3 Horizontal (1 por folha)", "A4 deitado"],
];
const APELIDO = {
  "A6 Vertical (6 por A4)": "A6", "A5 Vertical (2 por A4)": "A5",
  "A4 / A3 Vertical (1 por folha)": "A4 ↕", "A4 / A3 Horizontal (1 por folha)": "A4 ↔",
};
const FORMATOS_FARDO = ["A4 / A3 Vertical (1 por folha)", "A4 / A3 Horizontal (1 por folha)"];
const FORMATOS_SEM_EXTRAS = ["A6 Vertical (6 por A4)"];
const CABECALHOS = ["LEVE 2 PAGUE 1", "LEVE 3 PAGUE 2", "OFERTA", "SÓ HOJE", "IMPERDÍVEL",
  "PREÇO BAIXO", "QUEIMA DE ESTOQUE", "LANÇAMENTO"];

function ler(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v ? JSON.parse(v) : padrao;
  } catch (e) { return padrao; }
}
function gravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); return true; }
  catch (e) { aviso("Não consegui salvar no celular: " + e.message); return false; }
}

let lista = ler("cz_lista", []);
let produtos = ler("cz_produtos", []);
let config = Object.assign({ formato: FORMATOS[0][0], estilo: "tarja" }, ler("cz_config", {}));
let editandoId = null;
let tipo = { depor: true, rebaixa: false, fardo: false };

const salvarLista = () => gravar("cz_lista", lista);
const salvarProdutos = () => gravar("cz_produtos", produtos);
const salvarConfig = () => gravar("cz_config", config);

// pede ao Chrome para não apagar os dados quando faltar espaço
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

// ------------------------------------------------------------------ utilidades
const $ = (id) => document.getElementById(id);
const soDigitos = (t) => String(t || "").replace(/\D/g, "");
const novoId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : String(Math.random()).slice(2)).slice(0, 8);
const agora = () => {
  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
const maiusculo = (t) => String(t || "").replace(/\s+/g, " ").trim().toUpperCase();
const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Mesmo jeito do PC: o ÚLTIMO separador é o decimal ("1.548,00" -> "1548,00"). */
function normalizarPreco(bruto) {
  let t = String(bruto || "").replace(/\s|R\$/g, "");
  if (!/\d/.test(t)) return "";
  const corte = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  let inteiro = corte === -1 ? t : t.slice(0, corte);
  let cent = corte === -1 ? "00" : t.slice(corte + 1);
  inteiro = inteiro.replace(/\D/g, "").replace(/^0+/, "") || "0";
  cent = (cent.replace(/\D/g, "").slice(0, 2) + "00").slice(0, 2);
  return `${inteiro},${cent}`;
}
const precoNum = (t) => parseFloat(normalizarPreco(t).replace(",", ".")) || 0;
const numPreco = (n) => n.toFixed(2).replace(".", ",");

function eanValido(ean) {
  ean = soDigitos(ean);
  if (ean.length !== 13 && ean.length !== 8) return false;
  const corpo = ean.slice(0, -1).split("").map(Number);
  const pesos = ean.length === 13 ? (i) => (i % 2 ? 3 : 1) : (i) => (i % 2 ? 1 : 3);
  const soma = corpo.reduce((s, d, i) => s + d * pesos(i), 0);
  return (10 - (soma % 10)) % 10 === Number(ean.slice(-1));
}

/** Código interno impresso como EAN-13 cheio de zeros (0000000001724) vira 1724. */
function limparCodigoLido(codigo) {
  const d = soDigitos(codigo);
  if (d.length === 13 && d.startsWith("00000")) return d.replace(/^0+/, "");
  return d;
}

let timerToast;
function aviso(texto, ms = 2600) {
  const t = $("toast");
  t.textContent = texto;
  t.classList.remove("oculto");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => t.classList.add("oculto"), ms);
}

// ------------------------------------------------------------------ cadastro de produtos
function porEan(ean) { ean = soDigitos(ean); return ean ? produtos.find((p) => p.ean === ean) : null; }
function porPlu(plu) {
  plu = soDigitos(plu).replace(/^0+/, "");
  return plu ? produtos.find((p) => soDigitos(p.plu).replace(/^0+/, "") === plu) : null;
}
function porDesc(desc) { desc = maiusculo(desc); return produtos.find((p) => p.desc === desc); }

function registrarProduto(ean, plu, desc) {
  ean = soDigitos(ean); plu = soDigitos(plu); desc = maiusculo(desc);
  if (!(ean || plu) || !desc) return;
  let p = (ean && porEan(ean)) || (plu && porPlu(plu));
  if (!p) { p = { id: novoId() }; produtos.push(p); }
  if (ean) p.ean = ean;
  if (plu) p.plu = plu;
  p.desc = desc;
  p.atualizado = agora();
  salvarProdutos();
}

/** Junta o cadastro que veio do PC com o do celular (fica o mais recente). */
function mesclarProdutos(vindos) {
  let novos = 0;
  for (const v of vindos || []) {
    if (!v || !v.desc || !(v.ean || v.plu)) continue;
    const meu = (v.ean && porEan(v.ean)) || (v.plu && porPlu(v.plu));
    if (!meu) {
      produtos.push({ id: v.id || novoId(), ean: soDigitos(v.ean), plu: soDigitos(v.plu), desc: v.desc,
        un: v.un || "", atualizado: v.atualizado || "" });
      novos++;
    } else if ((v.atualizado || "") > (meu.atualizado || "")) {
      Object.assign(meu, { desc: v.desc, atualizado: v.atualizado });
      if (v.ean) meu.ean = soDigitos(v.ean);
      if (v.plu) meu.plu = soDigitos(v.plu);
    }
  }
  salvarProdutos();
  return novos;
}

// ------------------------------------------------------------------ telas
const TELAS = ["tela-lista", "tela-form", "tela-produtos", "tela-enviar"];
function mostrar(tela, empilhar = true) {
  TELAS.forEach((t) => $(t).classList.toggle("oculto", t !== tela));
  window.scrollTo(0, 0);
  if (empilhar && tela !== "tela-lista") history.pushState({ tela }, "");
}
// O botão "voltar" do Android volta para a lista em vez de fechar o app
window.addEventListener("popstate", () => { fecharCamera(); mostrar("tela-lista", false); desenharLista(); });
document.querySelectorAll("[data-voltar]").forEach((b) => b.addEventListener("click", () => history.back()));

// ------------------------------------------------------------------ lista
function desenharLista() {
  const caixa = $("lista");
  caixa.innerHTML = "";
  $("vazio").classList.toggle("oculto", lista.length > 0);
  $("limpar").classList.toggle("oculto", lista.length === 0);
  const copias = lista.reduce((s, i) => s + (parseInt(i.quantidade) || 1), 0);
  $("resumo").textContent = lista.length
    ? `${lista.length} etiqueta${lista.length > 1 ? "s" : ""} · ${copias} cópia${copias > 1 ? "s" : ""}` : "";

  for (const it of lista) {
    const c = document.createElement("div");
    c.className = "cartao";
    const etiquetas = [`<span class="etq">${escapar(APELIDO[it.formato] || "A6")}</span>`];
    if (it.cabecalho) etiquetas.push(`<span class="etq preta">${escapar(it.cabecalho)}</span>`);
    if (it.promo_validade && it.promo_ate) etiquetas.push(`<span class="etq">Promo até ${escapar(it.promo_ate.slice(0, 5))}</span>`);
    if (it.e_rebaixa) etiquetas.push(`<span class="etq">Validade ${escapar(it.val)}</span>`);
    if (it.e_fardo) etiquetas.push(`<span class="etq">Caixa ${escapar(it.qtd_fardo)} ${escapar(it.un)}</span>`);
    if ((parseInt(it.quantidade) || 1) > 1) etiquetas.push(`<span class="etq">${it.quantidade} cópias</span>`);
    const codigos = [it.ean, it.plu ? "PLU " + it.plu : ""].filter(Boolean).join(" · ");
    let preco;
    if (it.e_fardo) preco = `R$ ${escapar(it.preco_unit)}<small>caixa R$ ${escapar(it.por)}</small>`;
    else if (it.de) preco = `<s>${escapar(it.de)}</s>R$ ${escapar(it.por)}`;
    else preco = `R$ ${escapar(it.por)}`;
    c.innerHTML = `
      <div class="cab">${etiquetas.join("")}</div>
      <div>
        <div class="nome">${escapar(it.desc_cartaz || it.desc)}</div>
        ${it.complemento ? `<div class="comp">${escapar(it.complemento)}</div>` : ""}
        <div class="cod">${escapar(codigos || "sem código")}</div>
      </div>
      <div class="preco">${preco}</div>
      <div class="acoes">
        <button class="acao" data-editar="${it.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Editar</button>
        <button class="acao" data-apagar="${it.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Apagar</button>
      </div>`;
    caixa.appendChild(c);
  }
}

$("lista").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-editar]");
  const ap = e.target.closest("[data-apagar]");
  if (ed) abrirForm(ed.dataset.editar);
  if (ap) {
    const it = lista.find((i) => i.id === ap.dataset.apagar);
    if (it && confirm(`Apagar "${it.desc}" da lista?`)) {
      lista = lista.filter((i) => i !== it);
      salvarLista(); desenharLista();
    }
  }
});
$("limpar").addEventListener("click", () => {
  if (confirm(`Apagar as ${lista.length} etiquetas da lista?\n(Os produtos continuam cadastrados.)`)) {
    lista = []; salvarLista(); desenharLista();
  }
});
$("novo").addEventListener("click", () => abrirForm(null));
$("ir-produtos").addEventListener("click", () => { desenharProdutos(); mostrar("tela-produtos"); });
$("ir-enviar").addEventListener("click", () => { prepararEnvio(); mostrar("tela-enviar"); });

// ------------------------------------------------------------------ formulário
const selFormato = $("f-formato");
FORMATOS.forEach(([v, t]) => selFormato.add(new Option(t, v)));
CABECALHOS.forEach((c) => $("lista-cab").appendChild(new Option(c)));

for (const id of ["f-desc", "f-cab", "f-comp", "f-un", "f-un-fardo"]) {
  $(id).addEventListener("input", (e) => {
    const el = e.target, pos = el.selectionStart, up = el.value.toUpperCase();
    if (up !== el.value) { el.value = up; try { el.setSelectionRange(pos, pos); } catch (x) {} }
  });
}

const paraInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inputParaBr = (v) => { if (!v) return ""; const [a, m, d] = v.split("-"); return `${d}/${m}/${a}`; };
const brParaInput = (v) => { if (!v) return ""; const [d, m, a] = v.split("/"); return `${a}-${m}-${d}`; };

function preencherDatalist() {
  const dl = $("lista-desc");
  dl.innerHTML = "";
  [...new Set(produtos.map((p) => p.desc).filter(Boolean))].sort().forEach((d) => dl.appendChild(new Option(d)));
}

function marcarChip(nome, valor) {
  tipo[nome] = valor;
  $("t-" + nome).setAttribute("aria-pressed", valor ? "true" : "false");
}

function atualizarForm() {
  const formato = selFormato.value;
  const aceitaFardo = FORMATOS_FARDO.includes(formato);
  if (!aceitaFardo && tipo.fardo) marcarChip("fardo", false);
  $("t-fardo").disabled = !aceitaFardo;
  const fardo = tipo.fardo;
  $("t-depor").disabled = fardo;
  $("t-rebaixa").disabled = fardo;
  const depor = tipo.depor && !fardo;
  const rebaixa = tipo.rebaixa && !fardo;

  $("bloco-precos").classList.toggle("oculto", fardo);
  $("bloco-fardo").classList.toggle("oculto", !fardo);
  $("bloco-validade").classList.toggle("oculto", !rebaixa);
  $("campo-de").classList.toggle("oculto", !depor);
  $("rot-por").textContent = depor ? "Preço POR" : "Preço";

  const semExtras = FORMATOS_SEM_EXTRAS.includes(formato);
  $("f-tem-cab").disabled = semExtras;
  $("f-tem-comp").disabled = semExtras;
  $("aviso-a6").classList.toggle("oculto", !semExtras);
  $("f-cab").disabled = semExtras || !$("f-tem-cab").checked;
  $("f-estilo").disabled = $("f-cab").disabled;
  $("f-comp").disabled = semExtras || !$("f-tem-comp").checked;

  // validade da promoção: não combina com rebaixa (que já tem a validade do produto)
  const podePromo = !rebaixa;
  $("f-tem-promo").disabled = !podePromo;
  $("aviso-promo").classList.toggle("oculto", podePromo);
  const ligaPromo = podePromo && $("f-tem-promo").checked;
  ["f-promo-de", "f-promo-ate", "f-estoque"].forEach((id) => ($(id).disabled = !ligaPromo));
  if (ligaPromo && !$("f-promo-de").value) {
    const hoje = new Date(), daqui2 = new Date(Date.now() + 2 * 864e5);
    $("f-promo-de").value = paraInput(hoje); $("f-promo-ate").value = paraInput(daqui2);
  }

  $("f-total").classList.toggle("oculto", !$("f-total-manual").checked);
  $("total-fardo").classList.toggle("oculto", $("f-total-manual").checked);
  const unit = precoNum($("f-unit").value), qtd = parseInt($("f-qtd-fardo").value) || 1;
  $("total-fardo").textContent = unit > 0
    ? `Preço da caixa: R$ ${numPreco(unit * qtd)} (${qtd} × ${numPreco(unit)})` : "O preço da caixa é calculado sozinho.";
}

["depor", "rebaixa", "fardo"].forEach((n) =>
  $("t-" + n).addEventListener("click", () => { marcarChip(n, !tipo[n]); atualizarForm(); }));
selFormato.addEventListener("change", () => { config.formato = selFormato.value; salvarConfig(); atualizarForm(); });
["f-tem-promo"].forEach((id) => $(id).addEventListener("change", atualizarForm));
["f-tem-cab", "f-tem-comp", "f-total-manual"].forEach((id) => $(id).addEventListener("change", (e) => {
  atualizarForm();
  if (e.target.checked && id === "f-tem-cab") $("f-cab").focus();
  if (e.target.checked && id === "f-tem-comp") $("f-comp").focus();
}));
["f-unit", "f-qtd-fardo"].forEach((id) => $(id).addEventListener("input", atualizarForm));
$("f-estilo").addEventListener("change", () => { config.estilo = $("f-estilo").value; salvarConfig(); });

// --- palavras da descrição: tocou, a palavra sai do cartaz (sabor, tamanho...) ---
// O cadastro continua com o nome completo; só o cartaz sai com o nome curto.
let palavrasFora = new Set();
const palavrasDe = (t) => { const m = maiusculo(t); return m ? m.split(" ") : []; };

function textoCartaz() {
  const palavras = palavrasDe($("f-desc").value);
  if (palavras.length < 2 || !palavras.some((p) => palavrasFora.has(p))) return "";
  return palavras.filter((p) => !palavrasFora.has(p)).join(" ");
}

function desenharPalavras() {
  const palavras = palavrasDe($("f-desc").value);
  palavrasFora = new Set([...palavrasFora].filter((p) => palavras.includes(p)));
  $("bloco-palavras").classList.toggle("oculto", palavras.length < 2);
  $("palavras").innerHTML = palavras.map((p) =>
    `<button type="button" class="palavra" data-palavra="${escapar(p)}" aria-pressed="${palavrasFora.has(p)}">${escapar(p)}</button>`).join("");
  const cartaz = textoCartaz();
  $("previa-palavras").innerHTML = cartaz ? `Vai sair no cartaz: <b>${escapar(cartaz)}</b>` : "";
  $("previa-palavras").classList.toggle("oculto", !cartaz);
}

$("palavras").addEventListener("click", (e) => {
  const b = e.target.closest(".palavra");
  if (!b) return;
  const p = b.dataset.palavra;
  if (palavrasFora.has(p)) palavrasFora.delete(p); else palavrasFora.add(p);
  desenharPalavras();
});
$("f-desc").addEventListener("input", desenharPalavras);

function limparForm() {
  for (const id of ["f-ean", "f-plu", "f-desc", "f-cab", "f-comp", "f-de", "f-por", "f-unit", "f-total", "f-val"]) $(id).value = "";
  $("f-un").value = "1 UN"; $("f-un-fardo").value = "UN"; $("f-qtd-fardo").value = "12"; $("f-qtd").value = "1";
  $("f-tem-cab").checked = false; $("f-tem-comp").checked = false; $("f-total-manual").checked = false;
  $("f-estilo").value = config.estilo || "tarja";
  document.querySelectorAll(".entrada.erro").forEach((el) => el.classList.remove("erro"));
  $("aviso-codigo").textContent = ""; $("aviso-codigo").className = "dica";
  $("msg-form").textContent = "";
  palavrasFora = new Set();
  desenharPalavras();
}

function abrirForm(id) {
  limparForm();
  preencherDatalist();
  editandoId = id;
  const it = id ? lista.find((i) => i.id === id) : null;
  if (it) {
    selFormato.value = it.formato || config.formato;
    $("f-ean").value = it.ean || ""; $("f-plu").value = it.plu || ""; $("f-desc").value = it.desc || "";
    if (it.desc_cartaz) {
      const ficam = palavrasDe(it.desc_cartaz);
      palavrasFora = new Set(palavrasDe(it.desc).filter((p) => !ficam.includes(p)));
    }
    desenharPalavras();
    $("f-tem-cab").checked = !!it.cabecalho; $("f-cab").value = it.cabecalho || "";
    $("f-estilo").value = it.estilo_cabecalho || "tarja";
    $("f-tem-comp").checked = !!it.complemento; $("f-comp").value = it.complemento || "";
    marcarChip("fardo", !!it.e_fardo);
    marcarChip("depor", !!it.de);
    marcarChip("rebaixa", !!it.e_rebaixa);
    if (it.e_fardo) {
      $("f-qtd-fardo").value = it.qtd_fardo || 12; $("f-un-fardo").value = it.un || "UN"; $("f-unit").value = it.preco_unit || "";
      const calc = numPreco(precoNum(it.preco_unit) * (parseInt(it.qtd_fardo) || 1));
      if (calc !== it.por) { $("f-total-manual").checked = true; $("f-total").value = it.por; }
    } else {
      $("f-de").value = it.de || ""; $("f-por").value = it.por || ""; $("f-un").value = it.un || "";
      if (it.val) { const [d, m, a] = it.val.split("/"); $("f-val").value = `${a}-${m}-${d}`; }
    }
    $("f-qtd").value = it.quantidade || 1;
    $("f-tem-promo").checked = !!it.promo_validade;
    $("f-promo-de").value = brParaInput(it.promo_de); $("f-promo-ate").value = brParaInput(it.promo_ate);
    $("f-estoque").checked = it.promo_estoque !== false;
    $("titulo-form").textContent = "Editar etiqueta";
    $("salvar").textContent = "Salvar alterações";
  } else {
    selFormato.value = config.formato;
    $("titulo-form").textContent = "Nova etiqueta";
    $("salvar").textContent = "Adicionar à lista";
  }
  atualizarForm();
  mostrar("tela-form");
}

function buscarCodigo(qual) {
  const aviso = $("aviso-codigo");
  const valor = soDigitos($(qual === "ean" ? "f-ean" : "f-plu").value);
  if (!valor) return null;
  const p = qual === "ean" ? porEan(valor) : porPlu(valor);
  if (p) {
    if (p.ean && !$("f-ean").value) $("f-ean").value = p.ean;
    if (p.plu && !$("f-plu").value) $("f-plu").value = p.plu;
    $("f-desc").value = p.desc;
    desenharPalavras();
    aviso.textContent = "✓ Produto do cadastro: " + p.desc;
    aviso.className = "dica ok";
  } else if (qual === "ean" && (valor.length === 13 || valor.length === 8) && !eanValido(valor)) {
    aviso.textContent = "⚠ Esse EAN parece ter um número errado. Confira.";
    aviso.className = "dica alerta";
  } else {
    aviso.textContent = qual === "ean" ? "Produto novo: digite a descrição." : "";
    aviso.className = "dica";
  }
  return p;
}
$("f-ean").addEventListener("change", () => buscarCodigo("ean"));
$("f-plu").addEventListener("change", () => buscarCodigo("plu"));
$("f-desc").addEventListener("change", () => {
  const p = porDesc($("f-desc").value);
  if (p) { if (p.ean && !$("f-ean").value) $("f-ean").value = p.ean; if (p.plu && !$("f-plu").value) $("f-plu").value = p.plu; }
});

function focarPreco() {
  const alvo = tipo.fardo ? "f-unit" : (tipo.depor ? "f-de" : "f-por");
  setTimeout(() => $(alvo).focus(), 50);
}

$("ler-ean").addEventListener("click", () => {
  abrirCamera("barras", (codigo) => {
    $("f-ean").value = limparCodigoLido(codigo);
    const p = buscarCodigo("ean");
    if (p) focarPreco(); else setTimeout(() => $("f-desc").focus(), 50);
  });
});

function erro(id, texto) {
  if (id) { $(id).classList.add("erro"); $(id).focus(); }
  $("msg-form").textContent = "⚠ " + texto;
  return null;
}

function lerForm() {
  document.querySelectorAll(".entrada.erro").forEach((el) => el.classList.remove("erro"));
  const desc = maiusculo($("f-desc").value);
  if (!desc) return erro("f-desc", "Preencha a descrição do produto.");
  if (palavrasDe(desc).every((p) => palavrasFora.has(p))) return erro("f-desc", "Deixe pelo menos uma palavra no cartaz.");
  const formato = selFormato.value;
  const semExtras = FORMATOS_SEM_EXTRAS.includes(formato);
  const item = {
    desc, desc_cartaz: textoCartaz(), ean: soDigitos($("f-ean").value), plu: soDigitos($("f-plu").value), formato,
    cabecalho: !semExtras && $("f-tem-cab").checked ? maiusculo($("f-cab").value) : "",
    complemento: !semExtras && $("f-tem-comp").checked ? maiusculo($("f-comp").value) : "",
    estilo_cabecalho: $("f-estilo").value || "tarja",
    quantidade: Math.max(1, parseInt($("f-qtd").value) || 1), sel: true,
  };
  const ligaPromo = !$("f-tem-promo").disabled && $("f-tem-promo").checked;
  Object.assign(item, {
    promo_validade: ligaPromo,
    promo_de: ligaPromo ? inputParaBr($("f-promo-de").value) : "",
    promo_ate: ligaPromo ? inputParaBr($("f-promo-ate").value) : "",
    promo_estoque: $("f-estoque").checked,
  });
  if (tipo.fardo && FORMATOS_FARDO.includes(formato)) {
    const unit = normalizarPreco($("f-unit").value);
    if (!unit || precoNum(unit) <= 0) return erro("f-unit", "Informe o preço da unidade (ex.: 3,49).");
    const qtd = Math.max(1, parseInt($("f-qtd-fardo").value) || 1);
    let total;
    if ($("f-total-manual").checked) {
      total = normalizarPreco($("f-total").value);
      if (!total || precoNum(total) <= 0) return erro("f-total", "Informe o preço da caixa.");
    } else total = numPreco(precoNum(unit) * qtd);
    return Object.assign(item, { de: "", por: total, preco_unit: unit, un: maiusculo($("f-un-fardo").value) || "UN",
      val: "", e_rebaixa: false, e_fardo: true, qtd_fardo: qtd });
  }
  const por = normalizarPreco($("f-por").value);
  if (!por || precoNum(por) <= 0) return erro("f-por", "Informe um preço válido (ex.: 4,98).");
  let de = "";
  if (tipo.depor) {
    de = normalizarPreco($("f-de").value);
    if (!de) return erro("f-de", "Informe o preço DE (ou desligue o De / Por).");
    if (precoNum(de) <= precoNum(por)) return erro("f-de", "O preço DE precisa ser maior que o POR.");
  }
  let val = "";
  if (tipo.rebaixa) {
    const v = $("f-val").value;
    if (!v) return erro("f-val", "Escolha a data de validade (ou desligue a Validade).");
    const [a, m, d] = v.split("-");
    val = `${d}/${m}/${a}`;
  }
  return Object.assign(item, { de, por, un: maiusculo($("f-un").value), val, e_rebaixa: tipo.rebaixa, e_fardo: false });
}

$("salvar").addEventListener("click", () => {
  const item = lerForm();
  if (!item) return;
  registrarProduto(item.ean, item.plu, item.desc);
  if (editandoId) {
    const i = lista.findIndex((x) => x.id === editandoId);
    item.id = editandoId;
    if (i >= 0) lista[i] = item; else lista.push(item);
    salvarLista();
    aviso("✓ Etiqueta atualizada");
    history.back();
  } else {
    item.id = novoId();
    lista.push(item);
    salvarLista();
    aviso(`✓ ${item.desc} adicionado`);
    // continua no formulário para o próximo produto, já pronto para bipar
    limparForm();
    preencherDatalist();
    atualizarForm();
    window.scrollTo(0, 0);
  }
});

// ------------------------------------------------------------------ produtos
function desenharProdutos() {
  const filtro = maiusculo($("busca").value);
  const caixa = $("produtos");
  const lista_p = produtos
    .filter((p) => !filtro || `${p.ean || ""} ${p.plu || ""} ${p.desc || ""}`.toUpperCase().includes(filtro))
    .sort((a, b) => (a.desc || "").localeCompare(b.desc || ""));
  caixa.innerHTML = lista_p.length ? "" : `<p class="vazio">${produtos.length ? "Nada encontrado." : "Nenhum produto cadastrado ainda."}</p>`;
  for (const p of lista_p) {
    const d = document.createElement("div");
    d.className = "produto";
    d.innerHTML = `<div class="txt"><div class="nome">${escapar(p.desc)}</div>
      <div class="cod">${escapar([p.ean, p.plu ? "PLU " + p.plu : ""].filter(Boolean).join(" · "))}</div></div>
      <button class="acao" data-renomear="${p.id}">Editar</button>
      <button class="acao" data-remover="${p.id}">Apagar</button>`;
    caixa.appendChild(d);
  }
}
$("busca").addEventListener("input", desenharProdutos);
$("produtos").addEventListener("click", (e) => {
  const r = e.target.closest("[data-renomear]"), x = e.target.closest("[data-remover]");
  if (r) {
    const p = produtos.find((q) => q.id === r.dataset.renomear);
    const novo = p && prompt("Descrição do produto:", p.desc);
    if (novo && maiusculo(novo)) { p.desc = maiusculo(novo); p.atualizado = agora(); salvarProdutos(); desenharProdutos(); }
  }
  if (x) {
    const p = produtos.find((q) => q.id === x.dataset.remover);
    if (p && confirm(`Apagar "${p.desc}" do cadastro?`)) {
      produtos = produtos.filter((q) => q !== p); salvarProdutos(); desenharProdutos();
    }
  }
});

// ------------------------------------------------------------------ envio para o PC
function prepararEnvio() {
  $("resultado-envio").innerHTML = "";
  $("info-envio").textContent = lista.length
    ? `Vão ${lista.length} etiqueta${lista.length > 1 ? "s" : ""} e ${produtos.length} produto${produtos.length !== 1 ? "s" : ""} do cadastro.`
    : "A lista está vazia, mas o cadastro de produtos ainda pode ser trocado com o PC.";
}

/** O QR do PC tem o formato: CARTAZEIRO1|https://endereco-da-ponte|codigo-da-sessao */
function lerQrDoPc(texto) {
  const partes = String(texto).trim().split("|");
  if (partes.length !== 3 || partes[0] !== "CARTAZEIRO1") return null;
  const [, ponte, sessao] = partes;
  if (!/^https?:\/\//.test(ponte) || !/^[A-Za-z0-9_-]{16,64}$/.test(sessao)) return null;
  return { ponte: ponte.replace(/\/+$/, ""), sessao };
}

async function enviar(destino) {
  const caixa = $("resultado-envio");
  caixa.innerHTML = `<div class="resultado">Enviando…</div>`;
  try {
    const r = await fetch(`${destino.ponte}/sessao/${destino.sessao}/celular`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itens: lista, produtos, enviado: agora(), versao: 1 }),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || `a ponte respondeu ${r.status}`);
    const novos = mesclarProdutos(dados.produtos_pc);
    const n = lista.length;
    caixa.innerHTML = `<div class="resultado ok">✓ Enviado! ${n} etiqueta${n !== 1 ? "s" : ""} já ${n !== 1 ? "devem estar" : "deve estar"} aparecendo no PC.
      ${novos ? `<br>${novos > 1 ? `Vieram ${novos} produtos novos` : "Veio 1 produto novo"} do cadastro do PC.` : ""}
      ${n ? `<button class="btn" id="limpar-depois">Limpar a lista do celular</button>` : ""}</div>`;
    const b = $("limpar-depois");
    if (b) b.addEventListener("click", () => { lista = []; salvarLista(); aviso("Lista limpa"); history.back(); });
  } catch (e) {
    const semRede = !navigator.onLine || /fetch|network|Failed/i.test(e.message);
    caixa.innerHTML = `<div class="resultado falha">✗ Não deu para enviar: ${escapar(semRede ? "sem internet no celular." : e.message)}
      <br>A lista continua salva aqui. Tente de novo.</div>`;
  }
}

$("ler-qr").addEventListener("click", () => {
  abrirCamera("qr", (texto) => {
    const destino = lerQrDoPc(texto);
    if (!destino) { aviso("Esse QR não é do Cartazeiro do PC."); return; }
    enviar(destino);
  });
});

// ------------------------------------------------------------------ câmera
let fluxo = null, rodando = false, aoLer = null;

async function abrirCamera(modo, callback) {
  if (!("BarcodeDetector" in window)) {
    aviso("Este navegador não lê códigos pela câmera. Use o Google Chrome atualizado.", 4500);
    return;
  }
  let formatos = modo === "qr" ? ["qr_code"] : ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"];
  try {
    const suportados = await BarcodeDetector.getSupportedFormats();
    formatos = formatos.filter((f) => suportados.includes(f));
  } catch (e) {}
  const detector = new BarcodeDetector({ formats: formatos });

  const cam = $("camera");
  cam.classList.toggle("qr", modo === "qr");
  $("camera-texto").textContent = modo === "qr" ? "Aponte para o QR Code na tela do PC" : "Aponte para o código de barras";
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
  } catch (e) {
    aviso("Não consegui abrir a câmera. Libere a permissão da câmera para este app.", 4500);
    return;
  }
  const video = $("video");
  video.srcObject = fluxo;
  await video.play().catch(() => {});
  cam.classList.remove("oculto");
  aoLer = callback;
  rodando = true;

  const trilha = fluxo.getVideoTracks()[0];
  const caps = trilha.getCapabilities ? trilha.getCapabilities() : {};
  $("lanterna").classList.toggle("oculto", !caps.torch);
  let ultima = "", repeticoes = 0;

  const procurar = async () => {
    if (!rodando) return;
    try {
      const achados = await detector.detect(video);
      if (achados.length) {
        const valor = achados[0].rawValue;
        // código de barras: só aceita depois de ler igual 2 vezes (evita leitura errada)
        repeticoes = valor === ultima ? repeticoes + 1 : 1;
        ultima = valor;
        if (modo === "qr" || repeticoes >= 2) {
          if (navigator.vibrate) navigator.vibrate(60);
          const cb = aoLer;
          fecharCamera();
          cb(valor);
          return;
        }
      }
    } catch (e) {}
    setTimeout(procurar, 120);
  };
  procurar();
}

function fecharCamera() {
  rodando = false;
  if (fluxo) fluxo.getTracks().forEach((t) => t.stop());
  fluxo = null;
  $("camera").classList.add("oculto");
}
$("fechar-camera").addEventListener("click", fecharCamera);
let lanternaLigada = false;
$("lanterna").addEventListener("click", async () => {
  if (!fluxo) return;
  lanternaLigada = !lanternaLigada;
  try { await fluxo.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: lanternaLigada }] }); } catch (e) {}
});

// ------------------------------------------------------------------ início
desenharLista();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
