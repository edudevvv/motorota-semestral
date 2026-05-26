from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from functools import wraps

app = Flask(__name__)
app.secret_key = 'motorota-secret-key-2024'

# Usuários padrão (sem banco de dados)
USERS = {
    'restaurante': {'senha': 'rest123', 'tipo': 'restaurante', 'nome': 'Restaurante Demo'},
    'motoboy':     {'senha': 'moto123', 'tipo': 'motoboy',     'nome': 'Motoboy Demo'},
}

# Pedidos compartilhados em memória (visíveis para todos os usuários)
pedidos_compartilhados = []

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

# ── API DE PEDIDOS (compartilhados entre todos os usuários) ──

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

if __name__ == '__main__':
    app.run(port=3000, host="0.0.0.0")
