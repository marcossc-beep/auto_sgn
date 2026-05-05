import { realizarLogin } from "./login.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pareceresCaminho = path.join(__dirname, "..", "outros_arquivos", "pareceres.json");

const CONFIG = {
    timeouts: {
        navigation: 60000,
        selector: 30000,
        action: 5000
    },
    delays: {
        min: 1100,
        max: 2500,
        typing: 50
    }
};

const SELECTORS = {
    diary: {
        conceptsTab: 'li a, span.ui-menuitem-text',
        tableBody: 'tbody[id*="dataTableConceitos_data"]',
        periodDropdownContainer: 'div[id$="mediasConceito"]',
        periodDropdownLabel: 'label[id$="mediasConceito_label"]',
        ajaxLoader: '.ajax-loader, .blockUI, .ui-blockui',
        editButton: 'a.ui-icon-pencil, a[id*="linkEditar"], button[id*="btnEditar"]', 
        finalConceptSelect: 'select[id*="comboConceitoFinal"], select[id*="conceitoFinal"]'
    },
    modal: {
        container: '#modalDadosAtitudes, .ui-dialog[aria-hidden="false"]',
        accordions: '.ui-dialog[aria-hidden="false"] .ui-accordion-header',
        closeButton: '.ui-dialog[aria-hidden="false"] a.ui-dialog-titlebar-close'
    },
    pedagogical: {
        dropdownTrigger: 'div[id*="selectEstudantes"]', 
        dropdownPanel: 'div[id*="selectEstudantes_panel"]',
        hiddenSelect: 'select[id*="selectEstudantes_input"]'
    }
};

const sleep = (min = CONFIG.delays.min, max = CONFIG.delays.max) => {
    const ms = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(resolve => setTimeout(resolve, ms));
};

class GradeAutomation {
    constructor(page, browser, diaryLink, trSelection, addLog, pareceresDB) {
        this.page = page;
        this.browser = browser;
        this.url = diaryLink;
        this.trSelection = trSelection || 'TR3';
        this.addLog = addLog;
        this.PARECERES = pareceresDB;
        this.totalStudentsProcessed = 0;
    }

    async start() {
        try {
            this.addLog(`🚀 Iniciando Fase 1: Validação de Notas e Conceitos (${this.trSelection})...`);
            let conceptsSuccess = await this._processConceptsPhase();
            
            if (conceptsSuccess) {
                const isValid = await this._verifyConceptsIntegrity();
                
                if (!isValid) {
                    this.addLog(`⚠️ Aviso: A validação apontou pendências (algum lápis não ficou verde). Indo para o Pedagógico mesmo assim por segurança...`);
                }

                this.addLog(`📚 Iniciando Fase 2: Lançamento de Pareceres Pedagógicos (${this.trSelection} e CF)...`);
                await this._processPedagogicalPhase();
            }
            this.addLog(`🏁 Missão cumprida! Diário processado com sucesso.`);
            return { total: this.totalStudentsProcessed };
        } catch (error) {
            this.addLog(`❌ Erro crítico no processamento: ${error.message}`);
            throw error;
        }
    }

    // ================= FASE 1: CONCEITOS =================
    async _processConceptsPhase() {
        await this._clickTab('CONCEITOS');
        await this._ensureConceptPeriodSelected();
        await this._waitForTable(SELECTORS.diary.tableBody);
        await this._autoFillEmptyConcepts();
        
        const pending = await this._analyzePendingStudents();
        if (pending.length === 0) {
            this.addLog('✅ Todos os conceitos já estão OK (Lápis Verdes).');
            return true;
        }
        
        this.addLog(`📝 Preenchendo notas/atitudes de ${pending.length} aluno(s) pendente(s)...`);
        for (const student of pending) {
            await this._fillStudentModalSmart(student);
        }
        return true;
    }

    async _analyzePendingStudents() {
        return await this.page.evaluate((selRow, selSelect) => {
            const pending = [];
            const rows = document.querySelectorAll(selRow);
            rows.forEach((tr) => {
                const btn = tr.querySelector('a[id*="linkEditar"], button[id*="btnEditar"], .fa-pencil');
                const select = tr.querySelector(selSelect);
                if (btn) {
                    const elToCheck = btn.tagName.toLowerCase() === 'span' ? btn.closest('a, button') || btn : btn;
                    const style = elToCheck.getAttribute('style') || '';
                    const isGreen = style.includes('#00b900') || style.includes('rgb(0, 185, 0)');
                    const conceptValue = select ? select.value : null;
                    
                    if (!isGreen && conceptValue && /^(A|B|C|NE|AV|BV)$/.test(conceptValue)) {
                        const targetId = elToCheck.id || (elToCheck.closest('button, a') ? elToCheck.closest('button, a').id : null);
                        if (targetId) pending.push({ id: targetId, targetConcept: conceptValue, name: tr.cells[0].innerText.trim() });
                    }
                }
            });
            return pending;
        }, SELECTORS.diary.tableBody + ' tr', SELECTORS.diary.finalConceptSelect);
    }

    async _fillStudentModalSmart(student) {
        this.addLog(`   -> Corrigindo conceitos do aluno: ${student.name} (Alvo: ${student.targetConcept})`);
        try {
            await this._waitForAjax();

            await this.page.evaluate((id) => {
                const btn = document.getElementById(id);
                if(btn) btn.click();
            }, student.id);
            
            await this.page.waitForSelector('#modalDadosAtitudes, .ui-dialog[aria-hidden="false"]', {visible:true, timeout:30000});
            await sleep(1500, 2500);

            await this.page.evaluate(() => {
                const headers = document.querySelectorAll('.ui-dialog[aria-hidden="false"] .ui-accordion-header');
                headers.forEach(h => {
                    if (h.getAttribute('aria-expanded') !== 'true') h.click();
                });
            });
            await sleep(1000, 1500);

            let finished = false;
            let maxLoops = 20;

            while (!finished && maxLoops > 0) {
                maxLoops--;
                await this._waitForAjax(); 

                const actionResult = await this.page.evaluate((targetConcept) => {
                    const modal = document.querySelector('#modalDadosAtitudes') || document.querySelector('.ui-dialog[aria-hidden="false"]');
                    if (!modal) return 'DONE';

                    let normTarget = targetConcept;
                    if (targetConcept === 'AV') normTarget = 'A';
                    if (targetConcept === 'BV') normTarget = 'B';
                    if (targetConcept === 'CV') normTarget = 'C';

                    const mappedValues = {
                        'A': ['A', 'PAP', 'SEMPRE', 'EVIDENCIADO'],
                        'B': ['B', 'POD', 'EVIDENCIADO PARCIALMENTE', 'ÀS VEZES', 'QUASE SEMPRE'],
                        'C': ['C', 'PIA', 'NÃO EVIDENCIADO', 'NUNCA']
                    };
                    const targetList = mappedValues[normTarget] || [normTarget];

                    const selects = modal.querySelectorAll('select');
                    for (const select of selects) {
                        if (!select.isConnected || select.disabled) continue;
                        
                        const opts = Array.from(select.options);
                        const currentValue = select.value;

                        const targetOpt = opts.find(o => 
                            targetList.includes(o.text.trim().toUpperCase()) || 
                            targetList.includes(o.value.toUpperCase())
                        );

                        if (targetOpt && currentValue !== targetOpt.value) {
                            select.value = targetOpt.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            
                            const pfContainer = select.closest('.ui-selectonemenu');
                            if (pfContainer) {
                                const pfLabel = pfContainer.querySelector('.ui-selectonemenu-label');
                                if (pfLabel) pfLabel.innerText = targetOpt.text;
                            }
                            return 'CHANGED';
                        }
                    }

                    const radioTables = modal.querySelectorAll('table');
                    for (const table of radioTables) {
                        const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim().toUpperCase());
                        
                        let targetColIndex = -1;
                        for (let i = 0; i < headers.length; i++) {
                            if (targetList.includes(headers[i])) {
                                targetColIndex = i;
                                break;
                            }
                        }

                        const rows = table.querySelectorAll('tbody tr');
                        for (const row of rows) {
                            if (targetColIndex !== -1) {
                                const cells = row.querySelectorAll('td');
                                if (cells.length > targetColIndex) {
                                    const targetCell = cells[targetColIndex];
                                    const radioBox = targetCell.querySelector('.ui-radiobutton-box');
                                    if (radioBox && !radioBox.classList.contains('ui-state-active')) {
                                        radioBox.click();
                                        return 'CHANGED';
                                    }
                                }
                            }

                            const labels = Array.from(row.querySelectorAll('label'));
                            if (labels.length > 0) {
                                const targetLabel = labels.find(l => targetList.includes(l.innerText.trim().toUpperCase()));
                                if (targetLabel) {
                                    const container = targetLabel.closest('td') || targetLabel.closest('div.ui-radiobutton') || targetLabel.parentElement;
                                    const radioBox = container.querySelector('.ui-radiobutton-box') || (container.previousElementSibling ? container.previousElementSibling.querySelector('.ui-radiobutton-box') : null);
                                    if (radioBox && !radioBox.classList.contains('ui-state-active')) {
                                        radioBox.click();
                                        return 'CHANGED';
                                    }
                                }
                            }
                        }
                    }

                    return 'DONE'; 
                }, student.targetConcept);

                if (actionResult === 'DONE') {
                    finished = true;
                } else {
                    await sleep(1500, 2000); 
                }
            }

            if (maxLoops === 0) {
                this.addLog(`   -> ⚠️ Aviso: Limite de alterações atingido. Tentando salvar progresso...`);
            }

            await this._saveAndCloseModal();
            return true;

        } catch (e) {
            this.addLog(`❌ Erro no modal do aluno ${student.name}: ${e.message}`);
            await this.page.keyboard.press('Escape'); 
            await this._waitForAjax();
            return false;
        }
    }

    async _saveAndCloseModal() {
        this.addLog(`   -> Salvando e fechando modal...`);
        
        const clickedSave = await this.page.evaluate(() => {
            const modal = document.querySelector('#modalDadosAtitudes') || document.querySelector('.ui-dialog[aria-hidden="false"]');
            if (!modal) return false;

            const spans = Array.from(modal.querySelectorAll('span'));
            const saveTextElement = spans.find(s => {
                const txt = s.innerText.trim().toUpperCase();
                return txt === 'GRAVAR' || txt === 'SALVAR';
            });

            if (saveTextElement) {
                const btnParent = saveTextElement.closest('button, a');
                if (btnParent) {
                    btnParent.click();
                } else {
                    saveTextElement.click(); 
                }
                return true;
            }

            const clickables = Array.from(modal.querySelectorAll('button, a.ui-button, a.ui-commandlink, input[type="button"], input[type="submit"]'));
            const saveBtn = clickables.find(b => {
                if (b.classList && b.classList.contains('ui-dialog-titlebar-close')) return false;
                const txt = (b.innerText || b.value || '').toUpperCase();
                const title = (b.title || '').toUpperCase();
                return txt.includes('SALVAR') || txt.includes('GRAVAR') || title.includes('SALVAR') || title.includes('GRAVAR') ||
                       (b.querySelector && b.querySelector('.fa-save, .fa-check, .ui-icon-disk, .ui-icon-check'));
            });

            if (saveBtn) {
                saveBtn.click();
                return true;
            }

            return false;
        });

        if (!clickedSave) {
            this.addLog(`   -> ⚠️ Botão de salvar não encontrado! Fechamento forçado ativado.`);
        }

        await this._waitForAjax();
        await sleep(1500, 2000);

        let fechou = false;
        for(let i=0; i<3; i++) {
            const aberto = await this.page.evaluate(() => {
                const m = document.querySelector('#modalDadosAtitudes') || document.querySelector('.ui-dialog[aria-hidden="false"]');
                return m && m.style.display !== 'none' && m.style.visibility !== 'hidden';
            });
            if(!aberto) { fechou = true; break; }
            await sleep(1000, 1500);
        }

        if (!fechou) {
            try {
                await this.page.evaluate(() => {
                    const closeBtn = document.querySelector('.ui-dialog[aria-hidden="false"] .ui-dialog-titlebar-close');
                    if (closeBtn) closeBtn.click();
                });
                await sleep(500);
                await this.page.keyboard.press('Escape');
            } catch(e) {}
        }
    }

    // ================= FASE 2: PEDAGÓGICO =================
    async _processPedagogicalPhase() {
        await this._clickTab('PEDAGÓGICO');
        await sleep(2000, 3000);

        await this.page.waitForSelector(SELECTORS.pedagogical.hiddenSelect, { hidden: true, timeout: 20000 });
        
        const studentNames = await this.page.evaluate((sel) => {
            const select = document.querySelector(sel);
            if (!select) return [];
            return Array.from(select.options).map(o => o.text.trim()).filter(t => t && t !== 'Selecione');
        }, SELECTORS.pedagogical.hiddenSelect);

        this.addLog(`Encontrados ${studentNames.length} alunos na aba pedagógica.`);

        for (const name of studentNames) {
            let sucessoAluno = false;
            let tentativasAluno = 0;

            while (!sucessoAluno && tentativasAluno < 2) {
                tentativasAluno++;
                try {
                    const abaAtiva = await this.page.evaluate(() => {
                        const active = document.querySelector('.ui-state-active');
                        return active ? active.innerText : '';
                    });
                    if (!abaAtiva.includes('Pedagógico') && !abaAtiva.includes('PEDAGÓGICO')) {
                        await this._clickTab('PEDAGÓGICO');
                    }

                    await this._selectStudentInDropdown(name);
                    await this._processSingleStudentParecer(name);
                    sucessoAluno = true;
                    await sleep(1000, 1500); 
                } catch (erroAluno) {
                    this.addLog(`❌ Erro com aluno ${name} (Tentativa ${tentativasAluno}): ${erroAluno.message}`);
                    if (tentativasAluno >= 2) this.addLog(`Pulando aluno ${name} após falhas repetidas.`);
                }
            }
        }
    }

    async _selectStudentInDropdown(studentName) {
        await this.page.click(SELECTORS.pedagogical.dropdownTrigger);
        try { await this.page.waitForSelector(SELECTORS.pedagogical.dropdownPanel, { visible: true, timeout: 5000 }); }
        catch(e) { 
            await this.page.click(SELECTORS.pedagogical.dropdownTrigger); 
            await this.page.waitForSelector(SELECTORS.pedagogical.dropdownPanel, { visible: true }); 
        }

        await sleep(400);

        const clicked = await this.page.evaluate((name) => {
            const items = Array.from(document.querySelectorAll('.ui-selectonemenu-item'));
            const target = items.find(i => i.innerText.trim() === name);
            if (target) { target.click(); return true; }
            return false;
        }, studentName);

        if (!clicked) throw new Error(`Aluno não encontrado no dropdown.`);
        await this._waitForAjax();
        await sleep(1500, 2000);
    }

    async _processSingleStudentParecer(studentName) {
        await this._expandAccordion('Desempenho');
        await this._expandAccordion('Avaliação'); 
        await this._ensureEvaluationPeriodSelected(); 

        const conceitoFinal = await this._calculateStudentFinalGrade();
        this.addLog(`   -> Escrevendo parecer de ${studentName} (Conceito: ${conceitoFinal})`);

        await this._expandAccordion('Média') || await this._expandAccordion('Parecer');
        await sleep(1500, 2500);
        
        if (this.PARECERES[conceitoFinal]) {
            const opcoes = this.PARECERES[conceitoFinal];
            const textoSorteado = opcoes[Math.floor(Math.random() * opcoes.length)];
            
            let filled = { success: false };
            
            for(let t = 1; t <= 3; t++) {
                filled = await this.page.evaluate((texto, trTargetStr) => {
                    const preencherCampo = (termo, idSufixo) => {
                        let el = document.querySelector(`textarea[id*="${idSufixo}"]`);
                        
                        // Fallback mais inteligente usando a label (sobe na div pra achar o textarea do lado)
                        if (!el || el.offsetParent === null) {
                            const labels = Array.from(document.querySelectorAll('label'));
                            const label = labels.find(l => l.innerText.toUpperCase().includes(termo.toUpperCase()));
                            if (label) {
                                let parent = label.parentElement;
                                while(parent && parent.tagName !== 'BODY') {
                                    const txt = parent.querySelector('textarea');
                                    if(txt && txt.offsetParent !== null && !txt.disabled) {
                                        el = txt;
                                        break;
                                    }
                                    parent = parent.parentElement;
                                }
                            }
                        }

                        // Se a label falhar, pega o primeiro textarea ativo que vir pela frente
                        if (!el || el.offsetParent === null) {
                            const textareas = Array.from(document.querySelectorAll('textarea')).filter(tx => tx.offsetParent !== null && !tx.disabled);
                            if (textareas.length > 0) {
                                el = (termo === 'FINAL' || termo === 'CF') ? textareas[textareas.length - 1] : textareas[0];
                            }
                        }

                        if (el && el.offsetParent !== null && !el.disabled) {
                            if (el.value && el.value.trim().length > 10) return true; // Se já tiver texto, ele entende como sucesso e não apaga
                            el.value = texto;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                            return true;
                        }
                        return false;
                    };

                    // MAPEAMENTO DINÂMICO: TR1 = 0, TR2 = 1, TR3 = 2
                    const mapTr = { 'TR1': '0', 'TR2': '1', 'TR3': '2' };
                    const suffix = mapTr[trTargetStr] || '2';

                    const trText = preencherCampo(trTargetStr, `sanfonaMedia:desempenhoMedias:${suffix}`);
                    const cfText = preencherCampo('FINAL', 'sanfonaMedia:desempenhoMedias:3') || preencherCampo('CF');

                    if (trText) return { success: true };
                    return { success: false };
                }, textoSorteado, this.trSelection);

                if (filled.success) break;
                // Espera simples por Promise injetada no backend Node (fora do evaluate do browser)
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!filled.success) throw new Error(`Campos de texto ${this.trSelection} não encontrados ou bloqueados.`);
            
            await sleep(500, 1000);
            await this._savePedagogical();
            this.totalStudentsProcessed++;

        } else {
            this.addLog(`   -> ⚠️ Sem parecer configurado no JSON para a nota: ${conceitoFinal}`);
        }
    }

    async _savePedagogical() {
        const saved = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a.ui-button'));
            const saveBtn = buttons.find(b => 
                (b.innerText && b.innerText.toUpperCase().includes('SALVAR')) ||
                (b.innerText && b.innerText.toUpperCase().includes('GRAVAR')) ||
                (b.title && b.title.toUpperCase().includes('SALVAR')) ||
                (b.title && b.title.toUpperCase().includes('GRAVAR')) ||
                b.querySelector('.ui-icon-disk') ||
                b.querySelector('.ui-icon-check')
            );
            if(saveBtn) {
                saveBtn.click();
                return true;
            }
            return false;
        });

        if(!saved) {
             try { await this.page.click('button[id*="Salvar"], button[id*="Gravar"]'); } catch(e) {}
        }
        await this._waitForAjax();
    }

    async _ensureEvaluationPeriodSelected() {
        try {
            await this.page.evaluate((trTargetStr) => {
                const dropdown = document.querySelector('div[id*="sanfonaAvaliacao:mediasReferencia"]');
                const label = document.querySelector('label[id*="sanfonaAvaliacao:mediasReferencia_label"]');
                if (label && label.innerText.includes(trTargetStr)) return;
                if (dropdown) dropdown.click();
            }, this.trSelection);
            
            await sleep(500, 1000);
            
            await this.page.evaluate((trTargetStr) => {
                const items = Array.from(document.querySelectorAll('.ui-selectonemenu-item'));
                const trItem = items.find(i => i.innerText.trim() === trTargetStr);
                if (trItem && trItem.offsetParent !== null) trItem.click();
            }, this.trSelection);
            
            await this._waitForAjax();
        } catch (e) {}
    }

    async _expandAccordion(textPart) {
        try {
            const clicked = await this.page.evaluate((txt) => {
                const headers = Array.from(document.querySelectorAll('.ui-accordion-header'));
                const target = headers.find(h => h.innerText.toLowerCase().includes(txt.toLowerCase()) && h.offsetParent !== null);
                if (target) {
                    if (target.getAttribute('aria-expanded') !== 'true') target.click();
                    return true;
                }
                return false;
            }, textPart);
            if (clicked) await sleep(1500, 2000);
            return clicked;
        } catch (e) { return false; }
    }

    async _calculateStudentFinalGrade() {
        return await this.page.evaluate(() => {
            const evaluationHeader = Array.from(document.querySelectorAll('.ui-accordion-header'))
                .find(h => h.innerText.includes('Avaliação') && h.getAttribute('aria-expanded') === 'true');
            if (!evaluationHeader) return 'B'; 
            const contentDiv = evaluationHeader.nextElementSibling;
            if (!contentDiv) return 'B';
            const rows = Array.from(contentDiv.querySelectorAll('table tbody tr'));
            const grades = [];
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 3) {
                    const txt = cells[2].innerText.trim().toUpperCase();
                    if (['A', 'B', 'C'].includes(txt)) grades.push(txt);
                }
            }
            if (grades.length === 0) return 'B';
            return grades.every(g => g === 'A') ? 'A' : 'B';
        });
    }

    // ================= HELPERS GERAIS =================
    async _verifyConceptsIntegrity() {
        try {
            await this.page.reload({ waitUntil: 'domcontentloaded' });
            await sleep(3000, 5000);
            await this._clickTab('CONCEITOS');
            await this._ensureConceptPeriodSelected();
            await this._waitForTable(SELECTORS.diary.tableBody);
            
            const pendencias = await this.page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('a[id*="linkEditarAtitudes"], a[id*="linkEditar"], button[id*="btnEditar"]'));
                return btns.some(btn => {
                    const elToCheck = btn.tagName.toLowerCase() === 'span' ? btn.closest('a, button') || btn : btn;
                    const style = elToCheck.getAttribute('style') || '';
                    return !style.includes('#00b900') && !style.includes('rgb(0, 185, 0)');
                });
            });
            return !pendencias;
        } catch (e) { return false; }
    }

    async _clickTab(namePart) {
        const clicked = await this.page.evaluate((txt) => {
            const abas = Array.from(document.querySelectorAll('li a, span.ui-menuitem-text'));
            const target = abas.find(el => el.innerText && el.innerText.toUpperCase().includes(txt));
            if (target) { target.click(); return true; }
            return false;
        }, namePart);
        if (!clicked) throw new Error(`Aba ${namePart} não encontrada`);
        await this._waitForAjax();
    }

    async _ensureConceptPeriodSelected() {
        try {
            const currentLabel = await this.page.$eval(SELECTORS.diary.periodDropdownLabel, el => el.innerText);
            if (!currentLabel.includes(this.trSelection)) {
                await this.page.click(SELECTORS.diary.periodDropdownContainer);
                await sleep(1000, 1500);
                await this.page.evaluate((trTargetStr) => {
                    const items = Array.from(document.querySelectorAll('.ui-selectonemenu-item'));
                    const trItem = items.find(i => i.innerText.trim() === trTargetStr);
                    if (trItem) trItem.click();
                }, this.trSelection);
                await this._waitForAjax();
                await sleep(1500, 2000);
            }
        } catch (e) { throw e; }
    }

    async _waitForTable(selector) {
        try { await this.page.waitForSelector(selector, { visible: true, timeout: 20000 }); } 
        catch (e) { throw new Error('Tabela não carregou a tempo.'); }
    }

    async _waitForAjax() {
        try {
            await this.page.waitForFunction(() => {
                const loaders = document.querySelectorAll('.ajax-loader, .blockUI, .ui-blockui');
                for (let el of loaders) {
                    if (el.offsetParent !== null && el.style.display !== 'none' && el.style.visibility !== 'hidden') {
                        return false; 
                    }
                }
                return true; 
            }, { timeout: 15000 });
        } catch (e) {}
        await sleep(500, 800);
    }
    
    async _autoFillEmptyConcepts() {
         const hasChanges = await this.page.evaluate(async (selRow, selSelect) => {
            const pSleep = ms => new Promise(r => setTimeout(r, ms));
            const rows = document.querySelectorAll(selRow);
            let changed = false;
            for (const row of rows) {
                const select = row.querySelector(selSelect);
                if (select && (select.value === '' || select.value === 'Selecione')) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const grades = cells.map(td => td.innerText.trim().toUpperCase()).filter(txt => ['A', 'B', 'C', 'NE'].includes(txt));
                    if (grades.length > 0) {
                        const newConcept = grades.some(n => ['B', 'C', 'NE'].includes(n)) ? 'B' : 'A';
                        select.value = newConcept;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        changed = true;
                        await pSleep(300);
                    }
                }
            }
            return changed;
        }, SELECTORS.diary.tableBody + ' tr', SELECTORS.diary.finalConceptSelect);
        if (hasChanges) await sleep(2000, 3000);
    }
}

export async function runPareceresAutomation({ user, password, diaryLink, trSelection, addLog }) {
    addLog(`🚀 Iniciando Motor de Automação Reestruturado (V4)...`);

    if (!fs.existsSync(pareceresCaminho)) throw new Error("Arquivo pareceres.json ausente.");
    const PARECERES_DB = JSON.parse(fs.readFileSync(pareceresCaminho, "utf-8"));

    const loginResult = await realizarLogin(user, password, diaryLink, addLog);
    if (!loginResult.success) throw new Error("Falha no login SGN: " + loginResult.error);

    const { browser, page } = loginResult;

    try {
        const automacao = new GradeAutomation(page, browser, diaryLink, trSelection, addLog, PARECERES_DB);
        await automacao.start();
    } catch (error) {
        addLog(`❌ Processo interrompido devido a erro crítico: ${error.message}`);
        try { await page.screenshot({ path: 'erro_automacao_v4.png' }); } catch (e) {}
        throw error;
    } finally {
        if (browser) await browser.close();
        addLog("🌐 Navegador encerrado com sucesso.");
    }
}