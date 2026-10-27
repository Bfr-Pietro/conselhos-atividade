import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCUR8gD1VQvYNc0srJw3cNQ8zGyPFE8Gsw",
  authDomain: "teste-6dd61.firebaseapp.com",
  projectId: "teste-6dd61",
  storageBucket: "teste-6dd61.firebasestorage.app",
  messagingSenderId: "683420881889",
  appId: "1:683420881889:web:410a17ba0bf66d360e38a0",
  measurementId: "G-73N33EVQ80"
};
const db = getFirestore(initializeApp(firebaseConfig));
const COL = "mural_frases";
const colecao = collection(db, COL);
const $ = (id) => document.getElementById(id);

let conselho = null;   // { id, en, pt }
let editandoId = null, itens = [], timer;

function aviso(msg, erro = false) {
  const el = $("aviso");
  el.textContent = msg; el.className = "aviso" + (erro ? " erro" : ""); el.hidden = false;
  clearTimeout(timer); timer = setTimeout(() => (el.hidden = true), 3000);
}

/* ===== API EXTERNA 1: Advice Slip (conselho aleatório) ===== */
async function sortearConselho() {
  const slip = $("slip");
  ["btn-novo", "btn-guardar", "btn-copiar"].forEach((i) => ($(i).disabled = true));
  slip.classList.add("carregando");
  $("original").textContent = "";
  try {
    const r = await fetch("https://api.adviceslip.com/advice?t=" + Date.now()); // t evita cache da API
    if (!r.ok) throw new Error("HTTP " + r.status);
    const { slip: s } = JSON.parse(await r.text());
    conselho = { id: s.id, en: s.advice, pt: null };
    $("conselho").textContent = "“" + s.advice + "”";
    $("original").textContent = "Traduzindo para o português…";
    conselho.pt = await traduzir(s.advice);
    if (conselho.pt) {
      $("conselho").textContent = "“" + conselho.pt + "”";
      $("original").textContent = "Original (nº " + s.id + "): " + s.advice;
    } else {
      $("original").textContent = "Conselho nº " + s.id + " (tradução indisponível)";
    }
    ["btn-guardar", "btn-copiar"].forEach((i) => ($(i).disabled = false));
  } catch (e) {
    conselho = null;
    $("conselho").textContent = "Não foi possível buscar um conselho agora.";
    $("original").textContent = "Verifique sua conexão e clique em “Novo conselho”.";
  } finally {
    slip.classList.remove("carregando");
    $("btn-novo").disabled = false;
  }
}

/* ===== API EXTERNA 2: MyMemory (tradução EN -> PT-BR, opcional) ===== */
async function traduzir(texto) {
  try {
    const c = new AbortController(); setTimeout(() => c.abort(), 6000);
    const r = await fetch("https://api.mymemory.translated.net/get?langpair=en|pt-BR&q=" + encodeURIComponent(texto), { signal: c.signal });
    const j = await r.json();
    return j.responseStatus === 200 ? j.responseData.translatedText : null;
  } catch { return null; }
}

$("btn-novo").addEventListener("click", sortearConselho);
$("btn-copiar").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(conselho.pt || conselho.en); aviso("Conselho copiado."); }
  catch { aviso("Não foi possível copiar.", true); }
});

/* ===== CRUD ===== */
// CREATE a partir da API
$("btn-guardar").addEventListener("click", async () => {
  if (!conselho) return;
  try {
    await addDoc(colecao, {
      texto: conselho.pt || conselho.en, original: conselho.en, nota: "", cor: "amarelo", favorita: false,
      origem: "Advice Slip nº " + conselho.id, criadoEm: serverTimestamp()
    });
    $("btn-guardar").disabled = true; aviso("Conselho fixado no mural.");
  } catch (e) { aviso("Erro ao salvar: " + e.message, true); }
});

// Abrir/fechar formulário
const dlg = $("dlg"), form = $("form");
function abrirForm(item) {
  editandoId = item ? item.id : null;
  $("texto").value = item?.texto || ""; $("nota").value = item?.nota || ""; $("cor").value = item?.cor || "amarelo";
  $("form-titulo").textContent = item ? "Editar nota" : "Escrever frase";
  $("btn-salvar").textContent = item ? "Atualizar nota" : "Fixar no mural";
  dlg.showModal(); $("texto").focus();
}
$("btn-escrever").addEventListener("click", () => abrirForm(null));
$("btn-cancelar").addEventListener("click", () => dlg.close());

// CREATE (manual) e UPDATE (edição)
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const dados = { texto: $("texto").value.trim(), nota: $("nota").value.trim(), cor: $("cor").value };
  if (!dados.texto) return;
  $("btn-salvar").disabled = true;
  try {
    if (editandoId) { await updateDoc(doc(db, COL, editandoId), dados); aviso("Nota atualizada."); }
    else { await addDoc(colecao, { ...dados, favorita: false, origem: "Escrita por mim", criadoEm: serverTimestamp() }); aviso("Frase fixada no mural."); }
    dlg.close();
  } catch (e) { aviso("Erro ao salvar: " + e.message, true); }
  finally { $("btn-salvar").disabled = false; }
});

// UPDATE (favoritar) e DELETE
async function favoritar(i) {
  try { await updateDoc(doc(db, COL, i.id), { favorita: !i.favorita }); }
  catch (e) { aviso("Erro: " + e.message, true); }
}
async function excluir(i) {
  if (!confirm("Remover esta nota do mural?")) return;
  try { await deleteDoc(doc(db, COL, i.id)); aviso("Nota removida."); }
  catch (e) { aviso("Erro ao excluir: " + e.message, true); }
}

// READ (tempo real) + filtros
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }

function desenhar() {
  const b = $("busca").value.trim().toLowerCase(), cor = $("f-cor").value, fav = $("f-fav").checked;
  const lista = itens.filter((i) =>
    (!cor || i.cor === cor) && (!fav || i.favorita) &&
    (!b || (i.texto + " " + (i.nota || "") + " " + (i.original || "")).toLowerCase().includes(b)));

  const favs = itens.filter((i) => i.favorita).length;
  $("stats").textContent = itens.length ? itens.length + " notas · " + favs + " favoritas" : "";
  const vazio = $("vazio");
  vazio.hidden = lista.length > 0;
  vazio.textContent = itens.length ? "Nenhuma nota combina com os filtros." : "Seu mural está vazio. Sorteie um conselho acima ou escreva uma frase.";

  const mural = $("mural"); mural.replaceChildren();
  for (const i of lista) {
    const n = el("article", "nota " + (i.cor || "amarelo"));
    n.append(el("p", "texto", i.texto));
    if (i.nota) n.append(el("p", "reflexao", i.nota));
    if (i.original) n.append(el("p", "orig", "Original: " + i.original));
    n.append(el("p", "origem", i.origem || ""));
    const bt = el("div", "botoes");
    const e = el("button", "", "Editar"); e.onclick = () => abrirForm(i);
    const x = el("button", "", "Excluir"); x.onclick = () => excluir(i);
    const f = el("button", "fav", i.favorita ? "★" : "☆"); f.title = "Favoritar"; f.setAttribute("aria-label", "Favoritar"); f.onclick = () => favoritar(i);
    bt.append(e, x, f); n.append(bt); mural.append(n);
  }
}
["busca", "f-cor", "f-fav"].forEach((id) => $(id).addEventListener("input", desenhar));

onSnapshot(query(colecao, orderBy("criadoEm", "desc")),
  (s) => { itens = s.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); },
  (e) => aviso("Erro ao carregar o mural: " + e.message, true));

sortearConselho();
