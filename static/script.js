// ── CONSTANTES ───────────────────────────────────────────
const C = {
  VOL_BAG: 84.7, PESO_BAG: 30, VEL: 35,
  TAXA_BASE: 5, TAXA_KM: 2, MAX_PED: 3, MAX_KM: 20
};

const TIPO = window.TIPO_USUARIO;

// ── ESTADO ───────────────────────────────────────────────
let cardapio = [], pedidoAtual = {}, origem = null, destino = null,
    distAtualKm = null, pedidos = [], pedidoSelecionadoId = null,
    rotaCache = null, toastTimer = null, instrucoesFechado = false,
    classificacaoAtual = 'peso';

let metricas = {
  moto: { ganhos: 0, km: 0, entregas: 0 },
  rest: { lucro: 0, vendas: 0, pedidos: 0, custoEntregas: 0 }
};

// ── PRODUTOS PRE-CADASTRADOS ─────────────────────────────
const PRODUTOS_PADRAO = [
  { id: 1, nome: 'X-Burguer',        emoji: '🍔', peso: 0.35, volume: 1.8, preco: 22.00, lucro: 10.00 },
  { id: 2, nome: 'X-Bacon Duplo',    emoji: '🥓', peso: 0.55, volume: 2.5, preco: 32.00, lucro: 14.00 },
  { id: 3, nome: 'Pizza Margherita', emoji: '🍕', peso: 0.90, volume: 8.0, preco: 45.00, lucro: 20.00 },
  { id: 4, nome: 'Coca-Cola 600ml',  emoji: '🥤', peso: 0.65, volume: 0.8, preco: 8.00,  lucro: 4.00 },
  { id: 5, nome: 'Batata Frita G',   emoji: '🍟', peso: 0.40, volume: 2.0, preco: 18.00, lucro: 9.00 },
  { id: 6, nome: 'Acai 500ml',       emoji: '🫐', peso: 0.55, volume: 0.6, preco: 25.00, lucro: 12.00 },
  { id: 7, nome: 'Marmitex G',       emoji: '🍱', peso: 0.80, volume: 3.0, preco: 20.00, lucro: 8.00 },
  { id: 8, nome: 'Sushi Combo 20pc', emoji: '🍣', peso: 0.60, volume: 4.0, preco: 55.00, lucro: 25.00 },
];

// Carregar cardapio salvo ou usar padrao
const savedCardapio = localStorage.getItem('motorota_cardapio');
if (savedCardapio) {
  try { cardapio = JSON.parse(savedCardapio); } catch { cardapio = [...PRODUTOS_PADRAO]; }
} else {
  cardapio = [...PRODUTOS_PADRAO];
}

// Carregar pedidos do servidor (compartilhados entre restaurante e motoboy)
async function carregarPedidosDoServidor() {
  try {
    const res = await fetch('/api/pedidos');
    if (res.ok) {
      pedidos = await res.json();
      renderPedidosPublicados(); renderRotasMotoboy();
    }
  } catch {}
}
carregarPedidosDoServidor();

// Polling: busca pedidos atualizados a cada 3 segundos
setInterval(carregarPedidosDoServidor, 3000);

function salvarEstado() {
  localStorage.setItem('motorota_cardapio', JSON.stringify(cardapio));
}

// ── MAPAS ─────────────────────────────────────────────────
let mapRest = null, mapMoto = null;
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const lyr = { rest: {}, moto: { paradas: [] } };

if (TIPO === 'restaurante') {
  mapRest = L.map('map-rest').setView([-23.55, -46.63], 12);
  L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(mapRest);
  mapRest.on('click', () => toast('Use os campos de texto para definir enderecos', 'info'));
} else {
  mapMoto = L.map('map-moto').setView([-23.55, -46.63], 12);
  L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(mapMoto);
}

const mkIcon = e => L.divIcon({ html: `<div style="font-size:26px;line-height:1">${e}</div>`, iconSize:[30,30], iconAnchor:[15,28], className:'' });

// ── UTILITARIOS ───────────────────────────────────────────
const preco  = km => C.TAXA_BASE + km * C.TAXA_KM;
const tempo  = km => Math.round(km / C.VEL * 60);
const fmt    = v  => `R$ ${v.toFixed(2).replace('.', ',')}`;
const distTurf = (a, b) => turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), { units: 'kilometers' });

function toast(msg, tipo = 'ok') {
  const t = document.getElementById('toast');
  const [cor, ico] = tipo === 'erro' ? ['var(--vermelho)','⚠️'] : tipo === 'info' ? ['var(--azul)','ℹ️'] : tipo === 'alerta' ? ['var(--amarelo)','🔶'] : ['var(--verde)','✅'];
  t.textContent = `${ico} ${msg}`;
  t.style.borderColor = t.style.color = cor;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function rmLayer(modo, key) {
  const m = modo === 'rest' ? mapRest : mapMoto;
  if (m && lyr[modo][key]) { m.removeLayer(lyr[modo][key]); lyr[modo][key] = null; }
}

function infoEntrega(modo, km) {
  const pfx = modo === 'rest' ? 'Rest' : 'Moto';
  if (km == null || isNaN(km)) {
    const el1 = document.getElementById('distancia'+pfx);
    const el2 = document.getElementById('tempo'+pfx);
    const el3 = document.getElementById('preco'+pfx);
    if (el1) el1.textContent = '— km';
    if (el2) el2.textContent = '— min';
    if (el3) el3.textContent = 'R$ —';
    return;
  }
  const el1 = document.getElementById('distancia'+pfx);
  const el2 = document.getElementById('tempo'+pfx);
  const el3 = document.getElementById('preco'+pfx);
  if (el1) el1.textContent = `${km.toFixed(2)} km`;
  if (el2) el2.textContent = `${tempo(km)} min`;
  if (el3) el3.textContent = `R$ ${preco(km).toFixed(2)}`;
}

// ── SUB-ABAS ─────────────────────────────────────────────
function mudarSubAba(painel, aba, btn) {
  const prefix = `sub-${painel}-`;
  document.querySelectorAll(`[id^="${prefix}"]`).forEach(p => p.classList.remove('active'));
  document.getElementById(prefix + aba).classList.add('active');
  btn.parentElement.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Invalidar mapa ao trocar para aba de mapa
  setTimeout(() => {
    if (mapRest) mapRest.invalidateSize();
    if (mapMoto) mapMoto.invalidateSize();
  }, 80);
}

// ── ENDERECO ──────────────────────────────────────────────
async function buscarEndereco(tipo) {
  const isOrig  = tipo === 'origem';
  const inputEl = document.getElementById(isOrig ? 'endOrigem' : 'endDestino');
  const statusEl = document.getElementById(isOrig ? 'statusOrigem' : 'statusDestino');
  const val = inputEl.value.trim();
  if (!val) { toast('Digite um endereco ou CEP', 'erro'); return; }
  statusEl.textContent = '⏳ Buscando...';
  try {
    let query = val;
    const cep = val.replace(/\D/g, '');
    if (cep.length === 8) {
      const d = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
      if (d.erro) { statusEl.textContent = '❌ CEP nao encontrado'; return; }
      query = `${d.logradouro}, ${d.localidade}, ${d.uf}, Brasil`;
    } else query += ', Brasil';

    const [res] = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)).json();
    if (!res) { statusEl.textContent = '❌ Endereco nao encontrado'; return; }

    const pt = { lat: +res.lat, lng: +res.lon, nome: val };
    const [emoji, pop] = isOrig ? ['🍽️','Restaurante'] : ['📍','Cliente'];
    rmLayer('rest', isOrig ? 'origem' : 'destino');
    if (mapRest) {
      lyr.rest[isOrig ? 'origem' : 'destino'] = L.marker([pt.lat, pt.lng], { icon: mkIcon(emoji) }).bindPopup(`${emoji} ${pop}: ${val}`).addTo(mapRest);
      mapRest.setView([pt.lat, pt.lng], 14);
    }
    if (isOrig) origem = pt; else destino = pt;
    statusEl.textContent = `✅ ${isOrig ? 'Origem' : 'Destino'} definido!`;
    toast(`${isOrig ? 'Origem' : 'Destino'} definido!`);
    atualizarPontos('rest');
    if (origem && destino && mapRest) mapRest.fitBounds([[origem.lat, origem.lng], [destino.lat, destino.lng]], { padding: [40,40] });
  } catch { statusEl.textContent = '❌ Erro ao buscar'; toast('Erro ao buscar endereco', 'erro'); }
}

// ── GRAPHHOPPER ───────────────────────────────────────────
const GH_KEY = '55348d71-d3d0-4300-856f-6ae996b3d9ca';
const TURN_MAP = { '-3':'↰','-2':'←','-1':'↖','0':'⬆','1':'↗','2':'→','3':'↱','4':'🏁','5':'📍','6':'🔄','7':'↪' };

function iconeTurn(sign) { return TURN_MAP[String(sign)] || '⬆'; }
function fmtDist(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`; }

async function ghRoute(points) {
  if (!GH_KEY) throw new Error('SEM_KEY');
  const pts = points.map(p => `point=${p.lat},${p.lng}`).join('&');
  const d = await (await fetch(`https://graphhopper.com/api/1/route?${pts}&profile=car&points_encoded=false&instructions=true&locale=pt_BR&key=${GH_KEY}`)).json();
  if (!d.paths?.length) throw new Error(d.message || 'Rota nao encontrada');
  const path = d.paths[0];
  return {
    distKm:    path.distance / 1000,
    coords:    path.points.coordinates.map(c => [c[1], c[0]]),
    instrucoes: (path.instructions || []).map(i => ({ texto: i.text||'', sign: i.sign, distancia: i.distance||0, rua: i.street_name||'' }))
  };
}

async function calcularRota(modo) {
  const o = modo === 'rest' ? origem : pedidos.find(p => p.id === pedidoSelecionadoId)?.origem;
  const d = modo === 'rest' ? destino : pedidos.find(p => p.id === pedidoSelecionadoId)?.destino;
  if (!o || !d) { toast('Defina origem e destino primeiro!', 'erro'); return; }
  try {
    const { distKm, coords } = await ghRoute([o, d]);
    const mapAlvo = modo === 'rest' ? mapRest : mapMoto;
    if (!mapAlvo) return;
    rmLayer(modo, 'rota');
    lyr[modo].rota = L.polyline(coords, { color:'#ff6b00', weight:5, opacity:0.9 }).addTo(mapAlvo);
    mapAlvo.fitBounds(lyr[modo].rota.getBounds(), { padding:[28,28] });
    if (modo === 'rest') distAtualKm = distKm;
    infoEntrega(modo, distKm);
    toast(`Rota: ${distKm.toFixed(2)} km · ${tempo(distKm)} min · R$ ${preco(distKm).toFixed(2)}`);
  } catch (e) { toast('Erro ao calcular rota: ' + e.message, 'erro'); }
}

// ── PONTOS DO MAPA ────────────────────────────────────────
function atualizarPontos(modo) {
  const el = document.getElementById(`pontosMapa-${modo}`);
  if (!el) return;
  const o  = modo === 'rest' ? origem : pedidos.find(p => p.id === pedidoSelecionadoId)?.origem;
  const d  = modo === 'rest' ? destino : pedidos.find(p => p.id === pedidoSelecionadoId)?.destino;
  const pts = [o && { label:'R', cor:'ponto-R', emoji:'🍽️', nome:o.nome }, d && { label:'D', cor:'ponto-D', emoji:'📍', nome:d.nome }].filter(Boolean);
  el.innerHTML = pts.length
    ? pts.map(p => `<div class="ponto-item"><div class="ponto-num ${p.cor}">${p.label}</div><span>${p.emoji} ${p.nome}</span></div>`).join('')
    : `<div style="font-size:12px;color:var(--texto-muted);">${modo==='rest'?'Nenhum ponto definido.':'Aceite uma rota para ver os pontos.'}</div>`;
}

function limparMapa(modo) {
  ['origem','destino','rota'].forEach(k => rmLayer(modo, k));
  if (modo === 'moto') { lyr.moto.paradas.forEach(m => mapMoto.removeLayer(m)); lyr.moto.paradas = []; }
  if (modo === 'rest') {
    origem = destino = null; distAtualKm = null;
    const el1 = document.getElementById('endOrigem');
    const el2 = document.getElementById('endDestino');
    if (el1) el1.value = '';
    if (el2) el2.value = '';
    const s1 = document.getElementById('statusOrigem');
    const s2 = document.getElementById('statusDestino');
    if (s1) s1.textContent = '';
    if (s2) s2.textContent = '';
  } else { pedidoSelecionadoId = null; rotaCache = null; renderInstrucoes(); }
  infoEntrega(modo, null);
  modo === 'moto' ? atualizarParadasMotoboy() : atualizarPontos(modo);
  toast('Mapa limpo!');
}

// ── MENU ──────────────────────────────────────────────────
function adicionarItem() {
  const [nome, emoji, peso, volume, preco_, lucro] = ['itemNome','itemEmoji','itemPeso','itemVolume','itemPreco','itemLucro'].map(id => document.getElementById(id).value.trim());
  if (!nome || [peso,volume,preco_,lucro].some(v => isNaN(+v) || v==='')) { toast('Preencha todos os campos!', 'erro'); return; }
  cardapio.push({ id: Date.now(), nome, emoji: emoji||'🍽️', peso:+peso, volume:+volume, preco:+preco_, lucro:+lucro });
  ['itemNome','itemEmoji','itemPeso','itemVolume','itemPreco','itemLucro'].forEach(id => document.getElementById(id).value = '');
  renderCardapio(); renderSelector(); salvarEstado(); toast('Item adicionado!');
}

function removerItem(id) {
  cardapio = cardapio.filter(i => i.id !== id);
  delete pedidoAtual[id];
  renderCardapio(); renderSelector(); renderResumoPedido(); salvarEstado();
}

function renderCardapio() {
  const tbody = document.getElementById('tabelaItens');
  const empty = document.getElementById('emptyCardapio');
  if (!tbody || !empty) return;
  empty.style.display = cardapio.length ? 'none' : 'block';
  tbody.innerHTML = cardapio.map(it => `
    <tr>
      <td><div class="nome-cell"><span style="font-size:18px">${it.emoji}</span>${it.nome}</div></td>
      <td><span class="badge">${it.peso} kg</span></td>
      <td><span class="badge">${it.volume} L</span></td>
      <td>R$ ${it.preco.toFixed(2)}</td>
      <td class="lucro-val">R$ ${it.lucro.toFixed(2)}</td>
      <td><button class="btn btn-secondary btn-sm" style="color:var(--vermelho);padding:5px 10px;font-size:11px;" onclick="removerItem(${it.id})">✕</button></td>
    </tr>`).join('');
}

// ── SELETOR DE ITENS ──────────────────────────────────────
function renderSelector() {
  const el = document.getElementById('pedidoSelector');
  if (!el) return;
  if (!cardapio.length) { el.innerHTML = '<div class="empty" style="padding:20px;font-size:13px;">Cadastre itens no menu primeiro.</div>'; return; }
  el.innerHTML = cardapio.map(it => `
    <div class="pedido-item-selector">
      <div class="pedido-item-selector-left">
        <span style="font-size:20px">${it.emoji}</span>
        <div><div>${it.nome}</div><div style="font-size:11px;color:var(--texto-muted);">⚖️ ${it.peso}kg · 📦 ${it.volume}L · R$ ${it.preco.toFixed(2)}</div></div>
      </div>
      <div class="qtd-controls">
        <button class="qtd-btn" onclick="ajustarQtd(${it.id},-1)">−</button>
        <span class="qtd-display">${pedidoAtual[it.id]||0}</span>
        <button class="qtd-btn" onclick="ajustarQtd(${it.id},1)">+</button>
      </div>
    </div>`).join('');
}

function ajustarQtd(itemId, delta) {
  const nova = Math.max(0, (pedidoAtual[itemId]||0) + delta);
  nova === 0 ? delete pedidoAtual[itemId] : pedidoAtual[itemId] = nova;
  renderSelector(); renderResumoPedido();
}

// Somas do pedido atual
const somaItens = prop => Object.entries(pedidoAtual).reduce((s,[id,q]) => s + (cardapio.find(i=>i.id===+id)?.[prop]||0)*q, 0);
const totalItens = () => Object.values(pedidoAtual).reduce((a,b)=>a+b,0);

function renderResumoPedido() {
  const el = document.getElementById('resumoPedido');
  if (!el) return;
  const tot = totalItens();
  if (!tot) { el.innerHTML = ''; return; }
  const [vol, peso, venda, lucro_] = ['volume','peso','preco','lucro'].map(somaItens);
  const pctVol = (vol / C.VOL_BAG * 100).toFixed(1);
  const pctPeso = (peso / C.PESO_BAG * 100).toFixed(1);
  const excedeBag = vol > C.VOL_BAG || peso > C.PESO_BAG;
  el.innerHTML = `
    <div class="resultado" style="display:block;margin-top:14px;">
      <div class="resultado-header"><span style="font-size:22px">🛒</span><h2 style="font-size:20px;">Resumo do Pedido</h2></div>
      ${excedeBag ? `<div class="info-box" style="border-color:var(--amarelo);color:var(--amarelo);background:rgba(255,214,0,0.08);margin-bottom:14px;">⚠️ Pedido excede a capacidade da bag! Sera dividido automaticamente em ${Math.ceil(Math.max(vol/C.VOL_BAG, peso/C.PESO_BAG))} entregas ao publicar.</div>` : ''}
      <div class="stats-grid">
        <div class="stat-box"><div class="stat-label">Itens</div><div class="stat-value">${tot}</div></div>
        <div class="stat-box"><div class="stat-label">Total Venda</div><div class="stat-value">R$ ${venda.toFixed(2)}</div></div>
        <div class="stat-box"><div class="stat-label">Lucro</div><div class="stat-value" style="color:var(--verde)">R$ ${lucro_.toFixed(2)}</div></div>
        <div class="stat-box"><div class="stat-label">Peso</div><div class="stat-value" style="${peso > C.PESO_BAG ? 'color:var(--vermelho)' : ''}">${peso.toFixed(2)}<span style="font-size:12px"> kg</span></div></div>
        <div class="stat-box"><div class="stat-label">Volume</div><div class="stat-value" style="${vol > C.VOL_BAG ? 'color:var(--vermelho)' : ''}">${vol.toFixed(2)}<span style="font-size:12px"> L</span></div><div class="stat-sub">${pctVol}% de ${C.VOL_BAG} L</div></div>
      </div>
      <div class="progress-label"><span>📦 Volume da Bag</span><span>${vol.toFixed(2)} / ${C.VOL_BAG} L</span></div>
      <div class="progress-bar"><div class="progress-fill fill-vol" style="width:${Math.min(100,pctVol)}%"></div></div>
      <div class="progress-label"><span>⚖️ Peso da Bag</span><span>${peso.toFixed(2)} / ${C.PESO_BAG} kg</span></div>
      <div class="progress-bar"><div class="progress-fill fill-peso" style="width:${Math.min(100,pctPeso)}%"></div></div>
    </div>`;
}

function limparPedidoAtual() {
  pedidoAtual = {}; origem = destino = null; distAtualKm = null;
  const el1 = document.getElementById('endOrigem');
  const el2 = document.getElementById('endDestino');
  if (el1) el1.value = '';
  if (el2) el2.value = '';
  const s1 = document.getElementById('statusOrigem');
  const s2 = document.getElementById('statusDestino');
  if (s1) s1.textContent = '';
  if (s2) s2.textContent = '';
  ['origem','destino','rota'].forEach(k => rmLayer('rest', k));
  infoEntrega('rest', null); atualizarPontos('rest');
  renderSelector(); renderResumoPedido(); toast('Formulario limpo');
}

// ── KNAPSACK ILP ──────────────────────────────────────────
function otimizarBag(qtdMax = 10) {
  if (!window.LPSolver || !cardapio.length) return null;
  const vars = {}, constraints = { volume: { max: C.VOL_BAG }, peso: { max: C.PESO_BAG } }, ints = {};
  cardapio.forEach(it => {
    const v = `i${it.id}`;
    vars[v] = { lucro: it.lucro, volume: it.volume, peso: it.peso, [`lim${it.id}`]: 1 };
    constraints[`lim${it.id}`] = { max: qtdMax };
    ints[v] = 1;
  });
  const res = window.LPSolver.Solve({ optimize:'lucro', opType:'max', constraints, variables:vars, ints });
  if (!res.feasible) return null;
  return cardapio.flatMap(it => {
    const q = Math.round(res[`i${it.id}`] || 0);
    return q > 0 ? [{ ...it, qtd: q }] : [];
  });
}

function sugerirCombinacaoOtima() {
  if (!cardapio.length) { toast('Cadastre itens no menu primeiro!', 'erro'); return; }
  toast('Calculando combinacao otima...', 'info');
  setTimeout(() => {
    const itens = otimizarBag();
    if (!itens?.length) { toast('Nenhuma combinacao viavel.', 'erro'); return; }
    pedidoAtual = Object.fromEntries(itens.map(it => [it.id, it.qtd]));
    renderSelector(); renderResumoPedido();
    const [lucro_, vol, peso] = ['lucro','volume','peso'].map(somaItens);
    toast(`Otimo: Lucro R$ ${lucro_.toFixed(2)} · ${vol.toFixed(1)} L · ${peso.toFixed(1)} kg`);
  }, 50);
}

// ── DIVISAO DE PEDIDOS ────────────────────────────────────
// Quando o pedido excede a capacidade da bag (volume ou peso),
// divide automaticamente em multiplos pedidos menores
function dividirPedido(itensCompletos, origemP, destinoP, distKm) {
  const pedidosDivididos = [];
  let itensRestantes = itensCompletos.map(it => ({ ...it })); // clone

  while (itensRestantes.length > 0) {
    const pedidoAtualDiv = [];
    let pesoAcum = 0, volAcum = 0;

    for (let i = itensRestantes.length - 1; i >= 0; i--) {
      const it = itensRestantes[i];
      let qtdCabe = 0;

      for (let q = 1; q <= it.qtd; q++) {
        const novoPeso = pesoAcum + it.peso * q;
        const novoVol = volAcum + it.volume * q;
        if (novoPeso <= C.PESO_BAG && novoVol <= C.VOL_BAG) {
          qtdCabe = q;
        } else {
          break;
        }
      }

      if (qtdCabe > 0) {
        pedidoAtualDiv.push({ ...it, qtd: qtdCabe });
        pesoAcum += it.peso * qtdCabe;
        volAcum += it.volume * qtdCabe;

        if (qtdCabe >= it.qtd) {
          itensRestantes.splice(i, 1);
        } else {
          itensRestantes[i].qtd -= qtdCabe;
        }
      }
    }

    // Se nao conseguiu colocar nada (item unico > bag), forca 1 unidade
    if (pedidoAtualDiv.length === 0 && itensRestantes.length > 0) {
      const it = itensRestantes.shift();
      pedidoAtualDiv.push({ ...it, qtd: 1 });
      if (it.qtd > 1) {
        itensRestantes.unshift({ ...it, qtd: it.qtd - 1 });
      }
    }

    if (pedidoAtualDiv.length > 0) {
      const pesoTotal = pedidoAtualDiv.reduce((s, it) => s + it.peso * it.qtd, 0);
      const volumeTotal = pedidoAtualDiv.reduce((s, it) => s + it.volume * it.qtd, 0);
      const vendaTotal = pedidoAtualDiv.reduce((s, it) => s + it.preco * it.qtd, 0);
      const lucroTotal = pedidoAtualDiv.reduce((s, it) => s + it.lucro * it.qtd, 0);

      pedidosDivididos.push({
        id: Date.now() + pedidosDivididos.length,
        origem: { ...origemP },
        destino: { ...destinoP },
        itens: pedidoAtualDiv,
        distKm, tempoMin: tempo(distKm), precoEntrega: preco(distKm),
        pesoTotal, volumeTotal, vendaTotal, lucroTotal,
        status: 'aguardando',
        criadoEm: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
      });
    }
  }

  return pedidosDivididos;
}

// ── PUBLICAR PEDIDO ───────────────────────────────────────
async function enviarPedidosServidor(novosPedidos) {
  try {
    await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(novosPedidos)
    });
  } catch { toast('Erro ao enviar pedido ao servidor', 'erro'); }
}

async function atualizarPedidoServidor(id, dados) {
  try {
    await fetch(`/api/pedidos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
  } catch {}
}

async function publicarRota() {
  if (!origem || !destino)         { toast('Defina origem e destino!', 'erro'); return; }
  if (!totalItens())               { toast('Selecione itens!', 'erro'); return; }
  if (distAtualKm == null)         { toast('Calcule a rota antes de publicar!', 'erro'); return; }

  const itensCompletos = Object.entries(pedidoAtual).map(([id,qtd]) => ({ ...cardapio.find(i=>i.id===+id), qtd }));
  const pesoTotal = itensCompletos.reduce((s, it) => s + it.peso * it.qtd, 0);
  const volumeTotal = itensCompletos.reduce((s, it) => s + it.volume * it.qtd, 0);

  // Verificar se precisa dividir
  if (volumeTotal > C.VOL_BAG || pesoTotal > C.PESO_BAG) {
    const divididos = dividirPedido(itensCompletos, origem, destino, distAtualKm);
    pedidos.push(...divididos);
    await enviarPedidosServidor(divididos);
    limparPedidoAtual(); renderPedidosPublicados(); renderRotasMotoboy();
    salvarEstado();
    toast(`Pedido dividido em ${divididos.length} entregas (excedia a bag)!`, 'alerta');
    return;
  }

  const novoPedido = {
    id: Date.now(), origem: {...origem}, destino: {...destino},
    itens: itensCompletos,
    distKm: distAtualKm, tempoMin: tempo(distAtualKm), precoEntrega: preco(distAtualKm),
    pesoTotal, volumeTotal,
    vendaTotal: itensCompletos.reduce((s, it) => s + it.preco * it.qtd, 0),
    lucroTotal: itensCompletos.reduce((s, it) => s + it.lucro * it.qtd, 0),
    status: 'aguardando',
    criadoEm: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
  };
  pedidos.push(novoPedido);
  await enviarPedidosServidor([novoPedido]);
  limparPedidoAtual(); renderPedidosPublicados(); renderRotasMotoboy();
  salvarEstado();
  toast('Pedido publicado!');
}

// ── CARDS DE STATUS ───────────────────────────────────────
const STATUS = {
  aguardando: { cls:'',          badge:'status-aguardando', ico:'⏳', txt:'Aguardando motoboy', txtM:'Disponivel' },
  aceito:     { cls:'aceita',    badge:'status-aceita',     ico:'🏍️', txt:'Motoboy a caminho',  txtM:'Aceita' },
  entregue:   { cls:'entregue',  badge:'status-entregue',   ico:'📦', txt:'Entregue!',          txtM:'Entregue' },
  cancelado:  { cls:'cancelada', badge:'status-cancelada',  ico:'❌', txt:'Cancelado',           txtM:'Cancelado' }
};

function renderPedidosPublicados() {
  const el = document.getElementById('pedidosPublicados');
  if (!el) return;
  if (!pedidos.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Nenhum pedido publicado ainda.</div>'; return; }
  el.innerHTML = pedidos.map(p => {
    const s = STATUS[p.status];
    const itensHTML = p.itens.map(it => `<span class="badge">${it.emoji} ${it.nome} ×${it.qtd}</span>`).join(' ');
    const acao = (p.status==='aguardando'||p.status==='aceito') ? `<button class="btn btn-danger btn-sm" onclick="cancelarPedido(${p.id})">❌ CANCELAR</button>` : '';
    return `
      <div class="rota-card ${s.cls}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:700;margin-bottom:6px">Pedido #${p.id.toString().slice(-4)} <span style="font-size:11px;color:var(--texto-muted)">· ${p.criadoEm}</span></div>
            <div style="font-size:12px;color:var(--texto-muted)">🍽️ ${p.origem.nome}</div>
            <div style="font-size:12px;color:var(--texto-muted)">📍 ${p.destino.nome}</div>
            <div style="font-size:12px;color:var(--texto-muted);margin-top:4px">🛣️ ${p.distKm.toFixed(2)} km · ⏱️ ${p.tempoMin} min · 💰 R$ ${p.precoEntrega.toFixed(2)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <span class="status-badge ${s.badge}">${s.ico} ${s.txt}</span>${acao}
          </div>
        </div>
        <div style="border-top:1px solid var(--cinza-claro);padding-top:10px">
          <div style="font-size:11px;color:var(--texto-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Itens do pedido</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${itensHTML}</div>
          <div style="font-size:12px;color:var(--verde);font-weight:700;margin-top:8px">💰 Lucro: R$ ${p.lucroTotal.toFixed(2)} · ⚖️ ${p.pesoTotal.toFixed(2)} kg · 📦 ${p.volumeTotal.toFixed(2)} L</div>
        </div>
      </div>`;
  }).join('');
}

async function cancelarPedido(id) {
  const p = pedidos.find(x => x.id===id);
  if (!p || !confirm(`Cancelar pedido #${id.toString().slice(-4)}?`)) return;
  p.status = 'cancelado';
  await atualizarPedidoServidor(id, { status: 'cancelado' });
  renderPedidosPublicados(); renderRotasMotoboy(); salvarEstado();
  toast('Pedido cancelado', 'info');
}

// ── CLASSIFICACAO DE ROTAS (MOTOBOY) ──────────────────────
function classificarRotas(tipo, btn) {
  classificacaoAtual = tipo;
  if (btn) {
    btn.parentElement.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  renderRotasMotoboy();
}

function ordenarPedidosParaMotoboy(lista) {
  const copia = [...lista];
  switch (classificacaoAtual) {
    case 'peso':
      // Menor peso primeiro = mais facil de carregar
      return copia.sort((a, b) => a.pesoTotal - b.pesoTotal);
    case 'valor':
      // Maior valor primeiro = mais lucrativo
      return copia.sort((a, b) => b.precoEntrega - a.precoEntrega);
    case 'distancia':
      // Menor distancia primeiro
      return copia.sort((a, b) => a.distKm - b.distKm);
    case 'eficiencia':
      // Melhor relacao R$/kg (valor por kg transportado)
      return copia.sort((a, b) => {
        const efA = a.pesoTotal > 0 ? a.precoEntrega / a.pesoTotal : 0;
        const efB = b.pesoTotal > 0 ? b.precoEntrega / b.pesoTotal : 0;
        return efB - efA;
      });
    default:
      return copia;
  }
}

// ── ALERTA DE ROTA LONGA ──────────────────────────────────
function mostrarAlertaRota(distKm) {
  const alerta = document.getElementById('alertaRota');
  const msg = document.getElementById('alertaRotaMsg');
  if (!alerta || !msg) return;
  msg.textContent = `A rota tem ${distKm.toFixed(2)} km, excedendo o limite de ${C.MAX_KM} km. Considere aceitar menos pedidos.`;
  alerta.classList.add('show');
  setTimeout(() => alerta.classList.remove('show'), 8000);
}

function fecharAlertaRota() {
  const alerta = document.getElementById('alertaRota');
  if (alerta) alerta.classList.remove('show');
}

// ── PAINEL MOTOBOY ────────────────────────────────────────
function renderRotasMotoboy() {
  const el = document.getElementById('rotasDisponiveis');
  if (!el) return;
  if (mapMoto) mapMoto.invalidateSize();
  if (!pedidos.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">🏪</div>Nenhuma rota publicada ainda.</div>'; return; }
  const aceitos  = pedidos.filter(p => p.status==='aceito');
  const noLimite = aceitos.length >= C.MAX_PED;
  const dist = rotaCache?.distKm ?? 0, tmp = rotaCache?.tempoMin ?? 0;
  const pesoAceito = aceitos.reduce((s, p) => s + p.pesoTotal, 0);

  // Classificar pedidos disponiveis
  const pedidosOrdenados = ordenarPedidosParaMotoboy(pedidos);

  // Calcular metrica de classificacao label
  const classLabels = {
    peso: '⚖️ Ordenado por menor peso',
    valor: '💰 Ordenado por maior valor',
    distancia: '🛣️ Ordenado por menor distancia',
    eficiencia: '⚡ Ordenado por melhor R$/kg'
  };

  el.innerHTML = `
    <div class="info-box" style="margin-bottom:14px">
      🏍️ Pedidos aceitos: <strong>${aceitos.length} / ${C.MAX_PED}</strong>
      ${aceitos.length ? ` · 🛣️ <strong>${dist.toFixed(2)} km</strong> / ${C.MAX_KM} km · ⏱️ <strong>${tmp} min</strong> · ⚖️ Peso na bag: <strong>${pesoAceito.toFixed(2)} kg</strong> / ${C.PESO_BAG} kg` : ''}
    </div>
    ${aceitos.length ? `
    <div class="progress-label"><span>⚖️ Peso na Bag</span><span>${pesoAceito.toFixed(2)} / ${C.PESO_BAG} kg</span></div>
    <div class="progress-bar"><div class="progress-fill fill-peso" style="width:${Math.min(100, pesoAceito/C.PESO_BAG*100)}%"></div></div>
    <div class="progress-label"><span>🛣️ Distancia da Rota</span><span>${dist.toFixed(2)} / ${C.MAX_KM} km</span></div>
    <div class="progress-bar"><div class="progress-fill fill-vol" style="width:${Math.min(100, dist/C.MAX_KM*100)}%"></div></div>
    ` : ''}
    <div style="font-size:11px;color:var(--texto-muted);margin:10px 0 6px;text-transform:uppercase;letter-spacing:1px;">${classLabels[classificacaoAtual]}</div>` +
    pedidosOrdenados.map(p => {
      const s = STATUS[p.status];
      const itensHTML = p.itens.map(it => `<span class="badge">${it.emoji} ${it.nome} ×${it.qtd}</span>`).join(' ');
      const eficiencia = p.pesoTotal > 0 ? (p.precoEntrega / p.pesoTotal).toFixed(2) : '0.00';

      // Alertas visuais
      const distAlerta = p.distKm > C.MAX_KM ? `<div class="alerta-inline">⚠️ Rota longa: ${p.distKm.toFixed(2)} km (limite: ${C.MAX_KM} km)</div>` : '';
      const pesoAlerta = p.pesoTotal > C.PESO_BAG ? `<div class="alerta-inline">⚠️ Peso alto: ${p.pesoTotal.toFixed(2)} kg</div>` : '';

      const acoes = p.status==='aguardando'
        ? (noLimite ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.4;cursor:not-allowed">🚫 LIMITE ATINGIDO</button>` : `<button class="btn btn-verde btn-sm" onclick="aceitarRota(${p.id})">✅ ACEITAR</button>`)
        : p.status==='aceito' ? `<button class="btn btn-azul btn-sm" onclick="verRotaMapa(${p.id})">🗺️ VER NO MAPA</button><button class="btn btn-verde btn-sm" onclick="confirmarEntrega(${p.id})">📦 CONFIRMAR ENTREGA</button>` : '';
      return `
        <div class="rota-card ${s.cls}">
          ${distAlerta}${pesoAlerta}
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;color:var(--amarelo);margin-bottom:6px">Pedido #${p.id.toString().slice(-4)}</div>
              <div style="font-size:13px;margin-bottom:3px"><strong>🍽️</strong> ${p.origem.nome}</div>
              <div style="font-size:13px;margin-bottom:3px"><strong>📍</strong> ${p.destino.nome}</div>
              <div style="font-size:13px;margin-top:6px">🛣️ <strong>${p.distKm.toFixed(2)} km</strong> · ⏱️ <strong>${p.tempoMin} min</strong></div>
              <div style="font-size:14px;color:var(--verde);font-weight:700;margin-top:4px">💰 Voce recebe: R$ ${p.precoEntrega.toFixed(2)}</div>
              <div style="font-size:12px;color:var(--texto-muted);margin-top:4px">⚖️ ${p.pesoTotal.toFixed(2)} kg · 📦 ${p.volumeTotal.toFixed(2)} L · ⚡ R$ ${eficiencia}/kg</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
              <span class="status-badge ${s.badge}">${s.ico} ${s.txtM}</span>${acoes}
            </div>
          </div>
          <div style="border-top:1px solid var(--cinza-claro);padding-top:10px">
            <div style="font-size:11px;color:var(--texto-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Itens</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${itensHTML}</div>
          </div>
        </div>`;
    }).join('');
}

// ── TSP-MTZ ILP ───────────────────────────────────────────
function tspMTZ(paradas) {
  if (!window.LPSolver || paradas.length <= 2) return paradas;
  const n = paradas.length, vars = {}, constraints = {}, ints = {};

  for (let i=0; i<n; i++) for (let j=0; j<n; j++) {
    if (i===j) continue;
    vars[`x${i}_${j}`] = { d: distTurf(paradas[i], paradas[j]) };
    ints[`x${i}_${j}`] = 1;
  }
  for (let i=1; i<n; i++) {
    vars[`u${i}`] = { d:0, [`umin${i}`]:1, [`umax${i}`]:1 };
    constraints[`umin${i}`] = { min:1 };
    constraints[`umax${i}`] = { max: n-1 };
  }

  for (let i=0; i<n; i++) {
    constraints[`out${i}`] = { equal:1 };
    constraints[`in${i}`]  = { equal:1 };
    for (let j=0; j<n; j++) {
      if (i===j) continue;
      vars[`x${i}_${j}`][`out${i}`] = 1;
      vars[`x${i}_${j}`][`in${j}`]  = 1;
    }
  }

  for (let i=1; i<n; i++) for (let j=1; j<n; j++) {
    if (i===j) continue;
    constraints[`mtz${i}_${j}`] = { max: n-1 };
    vars[`u${i}`][`mtz${i}_${j}`]     = 1;
    vars[`u${j}`][`mtz${i}_${j}`]     = -1;
    vars[`x${i}_${j}`][`mtz${i}_${j}`] = n;
  }

  [...new Set(paradas.map(p=>p.pedidoId))].forEach(pid => {
    const pi = paradas.findIndex(p=>p.pedidoId===pid && p.tipo==='pickup');
    const di = paradas.findIndex(p=>p.pedidoId===pid && p.tipo==='dropoff');
    if (pi<1 || di<1) return;
    constraints[`prec${pid}`] = { max:-1 };
    vars[`u${pi}`][`prec${pid}`]  = 1;
    vars[`u${di}`][`prec${pid}`]  = -1;
  });

  const res = window.LPSolver.Solve({ optimize:'d', opType:'min', constraints, variables:vars, ints });
  if (!res.feasible) return paradas;

  const next = {};
  for (let i=0; i<n; i++) for (let j=0; j<n; j++) {
    if (i!==j && Math.round(res[`x${i}_${j}`]||0)===1) next[i]=j;
  }
  const ordem = [0];
  for (let k=1; k<n; k++) { const nx=next[ordem.at(-1)]; if(nx==null)break; ordem.push(nx); }
  return ordem.map(i=>paradas[i]);
}

async function calcularRotaCombinada(pedidosAceitos) {
  const pickups  = pedidosAceitos.map(p=>({ tipo:'pickup',  pedidoId:p.id, lat:p.origem.lat,  lng:p.origem.lng,  nome:p.origem.nome  }));
  const dropoffs = pedidosAceitos.map(p=>({ tipo:'dropoff', pedidoId:p.id, lat:p.destino.lat, lng:p.destino.lng, nome:p.destino.nome }));
  const paradas  = tspMTZ([...pickups, ...dropoffs]);
  const { distKm, coords, instrucoes } = await ghRoute(paradas);

  const segs = []; let cur = [], idx = 0;
  for (const step of instrucoes) {
    cur.push(step);
    if (step.sign===5 && idx < paradas.length-1) { segs.push({ pedidoId:paradas[idx].pedidoId, tipo:paradas[idx].tipo, steps:cur }); cur=[]; idx++; }
  }
  if (cur.length) segs.push({ pedidoId:paradas[idx]?.pedidoId, tipo:paradas[idx]?.tipo, steps:cur });

  return { ids:pedidosAceitos.map(p=>p.id), paradas, coords, distKm, tempoMin:tempo(distKm), instrucoes:segs };
}

// ── ACOES MOTOBOY ─────────────────────────────────────────
async function aceitarRota(id) {
  const p = pedidos.find(x=>x.id===id);
  if (!p || p.status!=='aguardando') return;
  const aceitos = pedidos.filter(x=>x.status==='aceito');
  if (aceitos.length >= C.MAX_PED) { toast(`Limite de ${C.MAX_PED} pedidos atingido`, 'erro'); return; }

  // Verificar peso na bag
  const pesoAtual = aceitos.reduce((s, x) => s + x.pesoTotal, 0);
  if (pesoAtual + p.pesoTotal > C.PESO_BAG) {
    toast(`Peso excederia a bag! Atual: ${pesoAtual.toFixed(1)}kg + ${p.pesoTotal.toFixed(1)}kg > ${C.PESO_BAG}kg`, 'erro');
    return;
  }

  toast('Calculando rota otima...', 'info');
  try {
    const sim = await calcularRotaCombinada([...aceitos, p]);

    // Alerta se rota > 20km (mas permite aceitar)
    if (sim.distKm > C.MAX_KM) {
      mostrarAlertaRota(sim.distKm);
      toast(`⚠️ Rota tem ${sim.distKm.toFixed(2)} km (acima de ${C.MAX_KM} km)!`, 'alerta');
    }

    p.status = 'aceito'; rotaCache = sim; pedidoSelecionadoId = id;
    await atualizarPedidoServidor(id, { status: 'aceito' });
    renderPedidosPublicados(); renderRotasMotoboy(); desenharRota(); salvarEstado();
    toast(`#${id.toString().slice(-4)} aceito! ${sim.distKm.toFixed(2)} km · ${sim.tempoMin} min`);
  } catch (e) { toast('Erro: ' + e.message, 'erro'); }
}

async function verRotaMapa(id) {
  pedidoSelecionadoId = id;
  const lista = pedidos.filter(p=>p.status==='aceito');
  if (!lista.length) return;
  try {
    rotaCache = await calcularRotaCombinada(lista);
    desenharRota();
    // Trocar para aba de mapa
    const btn = document.querySelectorAll('#page-motoboy .sub-tab')[1];
    if (btn) mudarSubAba('moto', 'mapa', btn);
  }
  catch { toast('Erro ao recalcular rota', 'erro'); }
}

async function confirmarEntrega(id) {
  const p = pedidos.find(x=>x.id===id);
  if (!p || p.status!=='aceito' || !confirm(`Confirmar entrega do pedido #${id.toString().slice(-4)}?`)) return;
  p.status = 'entregue';
  p.entregueEm = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  await atualizarPedidoServidor(id, { status: 'entregue', entregueEm: p.entregueEm });
  metricas.moto.ganhos += p.precoEntrega; metricas.moto.km += p.distKm; metricas.moto.entregas++;
  metricas.rest.lucro  += p.lucroTotal;   metricas.rest.vendas += p.vendaTotal;
  metricas.rest.pedidos++; metricas.rest.custoEntregas += p.precoEntrega;
  atualizarDashboards();
  await _recalcularOuLimpar();
  renderPedidosPublicados(); renderRotasMotoboy(); salvarEstado();
  toast(`Entrega confirmada! +R$ ${p.precoEntrega.toFixed(2)}`);
}

async function _recalcularOuLimpar() {
  const restantes = pedidos.filter(x=>x.status==='aceito');
  if (restantes.length) {
    try { rotaCache = await calcularRotaCombinada(restantes); desenharRota(); } catch {}
  } else {
    rotaCache = null; pedidoSelecionadoId = null;
    ['origem','destino','rota'].forEach(k=>rmLayer('moto',k));
    if (lyr.moto.paradas) { lyr.moto.paradas.forEach(m=>mapMoto.removeLayer(m)); lyr.moto.paradas=[]; }
    infoEntrega('moto', null); atualizarParadasMotoboy();
  }
}

// ── DESENHAR ROTA ─────────────────────────────────────────
function desenharRota() {
  if (!mapMoto) return;
  ['origem','destino','rota'].forEach(k=>rmLayer('moto',k));
  lyr.moto.paradas.forEach(m=>mapMoto.removeLayer(m)); lyr.moto.paradas=[];
  if (!rotaCache) return;
  rotaCache.paradas.forEach((stop, idx) => {
    const emoji = stop.tipo==='pickup' ? '🍽️' : '📍';
    const label = stop.tipo==='pickup' ? 'Retirar' : 'Entregar';
    const n = idx+1;
    const html = `<div style="position:relative"><div style="font-size:30px;line-height:1">${emoji}</div><div style="position:absolute;top:-4px;right:-8px;background:#e8321a;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif">${n}</div></div>`;
    const m = L.marker([stop.lat,stop.lng], { icon:L.divIcon({html,iconSize:[34,34],iconAnchor:[17,30],className:''}) })
      .bindPopup(`<strong>${n}. ${label}</strong><br>${stop.nome}<br><span style="color:#777;font-size:11px">Pedido #${stop.pedidoId.toString().slice(-4)}</span>`)
      .addTo(mapMoto);
    lyr.moto.paradas.push(m);
  });
  lyr.moto.rota = L.polyline(rotaCache.coords, { color:'#ff6b00', weight:4, opacity:0.85 }).addTo(mapMoto);
  mapMoto.fitBounds(lyr.moto.rota.getBounds(), { padding:[40,40] });
  infoEntrega('moto', rotaCache.distKm); atualizarParadasMotoboy(); renderInstrucoes();
}

function atualizarParadasMotoboy() {
  const el = document.getElementById('pontosMapa-moto');
  if (!el) return;
  if (!rotaCache) { el.innerHTML = '<div style="font-size:12px;color:var(--texto-muted)">Aceite uma rota para ver os pontos.</div>'; return; }
  el.innerHTML = rotaCache.paradas.map((stop, idx) => `
    <div class="ponto-item">
      <div class="ponto-num ${stop.tipo==='pickup'?'ponto-R':'ponto-D'}">${idx+1}</div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <span style="font-size:12px"><strong>${stop.tipo==='pickup'?'Retirar':'Entregar'}</strong> · #${stop.pedidoId.toString().slice(-4)}</span>
        <span style="font-size:11px;color:var(--texto-muted)">${stop.tipo==='pickup'?'🍽️':'📍'} ${stop.nome}</span>
      </div>
    </div>`).join('');
}

// ── DASHBOARDS ────────────────────────────────────────────
function atualizarDashboards() {
  const m = metricas, media = m.moto.entregas ? m.moto.ganhos/m.moto.entregas : 0;

  // Dashboard motoboy
  const dmG = document.getElementById('dmGanhos');
  const dmK = document.getElementById('dmKm');
  const dmE = document.getElementById('dmEntregas');
  const dmM = document.getElementById('dmMedia');
  if (dmG) dmG.textContent = fmt(m.moto.ganhos);
  if (dmK) dmK.textContent = `${m.moto.km.toFixed(1)} km`;
  if (dmE) dmE.textContent = m.moto.entregas;
  if (dmM) dmM.textContent = fmt(media);

  const dmHist = document.getElementById('dmHistorico');
  if (dmHist) {
    const entregues = pedidos.filter(p=>p.status==='entregue');
    dmHist.innerHTML = entregues.length ? `
      <div style="font-size:11px;color:var(--texto-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Historico de entregas</div>
      ${entregues.map(p=>`
        <div class="item-row">
          <div class="item-row-left">
            <span style="font-family:'Bebas Neue',sans-serif;font-size:14px;color:var(--amarelo)">#${p.id.toString().slice(-4)}</span>
            <div style="font-size:12px"><div>${p.origem.nome.slice(0,30)}${p.origem.nome.length>30?'…':''}</div>
            <div style="color:var(--texto-muted)">${p.entregueEm||''} · ${p.distKm.toFixed(2)} km</div></div>
          </div>
          <div class="item-row-right"><span class="lucro-chip">+${fmt(p.precoEntrega)}</span></div>
        </div>`).join('')}` : '';
  }

  // Dashboard restaurante
  const drL = document.getElementById('drLucro');
  const drV = document.getElementById('drVendas');
  const drP = document.getElementById('drPedidos');
  const drC = document.getElementById('drCustoEntregas');
  if (drL) drL.textContent = fmt(m.rest.lucro);
  if (drV) drV.textContent = fmt(m.rest.vendas);
  if (drP) drP.textContent = m.rest.pedidos;
  if (drC) drC.textContent = fmt(m.rest.custoEntregas);
}

// ── INSTRUCOES ────────────────────────────────────────────
function toggleInstrucoes() {
  instrucoesFechado = !instrucoesFechado;
  const body = document.getElementById('instrucoes-body');
  const icon = document.getElementById('instrucoes-icon');
  if (body) body.classList.toggle('fechado', instrucoesFechado);
  if (icon) icon.classList.toggle('fechado', instrucoesFechado);
}

function renderInstrucoes() {
  const body = document.getElementById('instrucoes-body');
  const resumo = document.getElementById('instrucoes-resumo');
  if (!body || !resumo) return;
  if (!rotaCache?.instrucoes?.length) {
    body.innerHTML = '<div class="empty" style="padding:28px"><div class="empty-icon">🗺️</div>Aceite e visualize uma rota para ver as instrucoes aqui.</div>';
    resumo.textContent = 'Aceite uma rota para ver as instrucoes'; return;
  }
  const totalSteps = rotaCache.instrucoes.reduce((s,seg)=>s+seg.steps.length,0);
  resumo.textContent = `${totalSteps} passos · ${rotaCache.distKm.toFixed(2)} km · ${rotaCache.tempoMin} min`;
  const paradas = rotaCache.paradas; let pidx = 0;
  const html = rotaCache.instrucoes.flatMap(seg => {
    const dest = seg.tipo==='trecho' ? paradas.at(-1) : paradas.find(p=>p.pedidoId===seg.pedidoId&&p.tipo===seg.tipo);
    const header = (dest||seg.tipo==='trecho') ? (() => {
      const pd = dest||paradas[pidx]||{};
      const ico = pd.tipo==='pickup'?'🍽️ Retirar':pd.tipo==='dropoff'?'📍 Entregar':'🏁 Fim';
      pidx++;
      return `<div class="step-parada-label">${ico} — Pedido #${(pd.pedidoId||0).toString().slice(-4)}<span style="font-size:11px;color:var(--texto-muted);font-family:'DM Sans',sans-serif;font-weight:400">${pd.nome||''}</span></div>`;
    })() : '';
    const steps = seg.steps.map(step => {
      const rua = step.rua||(step.texto.match(/(?:pela|na|ate a?|por)\s+(.+)/i)?.[1]||'');
      return `<div class="instrucao-step"><span class="step-icon-turn">${iconeTurn(step.sign)}</span><div class="step-text">${rua?`<div class="step-street">${rua}</div>`:''}<div class="step-detail">${step.texto.replace(/\s*\[.*?\]/g,'').trim()}</div>${step.distancia>5?`<div class="step-dist">📏 ${fmtDist(step.distancia)}</div>`:''}</div></div>`;
    });
    return [header, ...steps];
  });
  body.innerHTML = html.join('');
}

// ── INIT ──────────────────────────────────────────────────
renderCardapio(); renderSelector(); renderPedidosPublicados(); renderRotasMotoboy();
atualizarDashboards();
