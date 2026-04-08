const API_BASE = '/api/ucs';

async function getAllUcs() {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error('Falha ao carregar UCs');
  return res.json();
}

async function getUcById(id) {
  const res = await fetch(`${API_BASE}/${id}`);
  if (!res.ok) throw new Error('Falha ao carregar a UC');
  return res.json();
}

async function saveUc(uc) {
  const payload = {
    nome: uc.nome,
    link_diario: uc.link_diario
  };

  const res = uc.id
    ? await fetch(`${API_BASE}/${uc.id}`, {
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
    throw new Error('Falha ao salvar a UC');
  }
  return res.json();
}

async function deleteUc(id) {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Falha ao excluir a UC');
  }
  return res.json();
}

function createModal() {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  overlay.innerHTML = `
    <div class="w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
      <div class="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50">
        <div>
          <h2 class="text-xl font-bold">Gerenciar UCs</h2>
          <p class="text-sm text-slate-600">Cadastre ou edite UCs e o link do diário para usar automaticamente.</p>
        </div>
        <button id="closeButton" class="text-slate-500 hover:text-slate-800">Fechar</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
        <div class="space-y-3">
          <h3 class="text-base font-semibold">UCs cadastradas</h3>
          <div id="ucList" class="space-y-2 max-h-96 overflow-y-auto border rounded p-3 bg-slate-50"></div>
        </div>
        <div class="space-y-3">
          <h3 class="text-base font-semibold">Detalhes da UC</h3>
          <label class="block text-sm font-medium text-slate-700">Nome da UC</label>
          <input id="ucNome" type="text" class="w-full p-2 border rounded" placeholder="Ex: Matemática" />
          <label class="block text-sm font-medium text-slate-700">Link do diário</label>
          <input id="ucLink" type="text" class="w-full p-2 border rounded" placeholder="https://..." />
          <div class="flex flex-wrap gap-2 justify-between">
            <button id="resetButton" class="bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium py-2 px-4 rounded">Nova UC</button>
            <div class="flex gap-2">
              <button id="cancelButton" class="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded">Cancelar</button>
              <button id="saveButton" class="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-4 rounded">Salvar UC</button>
            </div>
          </div>
          <p id="ucStatus" class="text-sm text-slate-600"></p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

export async function openUcModal(onSaved = null) {
  const overlay = createModal();
  const listContainer = overlay.querySelector('#ucList');
  const inputNome = overlay.querySelector('#ucNome');
  const inputLink = overlay.querySelector('#ucLink');
  const saveButton = overlay.querySelector('#saveButton');
  const cancelButton = overlay.querySelector('#cancelButton');
  const closeButton = overlay.querySelector('#closeButton');
  const resetButton = overlay.querySelector('#resetButton');
  const statusText = overlay.querySelector('#ucStatus');

  let currentUcId = null;

  function setStatus(message, isError = false) {
    statusText.textContent = message;
    statusText.className = isError ? 'text-sm text-red-600' : 'text-sm text-slate-600';
  }

  function resetForm() {
    currentUcId = null;
    inputNome.value = '';
    inputLink.value = '';
    saveButton.textContent = 'Salvar UC';
    setStatus('Preencha os dados para criar ou editar uma UC.');
  }

  function closeModal() {
    overlay.remove();
  }

  function renderUcList(ucs) {
    listContainer.innerHTML = '';
    if (!ucs.length) {
      listContainer.innerHTML = '<p class="text-sm text-slate-500">Nenhuma UC cadastrada ainda.</p>';
      return;
    }

    ucs.forEach(uc => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 p-2 border rounded bg-white';
      row.innerHTML = `
        <div>
          <strong class="block text-sm">${uc.nome}</strong>
          <a class="text-xs text-slate-500 break-all" href="${uc.link_diario || '#'}" target="_blank">${uc.link_diario || 'Sem link'}</a>
        </div>
        <div class="flex gap-2">
          <button class="edit-btn bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium py-1 px-3 rounded">Editar</button>
          <button class="delete-btn bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium py-1 px-3 rounded">Excluir</button>
        </div>
      `;

      row.querySelector('.edit-btn').addEventListener('click', () => {
        currentUcId = uc.id;
        inputNome.value = uc.nome;
        inputLink.value = uc.link_diario || '';
        saveButton.textContent = 'Atualizar UC';
        setStatus(`Editando: ${uc.nome}`);
      });

      row.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm(`Excluir a UC “${uc.nome}”?`)) return;
        try {
          await deleteUc(uc.id);
          setStatus(`UC ${uc.nome} excluída com sucesso.`);
          await loadUcs();
          if (onSaved) onSaved();
        } catch (error) {
          setStatus(error.message, true);
        }
      });

      listContainer.appendChild(row);
    });
  }

  async function loadUcs() {
    const ucs = await getAllUcs();
    renderUcList(ucs);
  }

  saveButton.addEventListener('click', async () => {
    const nome = inputNome.value.trim();
    const link_diario = inputLink.value.trim();

    if (!nome) {
      setStatus('O nome da UC é obrigatório.', true);
      return;
    }

    try {
      await saveUc({ id: currentUcId, nome, link_diario });
      setStatus(currentUcId ? 'UC atualizada com sucesso.' : 'UC criada com sucesso.');
      resetForm();
      await loadUcs();
      if (onSaved) onSaved();
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  cancelButton.addEventListener('click', closeModal);
  closeButton.addEventListener('click', closeModal);
  resetButton.addEventListener('click', resetForm);

  await loadUcs();
  resetForm();
}

export { getAllUcs, getUcById };
