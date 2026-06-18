import { realizarLogin } from "./login.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const CONFIG = {
    timeouts: {
        navigation: 60000,
        selector: 15000,
        action: 5000
    },
    delays: {
        step: 1200,
        stepFast: 1000,
        modal: 1000,
        typing: 30
    }
};

/**
 * Classe Orquestradora para a Automação de Recomposição de Aprendizagem (RA / PPE)
 * Versão "Inteligente": verifica o que já foi preenchido antes de agir.
 */
class RAAutomation {
    constructor(page, browser, diaryLink, raData, addLog) {
        this.page = page;
        this.browser = browser;
        this.diaryLink = diaryLink;
        this.addLog = addLog;

        this.capacidadesAlvo = typeof raData.capacidadesAlvo === 'string'
            ? JSON.parse(raData.capacidadesAlvo)
            : raData.capacidadesAlvo;

        this.dataInicio   = raData.dataInicio;
        this.dataTermino  = raData.dataTermino;
        this.justificativa = raData.justificativa;
        this.publicaOnline = raData.publicaOnline;
        this.nomeArquivoRA = raData.nomeArquivoRA;
        this.trSelection   = raData.trSelection;

        this.caminhoAnexo = path.join(process.cwd(), "uploads", "RA", this.nomeArquivoRA || "");
    }

    // ============================================================
    // PONTO DE ENTRADA
    // ============================================================
    async start() {
        this.addLog(`[RA] Iniciando processamento do diário: ${this.diaryLink}`);
        await this.irParaAbaConceitos();
        await this.selecionarTrimestre();
        await this.processarTabelaAlunos();
        this.addLog(`✅ [RA] Varredura concluída para o diário.`);
    }

    // ============================================================
    // UTILITÁRIOS
    // ============================================================

    /** Aguarda loaders PrimeFaces sumirem */
    async aguardarLoader() {
        await pSleep(500);
        try {
            await this.page.waitForFunction(() => {
                const loaders = document.querySelectorAll(
                    '.ajax-loader, .blockUI, .ui-blockui, .ui-loading-indicator, div[id="enviarStatusAguarde"]'
                );
                return Array.from(loaders).every(el =>
                    window.getComputedStyle(el).display === 'none' ||
                    window.getComputedStyle(el).visibility === 'hidden'
                );
            }, { timeout: 20000 });
        } catch (e) {
            this.addLog(`[RA] Aviso: timeout do loader ignorado.`);
        }
        await pSleep(CONFIG.delays.step);
    }

    /** Preenche um input de data com value + dispara onchange do PrimeFaces */
    async preencherData(id, valor) {
        const ok = await this.page.evaluate((inputId, val) => {
            const el = document.getElementById(inputId);
            if (!el) return false;
            if (el.value && el.value.trim() !== '') return 'ja_preenchido';
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // Dispara o onchange PrimeFaces (calendário)
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
        }, id, valor);

        if (ok === 'ja_preenchido') {
            this.addLog(`[RA] ℹ️ Campo "${id}" já possui valor, mantendo.`);
        } else if (!ok) {
            this.addLog(`⚠️ [RA] Campo "${id}" não encontrado.`);
        }
    }

    // ============================================================
    // NAVEGAÇÃO INICIAL
    // ============================================================

    async irParaAbaConceitos() {
        const seletorAba = 'li a[href*="abaConceitos"], a[href$="abaConceitos"], a[href*="tabViewDiarioClasse:abaConceitos"]';
        await this.page.waitForSelector(seletorAba, { timeout: CONFIG.timeouts.selector });

        const jaAtiva = await this.page.evaluate((sel) => {
            const aba = document.querySelector(sel);
            return aba ? aba.parentElement.classList.contains('ui-state-active') : false;
        }, seletorAba);

        if (!jaAtiva) {
            this.addLog(`[RA] Clicando na aba de conceitos...`);
            await this.page.click(seletorAba);
            await this.aguardarLoader();
        }
    }

    async selecionarTrimestre() {
        try {
            this.addLog(`[RA] Selecionando o ${this.trSelection}º Trimestre...`);
            const dropdownLabel = 'label[id*="mediasConceito_label"]';
            await this.page.waitForSelector(dropdownLabel, { timeout: 10000 });
            await this.page.click(dropdownLabel);
            await pSleep(800);

            const trIndex = parseInt(this.trSelection);
            const seletorOpcao = `li[id$="mediasConceito_${trIndex}"]`;
            await this.page.waitForSelector(seletorOpcao, { timeout: 5000 });
            await this.page.click(seletorOpcao);
            this.addLog(`[RA] Filtro TR${this.trSelection} aplicado. Aguardando tabela...`);
            await this.aguardarLoader();
        } catch (e) {
            this.addLog(`⚠️ [RA] Aviso ao selecionar trimestre: ${e.message}`);
        }
    }

    // ============================================================
    // VARREDURA DA TABELA DE ALUNOS
    // ============================================================

    async processarTabelaAlunos() {
        const seletorTabela = 'tbody[id*="tabelaConceitos"], tbody[id*="dataTableConceitos_data"]';
        this.addLog(`[RA] Aguardando lista de alunos...`);
        await this.page.waitForSelector(seletorTabela, { timeout: CONFIG.timeouts.selector });

        const totalLinhas = await this.page.evaluate((sel) => {
            const tbody = document.querySelector(sel);
            return tbody
                ? tbody.querySelectorAll('tr[role="row"], tr.ui-datatable-selectable, tr.ui-widget-content').length
                : 0;
        }, seletorTabela);

        this.addLog(`[RA] ${totalLinhas} aluno(s) encontrado(s).`);

        for (let i = 0; i < totalLinhas; i++) {
            try {
                const infoAluno = await this.page.evaluate((idx, selTabela) => {
                    const tbody = document.querySelector(selTabela);
                    if (!tbody) return null;

                    const rows = tbody.querySelectorAll('tr[role="row"], tr.ui-datatable-selectable, tr.ui-widget-content');
                    const row = rows[idx];
                    if (!row) return null;

                    const celulas = Array.from(row.querySelectorAll('td'));
                    let nome = celulas.length > 1 ? celulas[1].innerText.trim() : '';
                    if (!nome || nome.length < 3) {
                        const found = celulas.find(c => c.innerText.trim().length > 5);
                        if (found) nome = found.innerText.trim();
                    }

                    let conceitoFinal = '';
                    // Tenta via componentes de formulário
                    for (const el of row.querySelectorAll('label, select, span')) {
                        const v = (el.value || el.innerText || '').trim().toUpperCase();
                        if (['A', 'B', 'C', 'NE'].includes(v)) { conceitoFinal = v; break; }
                    }
                    // Fallback: percorre células de trás pra frente
                    if (!conceitoFinal) {
                        for (let c = celulas.length - 1; c >= 0; c--) {
                            const v = celulas[c].innerText.trim().toUpperCase();
                            if (['A', 'B', 'C', 'NE'].includes(v)) { conceitoFinal = v; break; }
                        }
                    }

                    return { nome: nome || `Aluno ${idx + 1}`, conceitoFinal };
                }, i, seletorTabela);

                if (!infoAluno) continue;

                if (infoAluno.conceitoFinal === 'C') {
                    this.addLog(`[RA] 🎯 Elegível: ${infoAluno.nome} (CF: "C")`);
                    await this.processarRAAluno(seletorTabela, i, infoAluno.nome);
                    await this.aguardarLoader();
                    await this.page.waitForSelector(seletorTabela, { timeout: 15000 }).catch(() => {});
                    await pSleep(CONFIG.delays.step * 1.0);
                } else {
                    const cf = infoAluno.conceitoFinal || 'Vazio';
                    this.addLog(`[RA] Ignorado: ${infoAluno.nome} (CF: "${cf}")`);
                }

            } catch (err) {
                this.addLog(`❌ [RA] Erro no aluno índice ${i}: ${err.message}`);
                throw err;
            }
        }
    }

    // ============================================================
    // PROCESSAMENTO INDIVIDUAL DO ALUNO
    // ============================================================

    async processarRAAluno(seletorTabela, index, nomeAluno) {
        this.addLog(`[RA] Abrindo ficha de ${nomeAluno}...`);

        const clicou = await this.page.evaluate((sel, idx) => {
            const tbody = document.querySelector(sel);
            if (!tbody) return false;
            const rows = tbody.querySelectorAll('tr[role="row"], tr.ui-datatable-selectable, tr.ui-widget-content');
            const row = rows[idx];
            if (!row) return false;
            const lapis = row.querySelector('a[id*="linkEditarAtitudes"]');
            if (lapis) {
                const titulo = lapis.getAttribute('title') || '';
                const estilo = lapis.getAttribute('style') || '';
                const estiloLower = estilo.toLowerCase();
                if (titulo.includes('(Preenchido)') || estiloLower.includes('#00b900') || estiloLower.includes('rgb(0, 185, 0)') || estiloLower.includes('rgb(0,185,0)')) {
                    return 'preenchido';
                }
                try {
                    lapis.scrollIntoView({ block: 'center' });
                } catch(e){}
                ((lapis.tagName === 'SPAN' || lapis.tagName === 'I') ? lapis.parentElement : lapis).click();
                return true;
            }

            // fallback generic button/icon
            const lapisAlt = row.querySelector('button[id*="Editar"], .fa-pencil, a[title*="Editar"], button[title*="Editar"], .ui-icon-pencil');
            if (lapisAlt) {
                try { lapisAlt.scrollIntoView({ block: 'center' }); } catch(e){}
                ((lapisAlt.tagName === 'SPAN' || lapisAlt.tagName === 'I') ? lapisAlt.parentElement : lapisAlt).click();
                return true;
            }
            return false;
        }, seletorTabela, index);

        if (clicou === 'preenchido') {
            this.addLog(`⏭️ [RA] Pulando ${nomeAluno} — lápis marcado como preenchido (verde).`);
            return;
        }

        if (!clicou) {
            this.addLog(`⚠️ [RA] Botão de edição não encontrado para ${nomeAluno}. Pulando...`);
            return;
        }

        this.addLog(`[RA] Aguardando carregamento da ficha...`);
        await this.aguardarLoader();
        await pSleep(CONFIG.delays.stepFast);

        // ETAPA 1 — Conceitos técnicos (só altera o que for necessário)
        await this.garantirAcordeaoAberto(
            'div[id*="accordionHabilidades_header"]:not([id*="Socioemocionais"])',
            "Conceitos Técnicos"
        );
        await this.preencherConceitosTecnicos();

        // ETAPA 2 — Importar socioemocionais
        await this.garantirAcordeaoAberto(
            'div[id*="accordionHabilidadesSocioemocionais_header"]',
            "Socioemocionais"
        );
        await this.importarSocioemocionais();

        // ETAPA 3 — Formulário de RA
        const raDisponivel = await this.garantirBotaoAdicionarRA();
        if (!raDisponivel) {
            this.addLog(`❌ [RA] Botão de Adicionar RA não está disponível. Verifique se as habilidades técnicas foram preenchidas corretamente antes de tentar adicionar RA.`);
            return;
        }
        await this.preencherFormularioRA();
    }

    async garantirBotaoAdicionarRA() {
        const selectors = [
            '#formAtitudes\\:panelAtitudes\\:btnAdicionarPPE',
            '#formAtitudes [id*="btnAdicionarPPE"]',
            '[id*="btnAdicionarPPE"]'
        ];

        for (const sel of selectors) {
            const found = await this.page.$(sel);
            if (found) {
                const visible = await this.page.evaluate(el => {
                    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
                }, found);
                if (visible) return true;
            }
        }

        const hasButtonByText = await this.page.evaluate(() => {
            const candidates = Array.from(document.querySelectorAll('button[id*="btnAdicionarPPE"], [id*="btnAdicionarPPE"], button, a, span'));
            return candidates.some(el => {
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                return txt.includes('adicionar ra') || txt.includes('adicionar ppe') || txt.includes('adicionar');
            });
        });

        if (hasButtonByText) return true;

        await this.capturarDebugHtml('Botão Adicionar RA não encontrado', selectors.concat(['button', 'a', 'span']));
        return false;
    }

    // ============================================================
    // ETAPA 1: CONCEITOS TÉCNICOS
    // ============================================================

    async preencherConceitosTecnicos() {
        this.addLog(`[RA] Verificando/preenchendo conceitos técnicos...`);
        const possiveisSeletores = [
            '#modalDadosAtitudes tbody tr',
            'tbody[id*="dataTableHabilidades_data"] tr',
            'tbody[id*="dataTableHabilidades"] tr',
            'div[id*="dataTableHabilidades"] tr',
            '#modalDadosAtitudes div.ui-datatable-data tr',
            'tbody tr'
        ];

        let linhasSeletor = null;
        for (const s of possiveisSeletores) {
            const found = await this.page.evaluate((sel) => !!document.querySelector(sel), s).catch(() => false);
            if (found) { linhasSeletor = s; break; }
        }

        if (!linhasSeletor) {
            this.addLog(`⚠️ [RA] Não localizei a tabela de habilidades (tentei vários seletores). Capturando debug.`);
            await this.capturarDebugHtml('Tabela de habilidades não encontrada', ['#modalDadosAtitudes', 'tbody[id*="dataTableHabilidades_data"]', 'div[id*="panelAtitudes"]']);
            return;
        }

        await this.page.waitForSelector(linhasSeletor, { timeout: 10000 }).catch(() => {});

        const capsJson = JSON.stringify(this.capacidadesAlvo);
        const initialScan = await this.page.evaluate((sel, capsJson) => {
            const caps = (() => { try { return JSON.parse(capsJson); } catch (e) { return capsJson; } })();
            const normalize = (text) => text ? text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() : '';
            const normalizedCaps = [];

            if (Array.isArray(caps)) {
                caps.forEach(c => normalizedCaps.push({ nome: String(c.nome || '').trim(), conceito: String(c.conceito || '').trim().toUpperCase() }));
            } else if (caps && typeof caps === 'object') {
                Object.keys(caps).forEach(k => normalizedCaps.push({ nome: String(k).trim(), conceito: String(caps[k]).trim().toUpperCase() }));
            }

            const isTechnicalRow = (text) => {
                if (!text) return false;
                const lower = text.toLowerCase();
                const ignorePatterns = ['selecione', 'evidenciado', 'em processo', 'não evidenciado', 'nao evidenciado', 'não há', 'nenhum registro', 'observa'];
                return !ignorePatterns.some(p => lower.includes(p));
            };

            const rows = Array.from(document.querySelectorAll(sel));
            const missingMapping = [];
            const needsFill = [];
            const alreadyFilled = [];

            rows.forEach(tr => {
                const spanTxt = tr.querySelector('span[id*="habilidadeTxt"]');
                let nomeHabilidade = spanTxt ? spanTxt.innerText.trim() : null;
                if (!nomeHabilidade) {
                    const tds = tr.querySelectorAll('td');
                    nomeHabilidade = tds.length > 1 ? tds[1].innerText.trim() : tr.innerText.trim();
                }
                if (!nomeHabilidade || !isTechnicalRow(nomeHabilidade)) return;

                const normalizedName = normalize(nomeHabilidade);
                const match = normalizedCaps.find(c => normalize(c.nome).includes(normalizedName) || normalizedName.includes(normalize(c.nome)));
                if (!match) {
                    missingMapping.push(nomeHabilidade);
                    return;
                }

                const desired = match.conceito;
                const current = tr.querySelector('label.ui-selectonemenu-label')?.innerText.trim() || '';
                if (current === desired) {
                    alreadyFilled.push(nomeHabilidade);
                } else {
                    needsFill.push({ nome: nomeHabilidade, desired, current });
                }
            });

            return { missingMapping, needsFill, alreadyFilled };
        }, linhasSeletor, capsJson);

        if (initialScan.missingMapping.length > 0) {
            const faltantes = initialScan.missingMapping.join(' | ');
            this.addLog(`❌ [RA] Habilidade(s) detectada(s) no HTML sem conceito vinculado no JSON: ${faltantes}`);
            await this.capturarDebugHtml('Habilidades sem mapeamento', [linhasSeletor, '#modalDadosAtitudes', 'tbody[id*="dataTableHabilidades_data"]']);
            throw new Error(`Faltam conceitos vinculados para as habilidades: ${faltantes}. Atualize o JSON de capacidades alvo.`);
        }

        if (initialScan.needsFill.length === 0) {
            this.addLog(`[RA] Todos os conceitos técnicos já estavam preenchidos corretamente. (${initialScan.alreadyFilled.length} itens)`);
            return;
        }

        this.addLog(`[RA] ${initialScan.needsFill.length} habilidade(s) técnica(s) a preencher. Já preenchidas: ${initialScan.alreadyFilled.length}.`);

        let lastFailures = null;
        const needsJson = JSON.stringify(initialScan.needsFill.map(n => n.nome));
        for (let attempt = 1; attempt <= 5; attempt++) {
            this.addLog(`[RA] Tentativa ${attempt}/5 para preencher conceitos técnicos...`);
            
            // Passe 1: Tenta preencher via UI (cliques no dropdown)
            const passResult = await this.page.evaluate((sel, capsJson, needsJson) => {
                const caps = (() => { try { return JSON.parse(capsJson); } catch (e) { return capsJson; } })();
                const needs = (() => { try { return JSON.parse(needsJson); } catch (e) { return needsJson; } })();
                const normalize = (text) => text ? text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() : '';
                const normalizedCaps = [];
                if (Array.isArray(caps)) {
                    caps.forEach(c => normalizedCaps.push({ nome: String(c.nome || '').trim(), conceito: String(c.conceito || '').trim().toUpperCase() }));
                } else if (caps && typeof caps === 'object') {
                    Object.keys(caps).forEach(k => normalizedCaps.push({ nome: String(k).trim(), conceito: String(caps[k]).trim().toUpperCase() }));
                }

                const isTechnicalRow = (text) => {
                    if (!text) return false;
                    const lower = text.toLowerCase();
                    const ignorePatterns = ['selecione', 'evidenciado', 'em processo', 'não evidenciado', 'nao evidenciado', 'não há', 'nenhum registro', 'observa'];
                    return !ignorePatterns.some(p => lower.includes(p));
                };

                const rows = Array.from(document.querySelectorAll(sel));
                const failures = [];
                const changes = [];

                const findRowByName = (target) => {
                    const tNorm = normalize(target);
                    for (const tr of rows) {
                        const spanTxt = tr.querySelector('span[id*="habilidadeTxt"]');
                        let nomeHabilidade = spanTxt ? spanTxt.innerText.trim() : null;
                        if (!nomeHabilidade) {
                            const tds = tr.querySelectorAll('td');
                            nomeHabilidade = tds.length > 1 ? tds[1].innerText.trim() : tr.innerText.trim();
                        }
                        if (!nomeHabilidade || !isTechnicalRow(nomeHabilidade)) continue;
                        const n = normalize(nomeHabilidade);
                        if (n.includes(tNorm) || tNorm.includes(n) || n === tNorm) return { tr, nomeHabilidade };
                    }
                    return null;
                };

                for (const targetName of needs) {
                    const found = findRowByName(targetName);
                    if (!found) { failures.push({ nome: targetName, desired: null, reason: 'linha não encontrada' }); continue; }
                    const tr = found.tr;
                    const nomeHabilidade = found.nomeHabilidade;

                    const normalizedName = normalize(nomeHabilidade);
                    const match = normalizedCaps.find(c => normalize(c.nome).includes(normalizedName) || normalizedName.includes(normalize(c.nome)));
                    if (!match) { failures.push({ nome: nomeHabilidade, desired: null, reason: 'mapeamento não encontrado' }); continue; }

                    const desired = match.conceito;
                    const label = tr.querySelector('label.ui-selectonemenu-label');
                    const current = label ? label.innerText.trim() : '';
                    if (current === desired) { changes.push({ nome: nomeHabilidade, conceito: desired }); continue; }

                    // Estratégia 1: Tentar via select subjacente (mais confiável)
                    const select = tr.querySelector('select[id$="_input"], select[id*="notaConceito_input"]');
                    if (select) {
                        const opt = Array.from(select.options).find(o => ((o.text || '').trim().toUpperCase() === desired) || (String(o.value).trim().toUpperCase() === desired));
                        if (opt) {
                            select.value = opt.value;
                            select.dispatchEvent(new Event('input', { bubbles: true }));
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            select.dispatchEvent(new Event('blur', { bubbles: true }));
                            changes.push({ nome: nomeHabilidade, conceito: desired });
                            continue;
                        }
                    }

                    // Estratégia 2: Tentar via UI menu click
                    const menu = tr.querySelector('div.ui-selectonemenu');
                    if (menu) {
                        try {
                            menu.scrollIntoView({ block: 'center' });
                            menu.click();
                        } catch (e) {}
                    }

                    failures.push({ nome: nomeHabilidade, desired, current, attempted: true });
                }

                return { failures, changes };
            }, linhasSeletor, capsJson, needsJson);

            if (passResult.changes && passResult.changes.length > 0) {
                for (const changed of passResult.changes) {
                    this.addLog(`[RA] ✔ "${changed.nome}" → "${changed.conceito}"`);
                }
            }

            if (!passResult.failures || passResult.failures.length === 0) {
                this.addLog(`[RA] ✔ Todos os conceitos técnicos foram preenchidos.`);
                lastFailures = null;
                break;
            }

            lastFailures = passResult.failures;
            this.addLog(`⚠️ [RA] Ainda faltam ${passResult.failures.length} conceito(s) após a tentativa ${attempt}. Tentando novamente...`);
            await pSleep(CONFIG.delays.step * 2);
        }

        if (lastFailures && lastFailures.length > 0) {
            const faltando = lastFailures.map(f => `${f.nome} (esperado: ${f.desired || '??'})`).join(' | ');
            this.addLog(`❌ [RA] Não foi possível preencher todos os conceitos técnicos: ${faltando}`);
            await this.capturarDebugHtml('Falha preencher conceitos técnicos', [linhasSeletor, '#modalDadosAtitudes', 'div[id*="panelAtitudes"]']);
            throw new Error(`Falha ao preencher conceitos técnicos. Habilidades não preenchidas: ${faltando}`);
        }
    }

    // ============================================================
    // ETAPA 2: IMPORTAR SOCIOEMOCIONAIS
    // ============================================================

    async importarSocioemocionais() {
        this.addLog(`[RA] Importando observações socioemocionais...`);

        const seletorBtn = 'button[id*="importarObservacoes"]';
        try {
            await this.page.waitForSelector(seletorBtn, { timeout: 10000 });
        } catch (e) {
            this.addLog(`⚠️ [RA] Botão de importar socioemocionais não encontrado: ${e.message}`);
            return;
        }

        const btn = await this.page.$(seletorBtn);
        if (!btn) {
            this.addLog(`⚠️ [RA] Botão de importar socioemocionais ausente.`);
            return;
        }

        await this.page.evaluate(b => b.click(), btn);
        await this.aguardarLoader();
        await pSleep(CONFIG.delays.stepFast);  // reduzido de 1500

        // Clica em Sim no modal de confirmação
        const clicou = await this.page.evaluate(() => {
            const candidatos = [
                document.getElementById('confirmDialogObservacoes'),
                document.querySelector('div[id*="confirmDialog"]:not([style*="display: none"])'),
                document.querySelector('div.ui-dialog[style*="display: block"]')
            ];
            for (const d of candidatos) {
                if (!d || window.getComputedStyle(d).display === 'none') continue;
                const btnSim = Array.from(d.querySelectorAll('button')).find(b => {
                    const t = b.innerText.trim().toUpperCase();
                    return t.includes('SIM') || t.includes('CONFIRMAR') || b.classList.contains('ui-confirmdialog-yes');
                });
                if (btnSim) { btnSim.click(); return true; }
            }
            return false;
        });

        if (clicou) {
            this.addLog(`[RA] Confirmação socioemocionais OK.`);
        } else {
            this.addLog(`⚠️ [RA] Modal de confirmação não encontrado, tentando seletor direto...`);
            await this.page.click(
                'button.ui-confirmdialog-yes, div[id*="confirmDialog"] button.ui-confirmdialog-yes'
            ).catch(e => this.addLog(`⚠️ [RA] Clique direto falhou: ${e.message}`));
        }

        await this.aguardarLoader();
        await pSleep(CONFIG.delays.stepFast);  // reduzido de 1500
    }

    // ============================================================
    // ETAPA 3: FORMULÁRIO DE RA — INTELIGENTE
    // ============================================================

    async preencherFormularioRA() {
        try {
            this.addLog(`[RA] Iniciando preenchimento inteligente do formulário de RA...`);

            // 3.1 — Verifica se já existe uma RA cadastrada para este aluno
            const raExistente = await this.page.evaluate(() => {
                const table = document.querySelector('#formAtitudes\\:panelAtitudes\\:dataTablePPE, tbody[id*="dataTablePPE_data"]');
                if (!table) return false;
                const tbody = table.tagName === 'TBODY' ? table : table.querySelector('tbody');
                if (!tbody) return false;

                const rows = Array.from(tbody.querySelectorAll('tr'));
                if (rows.length === 0) return false;

                const emptyPattern = /nenhum.*registro|sem.*registro|não.*há.*registro|nenhum.*RA|sem.*RA|não.*encontrad[o|a]|sem.*recomposi[cç][aã]o|vazio|nenhum/i;
                const dataRows = rows.filter(tr => {
                    const text = tr.innerText.trim();
                    if (!text) return false;
                    if (tr.classList.contains('ui-datatable-empty-message')) return false;
                    if (emptyPattern.test(text.toLowerCase())) return false;

                    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()).filter(Boolean);
                    if (cells.length === 0) return false;
                    if (cells.length === 1 && tr.querySelector('td[colspan]')) {
                        return !emptyPattern.test(cells[0].toLowerCase());
                    }
                    return true;
                });

                return dataRows.length > 0;
            });

            this.addLog(`[RA] Detecção de RA existente: ${raExistente ? 'registro encontrado' : 'nenhum registro encontrado'}.`);

            if (raExistente) {
                this.addLog(`[RA] ℹ️ Já existe RA cadastrada para este aluno. Pulando formulário.`);
                return;
            }

            // 3.1.1 — Seleciona PIA no conceito parcial antes de abrir o modal de RA
            await this.preencherPIA();

            // 3.2 — Abre modal clicando em "Adicionar" - tentar seletores específicos antes da busca genérica
            this.addLog(`[RA] Clicando em Adicionar RA...`);
            // Primeiro tenta seletores explícitos / locais (mais seguros)
            let clicouAdicionar = await this.page.evaluate(() => {
                const preferenciais = [
                    '#formAtitudes\\:panelAtitudes\\:btnAdicionarPPE',
                    '#formAtitudes [id*="btnAdicionarPPE"]',
                    'div[id*="accordionPPE"] [id*="btnAdicionarPPE"]'
                ];
                for (const sel of preferenciais) {
                    try {
                        const el = document.querySelector(sel);
                        if (el) { try { el.scrollIntoView({ block: 'center' }); } catch(e){}; try { el.click(); } catch(e){}; return true; }
                    } catch (e) {}
                }
                return false;
            });

            if (!clicouAdicionar) {
                // Se falhar, usa a busca otimizada com tentativas
                for (let attempt = 1; attempt <= 5; attempt++) {
                    this.addLog(`[RA] Tentativa ${attempt}/5 de clicar em Adicionar RA...`);
                    clicouAdicionar = await this.page.evaluate(() => {
                        const seletores = [
                            'button[id*="btnAdicionarPPE"]',
                            '[id*="btnAdicionarPPE"]',
                            'button',
                            'a',
                            'span'
                        ];

                        for (const sel of seletores) {
                            const candidates = Array.from(document.querySelectorAll(sel));
                            const btn = candidates.find(el => {
                                try {
                                    const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                                    const onclick = (el.getAttribute && el.getAttribute('onclick')) || '';
                                    const dataTarget = (el.getAttribute && (el.getAttribute('data-target') || el.getAttribute('data-toggle'))) || '';
                                    const inAtitudesPanel = el.closest && (el.closest('[id*="panelAtitudes"]') || el.closest('div[id*="accordionPPE"]'));

                                    if (el.id && el.id.includes('btnAdicionarPPE')) return true;
                                    if (onclick && onclick.includes('modalPPE')) return true;
                                    if (dataTarget && dataTarget.includes('modalPPE')) return true;
                                    if (txt && (txt.includes('adicionar ra') || txt.includes('adicionar ppe') || txt.includes('adicionar anexo'))) return true;
                                    if (txt && txt.includes('adicionar') && inAtitudesPanel) return true;
                                    if (el.querySelector && el.querySelector('.fa-plus') && inAtitudesPanel) return true;
                                } catch (e) {}
                                return false;
                            });
                            if (btn) {
                                try { btn.scrollIntoView({ block: 'center' }); } catch(e){}
                                try { btn.click(); } catch(e) {}
                                try { if (btn.onclick) btn.onclick.call(btn); } catch(e){}
                                return true;
                            }
                        }

                        // Last resort: search within formAtitudes for textual matches
                        const form = document.getElementById('formAtitudes') || document.querySelector('form[name*="Atitudes"], form[id*="formAtitudes"]');
                        if (form) {
                            const byText = Array.from(form.querySelectorAll('button,a,span')).find(el => (el.innerText||'').trim().toLowerCase().includes('adicionar'));
                            if (byText) { try { byText.scrollIntoView(); byText.click(); } catch(e){}; return true; }
                        }

                        return false;
                    });

                    if (clicouAdicionar) break;
                    await this.aguardarLoader();
                    await pSleep(CONFIG.delays.stepFast * 2);
                }
            }

        if (!clicouAdicionar) {
            // Try to force-open the modal via PrimeFaces widget if available
            const forced = await this.page.evaluate(() => {
                try {
                    if (window.PF && PF('modalPPE') && typeof PF('modalPPE').show === 'function') { PF('modalPPE').show(); return true; }
                } catch (e) {}
                return false;
            });
            if (forced) {
                this.addLog('[RA] ⚠️ Modal aberto via PF("modalPPE").');
            } else {
                this.addLog(`⚠️ [RA] Botão Adicionar RA não encontrado após tentativas.`);
                await this.capturarDebugHtml('Erro abrir modal RA - botão não encontrado', [
                    '#formAtitudes\\:panelAtitudes\\:btnAdicionarPPE',
                    'div[id*="accordionPPE_header"]',
                    '#modalPPE'
                ]);
                throw new Error('Falha ao abrir o modal de RA');
            }
        }

        // 3.3 — Aguarda o modal aparecer (wait otimizado)
        this.addLog(`[RA] Aguardando modal de RA abrir...`);
        try {
            this.addLog(`[RA][DEBUG] Iniciando waitForFunction para modal...`);
            const startTime = Date.now();
            await this.page.waitForFunction(() => {
                const modal = document.getElementById('modalPPE');
                const isVisible = modal &&
                    window.getComputedStyle(modal).display !== 'none' &&
                    modal.getAttribute('aria-hidden') !== 'true';
                if (isVisible) {
                    console.log('[DEBUG] Modal detectado como visível!');
                }
                return isVisible;
            }, { timeout: 20000 });
            const elapsed = Date.now() - startTime;
            this.addLog(`[RA][DEBUG] ✅ Modal detectado aberto! (${elapsed}ms)`);
        } catch (e) {
            this.addLog(`[RA][DEBUG] ⚠️ waitForFunction falhou: ${e.message}. Tentando fallback com waitForSelector...`);
            // Fallback: tenta usar waitForSelector como alternativa
            try {
                await this.page.waitForSelector('#modalPPE', { visible: true, timeout: 15000 });
                this.addLog(`[RA][DEBUG] ✅ Modal detectado via selector!`);
            } catch (e2) {
                this.addLog(`❌ [RA] Modal de RA não abriu (ambos os métodos falharam): ${e2.message}`);
                await this.capturarDebugHtml('Modal RA não abriu', [
                    '#modalPPE',
                    '#formPPE\\:tabPanelCadastroPPE\\:habilidadePPE',
                    '#formAtitudes\\:panelAtitudes\\:btnAdicionarPPE'
                ]);
                throw new Error('Modal RA não abriu');
            }
        }

        await pSleep(CONFIG.delays.modal);
        this.addLog(`[RA] Modal aberto. Preenchendo campos...`);

        // 3.4 — Seleciona habilidade no dropdown (a habilidade com conceito "C")
        try {
            this.addLog(`[RA] [ETAPA 3.4] Iniciando seleção de habilidade...`);
            await this.selecionarHabilidadeRA();
            this.addLog(`[RA] [ETAPA 3.4] ✅ Habilidade processada.`);
        } catch (e) {
            this.addLog(`[RA] ⚠️ [ETAPA 3.4] Erro ao selecionar habilidade: ${e.message}`);
        }

        // 3.5 — Datas
        try {
            this.addLog(`[RA] [ETAPA 3.5] Preenchendo datas...`);
            await this.preencherData('formPPE:tabPanelCadastroPPE:inicioPPE_input', this.dataInicio);
            await pSleep(CONFIG.delays.stepFast);
            await this.preencherData('formPPE:tabPanelCadastroPPE:terminoPPE_input', this.dataTermino);
            await pSleep(CONFIG.delays.stepFast);
            this.addLog(`[RA] [ETAPA 3.5] ✅ Datas preenchidas.`);
        } catch (e) {
            this.addLog(`[RA] ❌ [ETAPA 3.5] Erro ao preencher datas: ${e.message}`);
            throw e;
        }

        // 3.6 — Texto no Quill Editor
        try {
            this.addLog(`[RA] [ETAPA 3.6] Preenchendo texto (Quill)...`);
            await this.preencherQuill();
            await pSleep(CONFIG.delays.stepFast);
            this.addLog(`[RA] [ETAPA 3.6] ✅ Texto preenchido.`);
        } catch (e) {
            this.addLog(`[RA] ❌ [ETAPA 3.6] Erro ao preencher Quill: ${e.message}`);
            throw e;
        }

        // 3.6.1 — Publica online
        try {
            this.addLog(`[RA] [ETAPA 3.6.1] Processando publicação online...`);
            await this.preencherPublicaOnline();
            await pSleep(CONFIG.delays.stepFast);
            this.addLog(`[RA] [ETAPA 3.6.1] ✅ Publicação online processada.`);
        } catch (e) {
            this.addLog(`[RA] ⚠️ [ETAPA 3.6.1] Erro em publicação online: ${e.message}`);
        }

        // 3.7 — Anexo
        try {
            this.addLog(`[RA] [ETAPA 3.7] Anexando arquivo...`);
            await this.anexarArquivo();
            this.addLog(`[RA] [ETAPA 3.7] ✅ Arquivo anexado.`);
        } catch (e) {
            this.addLog(`[RA] ❌ [ETAPA 3.7] Erro ao anexar arquivo: ${e.message}`);
            throw e;
        }

        // 3.8 — Salvar
        try {
            this.addLog(`[RA] [ETAPA 3.8] Salvando formulário de RA...`);
            await this.salvarFormularioRA();
            this.addLog(`[RA] [ETAPA 3.8] ✅ Formulário salvo com sucesso!`);
        } catch (e) {
            this.addLog(`[RA] ❌ [ETAPA 3.8] Erro ao salvar: ${e.message}`);
            throw e;
        }
        } catch (errGeral) {
            this.addLog(`[RA] ❌ ERRO CRÍTICO em preencherFormularioRA: ${errGeral.message}`);
            this.addLog(`[RA] Stack: ${errGeral.stack}`);
            throw errGeral;
        }
    }

    /** Seleciona a habilidade com conceito "C" no dropdown do formulário de RA */
    async selecionarHabilidadeRA() {
        // Encontra qual habilidade tem conceito "C"
        let habilidadeAlvo = null;
        const caps = this.capacidadesAlvo;
        
        this.addLog(`[RA][DEBUG] capacidadesAlvo type: ${typeof caps}, isArray: ${Array.isArray(caps)}`);
        this.addLog(`[RA][DEBUG] capacidadesAlvo content: ${JSON.stringify(caps)}`);
        
        if (Array.isArray(caps)) {
            const match = caps.find(c => (c.conceito || '').toUpperCase() === 'C');
            if (match) habilidadeAlvo = match.nome;
        } else if (typeof caps === 'object' && caps !== null) {
            habilidadeAlvo = Object.keys(caps).find(k => String(caps[k]).toUpperCase() === 'C');
        }

        if (!habilidadeAlvo) {
            this.addLog(`⚠️ [RA] Nenhuma habilidade com conceito "C" definida no capacidadesAlvo. Pulando dropdown.`);
            this.addLog(`[RA][DEBUG] Chaves disponíveis: ${JSON.stringify(Object.keys(caps || {}))}`);
            return;
        }

        const normalize = text => text ? text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() : '';
        const alvoNorm = normalize(habilidadeAlvo);

        this.addLog(`[RA] ✅ Habilidade com conceito "C" encontrada: "${habilidadeAlvo}"`);
        this.addLog(`[RA] Selecionando habilidade no dropdown do modal...`);

        const menuSel = '[id="formPPE:tabPanelCadastroPPE:habilidadePPE"]';
        await this.page.waitForSelector(menuSel, { timeout: 5000 }).catch(() => {});
        
        // Verifica se já está selecionado
        const jaEstaEscolhido = await this.page.evaluate((alvo, menuSel) => {
            const normalize = text => text ? text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() : '';
            const label = document.querySelector(`${menuSel} .ui-selectonemenu-label`);
            if (!label) return false;
            const textoAtual = normalize(label.innerText.trim());
            const alvoNorm = normalize(alvo);
            return textoAtual.includes(alvoNorm) || alvoNorm.includes(textoAtual) || textoAtual.startsWith(alvoNorm.slice(0, 20));
        }, habilidadeAlvo, menuSel);

        if (jaEstaEscolhido) {
            this.addLog(`[RA] ✔ Habilidade já está selecionada.`);
            return;
        }

        await this.page.click(menuSel).catch(() => {});
        await this.page.click(menuSel).catch(() => {});
        await this.page.waitForSelector('#formPPE\\:tabPanelCadastroPPE\\:habilidadePPE_panel', { visible: true, timeout: 6000 }).catch(() => {});
        await pSleep(CONFIG.delays.stepFast);

        // Poll for itens no painel com logs detalhados
        const painelInfo = await this.page.evaluate(() => {
            const painel = document.getElementById('formPPE:tabPanelCadastroPPE:habilidadePPE_panel');
            if (!painel) return { hasItems: false, items: [], visible: false };
            const itens = painel.querySelectorAll('li.ui-selectonemenu-item');
            const itemTexts = Array.from(itens).map(i => i.innerText.trim());
            return { hasItems: itens.length > 0, items: itemTexts, visible: painel.offsetHeight > 0 };
        });
        
        this.addLog(`[RA][DEBUG] Painel de habilidades - visível: ${painelInfo.visible}, itens encontrados: ${painelInfo.items.length}`);
        if (painelInfo.items.length > 0) {
            this.addLog(`[RA][DEBUG] Opções disponíveis: ${JSON.stringify(painelInfo.items.slice(0, 10))}`);
        }
        
        if (!painelInfo.hasItems) {
            this.addLog('[RA] Painel de habilidade sem itens visíveis — tentando teclado como fallback...');
            const filterSel = '#formPPE\\:tabPanelCadastroPPE\\:habilidadePPE_filter';
            const exists = await this.page.$(filterSel);
            if (exists) {
                await this.page.focus(filterSel).catch(() => {});
                await this.page.keyboard.press('ArrowDown');
                await pSleep(200);
                await this.page.keyboard.press('Enter');
                await pSleep(300);
            } else {
                await this.page.focus(menuSel).catch(() => {});
                await this.page.keyboard.press('ArrowDown');
                await pSleep(200);
                await this.page.keyboard.press('Enter');
                await pSleep(300);
            }
            await pSleep(400);
        }

        const clicou = await this.page.evaluate((alvo) => {
            const normalize = text => text ? text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() : '';
            const alvoNorm = normalize(alvo);
            const painel = document.getElementById('formPPE:tabPanelCadastroPPE:habilidadePPE_panel');
            if (!painel) return false;
            const itens = painel.querySelectorAll('li.ui-selectonemenu-item');
            for (const item of itens) {
                const texto = normalize(item.innerText.trim());
                if (!texto) continue;
                if (texto.includes(alvoNorm) || alvoNorm.includes(texto) || texto.startsWith(alvoNorm.slice(0, 20))) {
                    item.click();
                    return true;
                }
            }
            const primeiros = painel.querySelectorAll('li.ui-selectonemenu-item:not(.ui-noselection-option)');
            if (primeiros.length > 0) { primeiros[0].click(); return true; }
            return false;
        }, habilidadeAlvo);

        if (clicou) {
            this.addLog(`[RA] ✔ Habilidade selecionada com sucesso.`);
        } else {
            this.addLog(`⚠️ [RA] Habilidade "${habilidadeAlvo}" não encontrada no dropdown. Continuando fluxo...`);
        }
        await pSleep(CONFIG.delays.stepFast);
    }

    async preencherPIA() {
        this.addLog(`[RA] Preenchendo conceito parcial TR1 como PIA...`);
        const menuSel = '[id="formAtitudes:mediaParcialEstudante"]';
        const painelId = 'formAtitudes:mediaParcialEstudante_panel';

        // Verifica se já está como PIA
        const jaEhPIA = await this.page.evaluate((menuSel) => {
            const menu = document.querySelector(menuSel);
            if (!menu) return false;
            const label = menu.querySelector('.ui-selectonemenu-label');
            if (label && label.innerText.trim().toUpperCase() === 'PIA') {
                return true;
            }
            return false;
        }, menuSel);

        if (jaEhPIA) {
            this.addLog(`[RA] ✔ PIA já está selecionado.`);
            return;
        }

        // Tenta abrir o dropdown via UI
        const abriu = await this.page.evaluate((menuSel) => {
            const menu = document.querySelector(menuSel);
            if (!menu) return false;
            try { menu.click(); } catch (e) { try { menu.querySelector('.ui-selectonemenu-trigger')?.click(); } catch(_) {} }
            return true;
        }, menuSel);

        if (!abriu) {
            this.addLog(`⚠️ [RA] Campo PIA não encontrado. Pulando preenchimento.`);
            await this.capturarDebugHtml('Campo PIA ausente', [
                '#formAtitudes\\:mediaParcialEstudante',
                '#formAtitudes\\:mediaParcialEstudante_panel'
            ]);
            throw new Error('Campo PIA não encontrado');
        }

        // Aguarda painel renderizar e tenta selecionar pela UI primeiro
        await this.page.waitForSelector('#formAtitudes\\:mediaParcialEstudante_panel', { visible: true, timeout: 8000 }).catch(() => {});
        await pSleep(CONFIG.delays.stepFast);

        let selecionado = await this.page.evaluate(() => {
            const painel = document.getElementById('formAtitudes:mediaParcialEstudante_panel');
            if (!painel) return false;
            const opcoes = painel.querySelectorAll('li.ui-selectonemenu-item');
            for (const item of opcoes) {
                const texto = item.innerText.trim().toUpperCase();
                if (texto === 'PIA' || texto === 'C') {
                    try { item.click(); } catch (e) { /* ignore */ }
                    return true;
                }
            }
            return false;
        });

        if (selecionado) {
            this.addLog(`[RA] ✔ Conceito parcial TR1 definido como PIA (via UI).`);
            return;
        }

        // Se painel não teve itens ou seleção via UI falhou, tente teclado (foco + ArrowDown/Enter) para selecionar
        const painelCount = await this.page.evaluate(() => {
            const p = document.getElementById('formAtitudes:mediaParcialEstudante_panel');
            return p ? p.querySelectorAll('li.ui-selectonemenu-item').length : 0;
        });
        if (!painelCount || painelCount === 0) {
            this.addLog('[RA] Painel PIA sem itens — tentando teclado como fallback...');
            const inputFilter = '#formAtitudes\\:mediaParcialEstudante_filter';
            if (await this.page.$(inputFilter)) {
                await this.page.focus(inputFilter).catch(() => {});
                await this.page.keyboard.press('ArrowDown');
                await pSleep(200);
                await this.page.keyboard.press('Enter');
                await pSleep(300);
            } else {
                await this.page.focus(menuSel).catch(() => {});
                await this.page.keyboard.press('ArrowDown');
                await pSleep(200);
                await this.page.keyboard.press('Enter');
                await pSleep(300);
            }
            await pSleep(400);
            // re-check
            const selecionadoDepois = await this.page.evaluate(() => {
                const painel = document.getElementById('formAtitudes:mediaParcialEstudante_panel');
                if (!painel) return false;
                const opcoes = painel.querySelectorAll('li.ui-selectonemenu-item');
                for (const item of opcoes) {
                    const texto = item.innerText.trim().toUpperCase();
                    if (texto === 'PIA' || texto === 'C') { try { item.click(); } catch(e){}; return true; }
                }
                return false;
            });
            if (selecionadoDepois) { this.addLog(`[RA] ✔ Conceito parcial TR1 definido como PIA (via teclado fallback).`); return; }
        }

        // Fallback: setar o valor diretamente no <select> subjacente e disparar onchange
        this.addLog(`[RA] ⚠️ Tentativa UI falhou. Aplicando fallback programático no select de PIA...`);
        const prog = await this.page.evaluate(() => {
            const sel = document.getElementById('formAtitudes:mediaParcialEstudante_input');
            if (!sel) return { ok: false, reason: 'select_missing' };
            try {
                sel.value = 'C';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
            } catch (e) {
                return { ok: false, reason: e.message };
            }
        });

        if (prog.ok) {
            await this.aguardarLoader();
            await pSleep(CONFIG.delays.stepFast);

            const confirm = await this.page.evaluate(() => {
                const menu = document.querySelector('#formAtitudes\\:mediaParcialEstudante');
                const label = menu ? menu.querySelector('.ui-selectonemenu-label') : null;
                const txt = label ? label.innerText.trim().toUpperCase() : '';
                const val = document.getElementById('formAtitudes:mediaParcialEstudante_input')?.value;
                return { txt, val };
            });

            this.addLog(`[RA][DEBUG] Após fallback PIA: label="${confirm.txt}", select.value="${confirm.val}"`);

            if (confirm.txt === 'PIA' || confirm.val === 'C' || confirm.txt === 'C') {
                this.addLog(`[RA] ✔ Conceito parcial TR1 definido como PIA (via fallback).`);
                return;
            }
        } else {
            this.addLog(`[RA] ⚠️ Fallback programático falhou: ${prog.reason || 'desconhecido'}`);
        }

        // Se chegou até aqui, nada funcionou — captura debug e interrompe
        await this.capturarDebugHtml('Falha selecionar PIA', [
            '#formAtitudes\\:mediaParcialEstudante',
            '#formAtitudes\\:mediaParcialEstudante_panel',
            '#formAtitudes\\:mediaParcialEstudante_input'
        ]);
        throw new Error('Não foi possível selecionar o PIA no dropdown (tentar manualmente)');
    }

    async preencherPublicaOnline() {
        if (!this.publicaOnline) {
            this.addLog(`[RA] Publicação online não solicitada. Pulando.`);
            return;
        }

        this.addLog(`[RA] Marcando Publica Online no formulário RA...`);
        const resultado = await this.page.evaluate(() => {
            const input = document.getElementById('formPPE:tabPanelCadastroPPE:publicaOnlinePPE_input');
            if (!input) return 'nao_encontrado';
            if (input.checked) return 'ja_marcado';
            const wrapper = document.querySelector('#formPPE\\:tabPanelCadastroPPE\\:publicaOnlinePPE .ui-chkbox-box');
            if (wrapper) {
                wrapper.click();
                return 'marcado';
            }
            return 'sem_wrapper';
        });

        if (resultado === 'ja_marcado') {
            this.addLog(`[RA] ✔ Publicação online já estava marcada.`);
        } else if (resultado === 'marcado') {
            this.addLog(`[RA] ✔ Publicação online marcada.`);
        } else if (resultado === 'sem_wrapper') {
            this.addLog(`⚠️ [RA] Checkbox de publicação online não possui wrapper visível.`);
        } else {
            this.addLog(`⚠️ [RA] Checkbox de publicação online não encontrado.`);
        }
    }

    async capturarDebugHtml(contexto, selectors = []) {
        const debug = await this.page.evaluate((selectors) => {
            const trunc = (str, max = 1200) => {
                if (!str) return '';
                return str.length > max ? str.slice(0, max) + '...[truncated]' : str;
            };

            const selectorsData = selectors.map(sel => {
                const el = document.querySelector(sel);
                return {
                    selector: sel,
                    found: !!el,
                    html: el ? trunc(el.outerHTML, 1200) : null
                };
            });

            const dialogs = Array.from(document.querySelectorAll('.ui-dialog')).map(d => ({
                id: d.id || null,
                visible: window.getComputedStyle(d).display !== 'none' && d.getAttribute('aria-hidden') !== 'true',
                html: trunc(d.outerHTML, 1200)
            }));

            return { selectors: selectorsData, dialogs };
        }, selectors);

        this.addLog(`[RA][DEBUG] ${contexto} - seletores: ${debug.selectors.map(s => `${s.selector} found=${s.found}`).join(' | ')}`);
        debug.selectors.forEach(s => {
            if (s.html) this.addLog(`[RA][DEBUG] ${contexto} ${s.selector} HTML: ${s.html}`);
        });
        debug.dialogs.forEach(d => {
            this.addLog(`[RA][DEBUG] ${contexto} dialog id=${d.id} visible=${d.visible} html=${d.html}`);
        });

        return debug;
    }

    /** Injeta texto no Quill Editor e sincroniza o input hidden */
    async preencherQuill() {
        const texto = this.justificativa;
        this.addLog(`[RA] Injetando texto no Quill Editor...`);

        const resultado = await this.page.evaluate((val) => {
            const editorContainerId = 'formPPE:tabPanelCadastroPPE:editorDescricao:editorDescricao_editor';
            const hiddenInputId     = 'formPPE:tabPanelCadastroPPE:editorDescricao:editorDescricao_input';

            const container = document.getElementById(editorContainerId);
            const qlEditor  = container ? container.querySelector('.ql-editor') : null;
            const hidden    = document.getElementById(hiddenInputId);

            if (!qlEditor) return 'editor_nao_encontrado';

            // Verifica se já tem conteúdo real
            const conteudoAtual = qlEditor.innerText.trim();
            if (conteudoAtual && conteudoAtual.length > 2 && conteudoAtual !== '\n') {
                return 'ja_preenchido';
            }

            // Foca e injeta
            qlEditor.focus();
            qlEditor.innerHTML = `<p>${val.replace(/\n/g, '</p><p>')}</p>`;
            qlEditor.classList.remove('ql-blank');

            // Dispara eventos para que o PrimeFaces capture
            qlEditor.dispatchEvent(new Event('input',  { bubbles: true }));
            qlEditor.dispatchEvent(new Event('change', { bubbles: true }));
            qlEditor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

            // Sincroniza hidden input
            if (hidden) {
                hidden.value = `<p>${val.replace(/\n/g, '</p><p>')}</p>`;
                hidden.dispatchEvent(new Event('change', { bubbles: true }));
                hidden.dispatchEvent(new Event('input',  { bubbles: true }));
            }

            return 'ok';
        }, texto);

        if (resultado === 'ja_preenchido') {
            this.addLog(`[RA] ℹ️ Quill Editor já possui conteúdo. Mantendo.`);
        } else if (resultado === 'editor_nao_encontrado') {
            this.addLog(`⚠️ [RA] Quill Editor não encontrado.`);
        } else {
            this.addLog(`[RA] ✔ Texto injetado no Quill Editor.`);
        }
    }

    /** Navega para aba Anexo, abre modal de upload, sobe arquivo e salva */
    async anexarArquivo() {
        // Resolve o caminho físico do arquivo
        let caminhoUpload = this.caminhoAnexo;
        if (!fs.existsSync(caminhoUpload)) {
            try {
                const pastaRA = path.join(process.cwd(), "uploads", "RA");
                if (fs.existsSync(pastaRA)) {
                    const arquivos = fs.readdirSync(pastaRA).filter(f => !f.startsWith('.'));
                    if (arquivos.length > 0) caminhoUpload = path.join(pastaRA, arquivos[0]);
                }
            } catch (e) {
                this.addLog(`⚠️ [RA] Erro ao listar pasta de uploads: ${e.message}`);
            }
        }

        if (!fs.existsSync(caminhoUpload)) {
            this.addLog(`⚠️ [RA] Arquivo de anexo não encontrado em uploads/RA. Prosseguindo sem anexo.`);
            return;
        }

        // Verifica se já há anexo cadastrado (evita duplicar)
        const jaTemAnexo = await this.page.evaluate(() => {
            const tabPanel = document.querySelector('[id*="listaAnexoPPE"]');
            if (!tabPanel) return false;
            const linhas = Array.from(tabPanel.querySelectorAll('tbody tr'));
            return linhas.some(tr => {
                const texto = tr.innerText.trim().toLowerCase();
                if (!texto) return false;
                if (texto.includes('nenhum anexo') || texto.includes('nenhum registro') || texto.includes('nenhum')) {
                    return false;
                }
                return true;
            });
        });

        if (jaTemAnexo) {
            this.addLog(`[RA] ℹ️ Já existe anexo cadastrado. Pulando upload.`);
            return;
        }

        // Navega para aba "Anexo" (data-index="1")
        this.addLog(`[RA] Navegando para aba Anexo...`);
        const abaAnexoClicada = await this.page.evaluate(() => {
            const tab = document.querySelector('#modalPPE li[data-index="1"], .ui-dialog li[data-index="1"]');
            const link = tab ? tab.querySelector('a') : null;
            if (link) { link.click(); return true; }
            return false;
        });

        if (!abaAnexoClicada) {
            this.addLog(`⚠️ [RA] Aba Anexo não encontrada. Tentando seletor alternativo...`);
            await this.page.evaluate(() => {
                // Fallback: procura qualquer link com texto "Anexo" dentro do modal
                const links = document.querySelectorAll('#modalPPE a, .ui-tabs-nav a');
                for (const l of links) {
                    if (l.innerText.trim() === 'Anexo') { l.click(); return; }
                }
            });
        }

        await this.aguardarLoader();
        await pSleep(CONFIG.delays.stepFast);

        // Clica em "Adicionar Anexo"
        this.addLog(`[RA] Clicando em Adicionar Anexo...`);
        const btnAdicionarAnexo = await this.page.$('[id="formPPE:tabPanelCadastroPPE:adicionarAnexoPPE"]');
        if (!btnAdicionarAnexo) {
            this.addLog(`⚠️ [RA] Botão "Adicionar Anexo" não encontrado.`);
            return;
        }
        await this.page.evaluate(b => b.click(), btnAdicionarAnexo);

        // Aguarda modal de anexo abrir
        this.addLog(`[RA] Aguardando modal de anexo...`);
        try {
            await this.page.waitForFunction(() => {
                const m = document.getElementById('modalPlanoPessoalEstudoAnexo');
                return m &&
                    window.getComputedStyle(m).display !== 'none' &&
                    m.getAttribute('aria-hidden') !== 'true';
            }, { timeout: 10000 });
        } catch (e) {
            this.addLog(`❌ [RA] Modal de anexo não abriu: ${e.message}`);
            return;
        }

        await pSleep(CONFIG.delays.modal);

        // Preenche o nome do anexo
        const inputNome = await this.page.$('[id="formAnexoPlanoPessoalEstudo:cadastroAnexo:nome"]');
        if (inputNome) {
            await inputNome.click({ clickCount: 3 });
            await inputNome.type('RA', { delay: CONFIG.delays.typing });
            // Dispara onchange PrimeFaces
            await this.page.evaluate(id => {
                const el = document.getElementById(id);
                if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
            }, 'formAnexoPlanoPessoalEstudo:cadastroAnexo:nome');
            await pSleep(CONFIG.delays.stepFast);
        } else {
            this.addLog(`⚠️ [RA] Campo Nome do anexo não encontrado.`);
        }

        // Torna o input de arquivo visível e faz upload
        this.addLog(`[RA] Realizando upload do arquivo: ${path.basename(caminhoUpload)}`);
        const idInputFile = 'formAnexoPlanoPessoalEstudo:cadastroAnexo:arquivo_input';

        await this.page.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display     = 'block';
                el.style.visibility  = 'visible';
                el.style.opacity     = '1';
                el.style.position    = 'relative';
                el.style.width       = '200px';
                el.style.height      = '30px';
            }
        }, idInputFile);

        await pSleep(CONFIG.delays.stepFast);

        const fileInput = await this.page.$(`[id="${idInputFile}"]`);
        if (!fileInput) {
            this.addLog(`⚠️ [RA] Input de arquivo não encontrado.`);
            return;
        }

        await fileInput.uploadFile(caminhoUpload);
        await pSleep(CONFIG.delays.step);
        this.addLog(`[RA] ✔ Arquivo carregado no input.`);

        // Salva o anexo
        this.addLog(`[RA] Salvando anexo...`);
        const btnSalvarAnexo = await this.page.$('[id="formAnexoPlanoPessoalEstudo:cadastroAnexo:salvarAnexo"]');
        if (btnSalvarAnexo) {
            await this.page.evaluate(b => b.click(), btnSalvarAnexo);
            await this.aguardarLoader();
            await pSleep(CONFIG.delays.step);
            this.addLog(`[RA] ✔ Anexo salvo.`);
        } else {
            this.addLog(`⚠️ [RA] Botão Salvar do modal de anexo não encontrado.`);
        }

        // Volta para aba "Dados Gerais" (data-index="0")
        this.addLog(`[RA] Voltando para aba Dados Gerais...`);
        await this.page.evaluate(() => {
            const tab = document.querySelector('#modalPPE li[data-index="0"], .ui-dialog li[data-index="0"]');
            const link = tab ? tab.querySelector('a') : null;
            if (link) link.click();
        });
        await pSleep(CONFIG.delays.stepFast);
    }

    /** Clica em Salvar do formulário de RA e aguarda confirmação */
    async salvarFormularioRA() {
        this.addLog(`[RA] Salvando registro de RA no SGN...`);

        const selSalvar = '[id="formPPE:salvarPPE"]';
        try {
            await this.page.waitForSelector(selSalvar, { timeout: 8000 });
        } catch (e) {
            this.addLog(`⚠️ [RA] Botão Salvar da RA não encontrado: ${e.message}`);
            await this.capturarDebugHtml('Salvar RA não localizado', [
                selSalvar,
                '#modalPPE'
            ]);
            throw new Error('Botão Salvar da RA não encontrado');
        }

        const btnSalvar = await this.page.$(selSalvar);
        if (!btnSalvar) {
            this.addLog(`⚠️ [RA] Botão Salvar da RA não encontrado no DOM.`);
            await this.capturarDebugHtml('Salvar RA não encontrado', [
                selSalvar,
                '#modalPPE'
            ]);
            throw new Error('Botão Salvar da RA não encontrado');
        }

        await this.page.evaluate(b => b.click(), btnSalvar);
        await this.aguardarLoader();
        await pSleep(CONFIG.delays.step);

        try {
            await this.page.waitForFunction(() => {
                const modal = document.getElementById('modalPPE');
                return !modal || window.getComputedStyle(modal).display === 'none' || modal.getAttribute('aria-hidden') === 'true';
            }, { timeout: 45000 });
        } catch (e) {
            const errorMessages = await this.page.evaluate(() => {
                const errors = Array.from(document.querySelectorAll('.ui-messages-error, .ui-messages .ui-messages-error, .ui-messages-error'))
                    .map(el => el.innerText.trim())
                    .filter(Boolean);
                return errors.join(' | ');
            });
            await this.capturarDebugHtml('Falha salvar RA', [
                '#modalPPE',
                '#formPPE\\:salvarPPE',
                '.ui-messages-error'
            ]);
            throw new Error(`Falha ao salvar RA. ${errorMessages || e.message}`);
        }

        this.addLog(`✨ [RA] Registro de RA salvo com sucesso para este aluno.`);
    }

    // ============================================================
    // UTILITÁRIO: ACORDEÃO
    // ============================================================

    async garantirAcordeaoAberto(seletorHeader, nomePainel) {
        const headerExists = await this.page.evaluate((sel) => !!document.querySelector(sel), seletorHeader);
        if (!headerExists) {
            this.addLog(`[RA] ⚠️ Painel "${nomePainel}" não encontrado no HTML. Isso pode indicar que os conceitos técnicos não estão preenchidos corretamente.`);
            return false;
        }

        const estaAberto = await this.page.evaluate((sel) => {
            const h = document.querySelector(sel);
            return h.classList.contains('ui-state-active') || h.getAttribute('aria-expanded') === 'true';
        }, seletorHeader);

        if (!estaAberto) {
            this.addLog(`[RA] Expandindo painel: ${nomePainel}...`);
            await this.page.click(seletorHeader).catch(() => {});
            await pSleep(CONFIG.delays.stepFast);  // reduzido de 800
            return true;
        }

        this.addLog(`[RA] Painel "${nomePainel}" já aberto.`);
        return true;
    }
}

// ============================================================
// EXPORTAÇÃO PRINCIPAL
// ============================================================

export async function runRAAutomation({ user, password, diaryLink, raData, addLog }) {
    addLog(`🚀 Motor de RA (Versão Inteligente) iniciando...`);

    const loginResult = await realizarLogin(user, password, diaryLink, addLog);
    if (!loginResult.success) throw new Error("Falha no login SGN: " + loginResult.error);

    const { browser, page } = loginResult;

    try {
        const automacao = new RAAutomation(page, browser, diaryLink, raData, addLog);
        await automacao.start();
        await browser.close();
        addLog(`🎉 Processamento do diário concluído com sucesso.`);
    } catch (error) {
        addLog(`❌ Erro crítico: ${error.message}`);
        try {
            const imgPath = `erro_ra_${Date.now()}.png`;
            await page.screenshot({ path: imgPath });
            addLog(`[RA] Screenshot salvo: ${imgPath}`);
        } catch (_) {}
        await browser.close();
        throw error;
    }
}