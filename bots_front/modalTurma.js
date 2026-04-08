const API_BASE = '/api/turmas';

async function getAllTurmas() {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error('Falha ao carregar turmas');
  return res.json();
}

async function getTurmaById(id) {
  const res = await fetch(`${API_BASE}/${id}`);
  if (!res.ok) throw new Error('Falha ao carregar a turma');
  return res.json();
}

async function saveTurma(turma) {
  const payload = {
    nome: turma.nome,
    alunos: JSON.stringify(turma.alunos || [])
  };

  const res = turma.id
    ? await fetch(`${API_BASE}/${turma.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    : await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

  if (!res.ok) {
    throw new Error('Falha ao salvar a turma');
  }
  return res.json();
}

async function deleteTurma(id) {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Falha ao excluir a turma');
  }
  return res.json();
}

function normalizeAlunosValue(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return (item.nome || item.name || '').trim();
        return '';
      }).filter(Boolean);
    }
  } catch (error) {
    // Não é JSON, trata como texto simples
  }

  return value
    .split(/[,\r?\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function renderAlunoLines(alunos) {
  if (!alunos) return '';
  if (typeof alunos === 'string') {
    try {
      const parsed = JSON.parse(alunos);
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => (typeof item === 'string' ? item : (item.nome || item.name || '')))
          .filter(Boolean)
          .join(', ');
      }
    } catch (_error) {
      return alunos;
    }
  }

  if (Array.isArray(alunos)) {
    return alunos.join(', ');
  }

  return String(alunos);
}

function createModal(onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  overlay.innerHTML = `
    <div class="w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
      <div class="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50">
        <div>
          <h2 class="text-xl font-bold">Gerenciar Turmas</h2>
          <p class="text-sm text-slate-600">Crie, edite ou exclua turmas e mantenha as opções atualizadas.</p>
        </div>
        <button id="closeButton" class="text-slate-500 hover:text-slate-800">Fechar</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
        <div class="space-y-3">
          <h3 class="text-base font-semibold">Turmas cadastradas</h3>
          <div id="turmaList" class="space-y-2 max-h-96 overflow-y-auto border rounded p-3 bg-slate-50"></div>
        </div>
        <div class="space-y-3">
          <h3 class="text-base font-semibold">Detalhes da turma</h3>
          <label class="block text-sm font-medium text-slate-700">Nome da turma</label>
          <input id="turmaNome" type="text" class="w-full p-2 border rounded" placeholder="Ex: 2° Info" />
          <label class="block text-sm font-medium text-slate-700">Alunos (separados por vírgula)</label>
          <textarea id="turmaAlunos" rows="4" class="w-full p-2 border rounded" placeholder="João da Silva, Henrique Prado, Isadora Santos"></textarea>
          <div class="flex flex-wrap gap-2 justify-between">
            <button id="resetButton" class="bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium py-2 px-4 rounded">Nova Turma</button>
            <div class="flex gap-2">
              <button id="cancelButton" class="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded">Cancelar</button>
              <button id="saveButton" class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded">Salvar Turma</button>
            </div>
          </div>
          <p id="turmaStatus" class="text-sm text-slate-600"></p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  return overlay;
}

export async function openTurmaModal(onSaved = null) {
  const overlay = createModal(onSaved);
  const listContainer = overlay.querySelector('#turmaList');
  const inputNome = overlay.querySelector('#turmaNome');
  const inputAlunos = overlay.querySelector('#turmaAlunos');
  const saveButton = overlay.querySelector('#saveButton');
  const cancelButton = overlay.querySelector('#cancelButton');
  const closeButton = overlay.querySelector('#closeButton');
  const resetButton = overlay.querySelector('#resetButton');
  const statusText = overlay.querySelector('#turmaStatus');

  let currentTurmaId = null;

  function setStatus(message, isError = false) {
    statusText.textContent = message;
    statusText.className = isError ? 'text-sm text-red-600' : 'text-sm text-slate-600';
  }

  function resetForm() {
    currentTurmaId = null;
    inputNome.value = '';
    inputAlunos.value = '';
    saveButton.textContent = 'Salvar Turma';
    setStatus('Preencha os dados para criar ou editar uma turma.');
  }

  function closeModal() {
    overlay.remove();
  }

  function renderTurmaList(turmas) {
    listContainer.innerHTML = '';
    if (!turmas.length) {
      listContainer.innerHTML = '<p class="text-sm text-slate-500">Nenhuma turma cadastrada ainda.</p>';
      return;
    }

    turmas.forEach(turma => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 p-2 border rounded bg-white';
      row.innerHTML = `
        <div>
          <strong class="block text-sm">${turma.nome}</strong>
          <span class="text-xs text-slate-500">${normalizeAlunosValue(turma.alunos).length} aluno(s)</span>
        </div>
        <div class="flex gap-2">
          <button class="edit-btn bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium py-1 px-3 rounded">Editar</button>
          <button class="delete-btn bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium py-1 px-3 rounded">Excluir</button>
        </div>
      `;

      row.querySelector('.edit-btn').addEventListener('click', () => {
        currentTurmaId = turma.id;
        inputNome.value = turma.nome;
        inputAlunos.value = renderAlunoLines(turma.alunos);
        saveButton.textContent = 'Atualizar Turma';
        setStatus(`Editando: ${turma.nome}`);
      });

      row.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm(`Excluir a turma “${turma.nome}”?`)) return;
        try {
          await deleteTurma(turma.id);
          setStatus(`Turma ${turma.nome} excluída com sucesso.`);
          await loadTurmas();
          if (onSaved) onSaved();
        } catch (error) {
          setStatus(error.message, true);
        }
      });

      listContainer.appendChild(row);
    });
  }

  async function loadTurmas() {
    const turmas = await getAllTurmas();
    renderTurmaList(turmas);
  }

  saveButton.addEventListener('click', async () => {
    const nome = inputNome.value.trim();
    const alunos = normalizeAlunosValue(inputAlunos.value);

    if (!nome) {
      setStatus('O nome da turma é obrigatório.', true);
      return;
    }

    try {
      await saveTurma({ id: currentTurmaId, nome, alunos });
      setStatus(currentTurmaId ? 'Turma atualizada com sucesso.' : 'Turma criada com sucesso.');
      resetForm();
      await loadTurmas();
      if (onSaved) onSaved();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  cancelButton.addEventListener('click', closeModal);
  closeButton.addEventListener('click', closeModal);
  resetButton.addEventListener('click', resetForm);

  await loadTurmas();
  resetForm();
}

export { getAllTurmas, getTurmaById };