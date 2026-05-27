from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from functools import wraps
import numpy as np
from scipy.spatial.distance import cdist
from scipy.optimize import linprog
import sympy as sp
from pulp import (
    LpProblem, LpVariable, LpMaximize, LpMinimize,
    lpSum, LpBinary, LpInteger, LpStatus, value, PULP_CBC_CMD
)

app = Flask(__name__)
app.secret_key = 'motorota-secret-key-2024'

# Usuários padrão (sem banco de dados)
USERS = {
    'restaurante': {'senha': 'rest123', 'tipo': 'restaurante', 'nome': 'Restaurante Demo'},
    'motoboy':     {'senha': 'moto123', 'tipo': 'motoboy',     'nome': 'Motoboy Demo'},
}

# Pedidos compartilhados em memória (visíveis para todos os usuários)
pedidos_compartilhados = []

# ── CONSTANTES ──────────────────────────────────────────────
C_VOL_BAG  = 84.7
C_PESO_BAG = 30.0
C_VEL      = 35.0    # km/h
C_TAXA_BASE = 5.0
C_TAXA_KM   = 2.0
C_MAX_PED   = 3
C_MAX_KM    = 20.0

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def api_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'erro': 'Não autenticado'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['GET', 'POST'])
def login():
    erro = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        senha = request.form.get('senha', '').strip()
        user = USERS.get(username)
        if user and user['senha'] == senha:
            session['user'] = username
            session['tipo'] = user['tipo']
            session['nome'] = user['nome']
            return redirect(url_for('index'))
        erro = 'Usuário ou senha inválidos'
    return render_template('login.html', erro=erro)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html',
                           user=session['user'],
                           tipo=session['tipo'],
                           nome=session['nome'])

# ── API DE PEDIDOS ───────────────────────────────────────────

@app.route('/api/pedidos', methods=['GET'])
@api_login_required
def listar_pedidos():
    return jsonify(pedidos_compartilhados)

@app.route('/api/pedidos', methods=['POST'])
@api_login_required
def criar_pedidos():
    dados = request.get_json()
    if not dados:
        return jsonify({'erro': 'Dados inválidos'}), 400
    novos = dados if isinstance(dados, list) else [dados]
    pedidos_compartilhados.extend(novos)
    return jsonify({'ok': True, 'total': len(pedidos_compartilhados)})

@app.route('/api/pedidos/<int:pedido_id>', methods=['PATCH'])
@api_login_required
def atualizar_pedido(pedido_id):
    dados = request.get_json()
    if not dados:
        return jsonify({'erro': 'Dados inválidos'}), 400
    for p in pedidos_compartilhados:
        if p.get('id') == pedido_id:
            p.update(dados)
            return jsonify({'ok': True, 'pedido': p})
    return jsonify({'erro': 'Pedido não encontrado'}), 404


# ── /api/calcular/preco — SymPy avalia a fórmula simbólica ──
@app.route('/api/calcular/preco', methods=['POST'])
@api_login_required
def calcular_preco():
    """
    Recebe: { "km": float }
    Retorna: { "preco": float, "formula": str, "tempo_min": int }
    Usa SymPy para avaliar a fórmula taxa_base + km * taxa_km simbolicamente.
    """
    dados = request.get_json()
    km_val = float(dados.get('km', 0))

    km = sp.Symbol('km', positive=True)
    taxa_base = sp.Rational(int(C_TAXA_BASE * 100), 100)
    taxa_km   = sp.Rational(int(C_TAXA_KM   * 100), 100)

    formula_expr = taxa_base + taxa_km * km
    preco_val    = float(formula_expr.subs(km, km_val))
    tempo_min    = int(round(km_val / C_VEL * 60))

    return jsonify({
        'preco':     round(preco_val, 2),
        'formula':   str(formula_expr),
        'tempo_min': tempo_min
    })


# ── /api/calcular/resumo-pedido — NumPy agrega itens ────────
@app.route('/api/calcular/resumo-pedido', methods=['POST'])
@api_login_required
def calcular_resumo_pedido():
    """
    Recebe: { "itens": [{ "peso": f, "volume": f, "preco": f, "lucro": f, "qtd": i }] }
    Retorna: totais calculados com NumPy + alertas de capacidade.
    """
    dados = request.get_json()
    itens = dados.get('itens', [])
    if not itens:
        return jsonify({'erro': 'Nenhum item'}), 400

    qtds    = np.array([i['qtd']    for i in itens], dtype=float)
    pesos   = np.array([i['peso']   for i in itens], dtype=float)
    volumes = np.array([i['volume'] for i in itens], dtype=float)
    precos  = np.array([i['preco']  for i in itens], dtype=float)
    lucros  = np.array([i['lucro']  for i in itens], dtype=float)

    peso_total   = float(np.dot(qtds, pesos))
    volume_total = float(np.dot(qtds, volumes))
    venda_total  = float(np.dot(qtds, precos))
    lucro_total  = float(np.dot(qtds, lucros))
    total_itens  = int(np.sum(qtds))

    pct_vol  = round(volume_total / C_VOL_BAG  * 100, 1)
    pct_peso = round(peso_total   / C_PESO_BAG * 100, 1)

    n_divisoes = int(np.ceil(max(
        volume_total / C_VOL_BAG,
        peso_total   / C_PESO_BAG
    ))) if (volume_total > C_VOL_BAG or peso_total > C_PESO_BAG) else 1

    return jsonify({
        'total_itens':  total_itens,
        'peso_total':   round(peso_total,   2),
        'volume_total': round(volume_total, 2),
        'venda_total':  round(venda_total,  2),
        'lucro_total':  round(lucro_total,  2),
        'pct_vol':      pct_vol,
        'pct_peso':     pct_peso,
        'excede_bag':   bool(volume_total > C_VOL_BAG or peso_total > C_PESO_BAG),
        'n_divisoes':   n_divisoes
    })


# ── /api/calcular/otimizar-bag — PuLP knapsack ILP ──────────
@app.route('/api/calcular/otimizar-bag', methods=['POST'])
@api_login_required
def otimizar_bag():
    """
    Recebe: { "cardapio": [{ "id": int, "nome": str, "peso": f,
                              "volume": f, "preco": f, "lucro": f }],
              "qtd_max": int  (opcional, default 10) }
    Retorna: lista de itens otimizados { id, nome, qtd }
    Usa PuLP (CBC) para maximizar lucro respeitando volume e peso da bag.
    """
    dados    = request.get_json()
    cardapio = dados.get('cardapio', [])
    qtd_max  = int(dados.get('qtd_max', 10))

    if not cardapio:
        return jsonify({'erro': 'Cardápio vazio'}), 400

    prob = LpProblem('KnapsackBag', LpMaximize)
    variaveis = {
        it['id']: LpVariable(f"x_{it['id']}", lowBound=0, upBound=qtd_max, cat=LpInteger)
        for it in cardapio
    }

    # Objetivo: maximizar lucro
    prob += lpSum(it['lucro'] * variaveis[it['id']] for it in cardapio)

    # Restrições de capacidade
    prob += lpSum(it['volume'] * variaveis[it['id']] for it in cardapio) <= C_VOL_BAG,  'volume'
    prob += lpSum(it['peso']   * variaveis[it['id']] for it in cardapio) <= C_PESO_BAG, 'peso'

    prob.solve(PULP_CBC_CMD(msg=0))

    if LpStatus[prob.status] != 'Optimal':
        return jsonify({'erro': 'Sem solução viável'}), 422

    resultado = []
    for it in cardapio:
        q = int(round(value(variaveis[it['id']]) or 0))
        if q > 0:
            resultado.append({'id': it['id'], 'nome': it['nome'], 'qtd': q})

    return jsonify({'itens': resultado, 'status': LpStatus[prob.status]})


# ── /api/calcular/tsp — SciPy distâncias + nearest-neighbor ─
@app.route('/api/calcular/tsp', methods=['POST'])
@api_login_required
def calcular_tsp():
    """
    Recebe: { "paradas": [{ "lat": f, "lng": f, "pedidoId": int,
                             "tipo": "pickup"|"dropoff", "nome": str }] }
    Retorna: paradas reordenadas pelo algoritmo nearest-neighbor com
             matriz de distâncias calculada por SciPy.
    O nó 0 (primeiro) é sempre fixo como ponto de partida.
    Precedência pickup→dropoff do mesmo pedido é respeitada.
    """
    dados   = request.get_json()
    paradas = dados.get('paradas', [])
    n = len(paradas)

    if n <= 2:
        return jsonify({'paradas': paradas})

    # Matriz de distâncias euclidiana (em graus, serve para ranking relativo)
    coords = np.array([[p['lat'], p['lng']] for p in paradas])
    dist_matrix = cdist(coords, coords, metric='euclidean')

    # Nearest-neighbor com ponto 0 fixo e restrição de precedência
    visitados = [False] * n
    ordem     = [0]
    visitados[0] = True

    # Mapa: pedidoId → índice do pickup
    pickup_idx = {
        p['pedidoId']: i
        for i, p in enumerate(paradas)
        if p.get('tipo') == 'pickup'
    }

    for _ in range(n - 1):
        atual = ordem[-1]
        melhor, melhor_dist = -1, float('inf')
        for j in range(n):
            if visitados[j]:
                continue
            # Se é dropoff, verifica se o pickup correspondente já foi visitado
            if paradas[j].get('tipo') == 'dropoff':
                pi = pickup_idx.get(paradas[j]['pedidoId'], -1)
                if pi != -1 and not visitados[pi]:
                    continue  # pickup ainda não visitado
            if dist_matrix[atual][j] < melhor_dist:
                melhor, melhor_dist = j, dist_matrix[atual][j]
        if melhor == -1:
            # Fallback: adiciona qualquer não visitado
            melhor = next(j for j in range(n) if not visitados[j])
        ordem.append(melhor)
        visitados[melhor] = True

    paradas_ordenadas = [paradas[i] for i in ordem]
    return jsonify({'paradas': paradas_ordenadas})


# ── /api/calcular/dividir-pedido — NumPy bin-packing ────────
@app.route('/api/calcular/dividir-pedido', methods=['POST'])
@api_login_required
def dividir_pedido():
    """
    Recebe: { "itens": [{ ...item, "qtd": int }],
              "dist_km": float }
    Retorna: lista de sub-pedidos já calculados com totais NumPy.
    """
    dados    = request.get_json()
    itens    = dados.get('itens', [])
    dist_km  = float(dados.get('dist_km', 0))

    if not itens:
        return jsonify({'erro': 'Nenhum item'}), 400

    tempo_min    = int(round(dist_km / C_VEL * 60))
    preco_entrega = round(C_TAXA_BASE + dist_km * C_TAXA_KM, 2)

    pedidos_div  = []
    restantes    = [dict(it) for it in itens]

    while restantes:
        grupo     = []
        peso_acum = 0.0
        vol_acum  = 0.0

        for i in range(len(restantes) - 1, -1, -1):
            it = restantes[i]
            qtd_cabe = 0
            for q in range(1, it['qtd'] + 1):
                np_val = peso_acum + it['peso'] * q
                nv_val = vol_acum  + it['volume'] * q
                if np_val <= C_PESO_BAG and nv_val <= C_VOL_BAG:
                    qtd_cabe = q
                else:
                    break
            if qtd_cabe > 0:
                grupo.append({**it, 'qtd': qtd_cabe})
                peso_acum += it['peso'] * qtd_cabe
                vol_acum  += it['volume'] * qtd_cabe
                if qtd_cabe >= it['qtd']:
                    restantes.pop(i)
                else:
                    restantes[i]['qtd'] -= qtd_cabe

        if not grupo and restantes:
            it = restantes.pop(0)
            grupo.append({**it, 'qtd': 1})
            if it['qtd'] > 1:
                restantes.insert(0, {**it, 'qtd': it['qtd'] - 1})

        if grupo:
            qtds_g    = np.array([g['qtd']    for g in grupo], dtype=float)
            pesos_g   = np.array([g['peso']   for g in grupo], dtype=float)
            volumes_g = np.array([g['volume'] for g in grupo], dtype=float)
            precos_g  = np.array([g['preco']  for g in grupo], dtype=float)
            lucros_g  = np.array([g['lucro']  for g in grupo], dtype=float)

            pedidos_div.append({
                'itens':        grupo,
                'pesoTotal':    round(float(np.dot(qtds_g, pesos_g)),   2),
                'volumeTotal':  round(float(np.dot(qtds_g, volumes_g)), 2),
                'vendaTotal':   round(float(np.dot(qtds_g, precos_g)),  2),
                'lucroTotal':   round(float(np.dot(qtds_g, lucros_g)),  2),
                'distKm':       dist_km,
                'tempoMin':     tempo_min,
                'precoEntrega': preco_entrega,
                'status':       'aguardando'
            })

    return jsonify({'pedidos': pedidos_div, 'total': len(pedidos_div)})


# ── /api/calcular/metricas — NumPy agrega métricas ──────────
@app.route('/api/calcular/metricas', methods=['POST'])
@api_login_required
def calcular_metricas():
    """
    Recebe: { "pedidos": [...lista completa de pedidos...] }
    Retorna: métricas calculadas com NumPy para restaurante e motoboy.
    Resolve o bug do dashboard: calcula sempre a partir dos pedidos reais.
    """
    dados   = request.get_json()
    pedidos = dados.get('pedidos', [])

    entregues = [p for p in pedidos if p.get('status') == 'entregue']

    if not entregues:
        return jsonify({
            'moto': {'ganhos': 0.0, 'km': 0.0, 'entregas': 0, 'media': 0.0},
            'rest': {'lucro': 0.0, 'vendas': 0.0, 'pedidos': 0, 'custoEntregas': 0.0,
                     'margemPct': 0.0},
            'historico': []
        })

    ganhos = np.array([p.get('precoEntrega', 0) for p in entregues], dtype=float)
    kms    = np.array([p.get('distKm',       0) for p in entregues], dtype=float)
    lucros = np.array([p.get('lucroTotal',   0) for p in entregues], dtype=float)
    vendas = np.array([p.get('vendaTotal',   0) for p in entregues], dtype=float)

    total_vendas        = float(np.sum(vendas))
    total_custo_entrega = float(np.sum(ganhos))
    total_lucro         = float(np.sum(lucros))
    margem_pct          = float((total_lucro / total_vendas * 100) if total_vendas > 0 else 0)

    historico = [
        {
            'id':           p.get('id'),
            'origemNome':   p.get('origem', {}).get('nome', ''),
            'entregueEm':   p.get('entregueEm', ''),
            'distKm':       p.get('distKm', 0),
            'precoEntrega': p.get('precoEntrega', 0),
            'lucroTotal':   p.get('lucroTotal', 0),
        }
        for p in entregues
    ]

    return jsonify({
        'moto': {
            'ganhos':   round(float(np.sum(ganhos)), 2),
            'km':       round(float(np.sum(kms)),    2),
            'entregas': len(entregues),
            'media':    round(float(np.mean(ganhos)), 2)
        },
        'rest': {
            'lucro':         round(total_lucro,         2),
            'vendas':        round(total_vendas,        2),
            'pedidos':       len(entregues),
            'custoEntregas': round(total_custo_entrega, 2),
            'margemPct':     round(margem_pct,          1)
        },
        'historico': historico
    })


if __name__ == '__main__':
    app.run(port=3000, host="0.0.0.0")