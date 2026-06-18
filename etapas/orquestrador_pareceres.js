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
        conceptsTab: 'li a[href*="abaConceitos DATE_FORMAT_ALLOW_SINGLE_BYTE"], a[href$="abaConceitos"]',
        conceptsTabPure: 'li a[href*="abaConceitos"], a[href$="abaConceitos"]',
        tableBody: 'tbody[id*="tabelaConceitos"], tbody[id*="dataTableConceitos_data"]',
        periodDropdownContainer: 'div[id="tabViewDiarioClasse:formAbaConceitos:mediasConceito"]',
        periodDropdownLabel: 'label[id="tabViewDiarioClasse:formAbaConceitos:mediasConceito_label"]',
        ajaxLoader: '.ajax-loader, .blockUI, .ui-blockui',
        
        // Lápis de edição
        editButton: 'a[id*="linkEditarAtitudes"]', 
        
        // Elementos internos do Modal de Atitudes
        accordionHabilidadesHeader: 'div[id="formAtitudes:panelAtitudes:accordionHabilidades_header"]',
        btnImportarConceitos: 'button[id="formAtitudes:panelAtitudes:importarConceitos"]',
        // Seletores CSS puros e válidos (filtram o dialog ativo e buscam o botão com ícone de check)
        btnConfirmarConceitos: 'div[id="confirmDialogConceitos"]:not([style*="display: none"]) button:has(.fa-check), div[id="confirmDialogConceitos"]:not([style*="display: none"]) button',
        
        accordionSocioemocionaisHeader: 'div[id="formAtitudes:panelAtitudes:accordionHabilidadesSocioemocionais_header"]',
        btnImportarSocioemocionais: 'button[id="formAtitudes:panelAtitudes:importarObservacoes"]',
        btnConfirmarSocioemocionais: 'div[id*="confirmDialog"]:not([style*="display: none"]) button:has(.fa-check), div[id*="confirmDialog"]:not([style*="display: none"]) button',
        
        // Seletor corrigido por aproximação de atributo para o botão fechar do modal
        btnCloseModal: 'div[id*="modalDadosAtitudes"] a.ui-dialog-titlebar-close',

        finalConceptSelect: 'select[id*="comboConceitoFinal"], select[id*="conceitoFinal"]',
        finalConceptSelectInput: 'select[id*="comboConceitoFinal_input"]',
        finalConceptLabel: 'label[id*="comboConceitoFinal_label"]',
        modalHabilidadesTableBody: 'tbody[id="formAtitudes:panelAtitudes:dataTableHabilidades_data"]',
        modalHabilidadesSelects: 'tbody[id="formAtitudes:panelAtitudes:dataTableHabilidades_data"] select[id*="notaConceito_input"]'
    },
    pedagogical: {
        // Seus seletores pedagógicos originais mantêm-se aqui...
        pedagogicalTab: 'li a[href*="abaParecerPedagogico"], a[href$="abaParecerPedagogico"]',
        tableBody: 'tbody[id="tabViewDiarioClasse:formAbaParecerPedagogico:dataTableParecerPedagogico_data"]',
        editButton: 'a[id*="linkEditarParecer"]',
        textArea: 'textarea[id="formParecer:parecerPedagogico"]',
        saveButton: 'button[id="formParecer:btnSalvarParecer"]',
        closeButton: 'div[id="modalParecer"] a.ui-dialog-titlebar-close'
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

            this.addLog("Procurando a aba 'Conceitos' na interface do diário...");
            await this.page.waitForSelector('li a[href*="Conceitos"], a[href*="conceitos"]', { visible: true, timeout: 30000 });
            await this.page.click('li a[href*="Conceitos"], a[href*="conceitos"]');
            
            // Pausa estratégica para a aba renderizar completamente
            await sleep(3000, 4000);

            const trAlvo = this.trSelection ? this.trSelection.trim().toUpperCase() : 'TR1';
            this.addLog(`Abrindo seletor de períodos para selecionar [${trAlvo}]...`);

            // 1. Clica fisicamente no gatilho do dropdown do PrimeFaces (suporta diferentes variações de seletores do contêiner)
            const dropdownTrigger = 'div[id*="mediasConceito"] .ui-selectonemenu-trigger, div[id*="formAbaConceitos"] .ui-selectonemenu-trigger, div[id*="mediasConceito"]';
            await this.page.waitForSelector(dropdownTrigger, { visible: true, timeout: 15000 });
            await this.page.click(dropdownTrigger);
            await sleep(1500); // Aguarda a abertura visual da caixinha de opções

            // 2. Localiza o item correto na lista flutuante usando busca resiliente e inteligente
            const resultadoSelecao = await this.page.evaluate((targetText) => {
                const itens = Array.from(document.querySelectorAll('li.ui-selectonemenu-item'));
                const opcoesDisponiveis = itens.map(li => li.innerText.trim());
                
                const alvo = itens.find(li => {
                    const text = li.innerText.trim().toUpperCase();
                    const target = targetText.toUpperCase();
                    
                    // A) Igualdade estrita ou contenção direta (ex: "TR1" ou "1º Trimestre (TR1)")
                    if (text === target || text.includes(target)) return true;
                    
                    // B) Mapeamento inteligente por número do período para formatos alternativos do SGN
                    if (target === 'TR1' && (text.includes('1º') || text.includes('1O') || text.includes('PRIMEIRO'))) return true;
                    if (target === 'TR2' && (text.includes('2º') || text.includes('2O') || text.includes('SEGUNDO'))) return true;
                    if (target === 'TR3' && (text.includes('3º') || text.includes('3O') || text.includes('TERCEIRO'))) return true;
                    if (target === 'TR4' && (text.includes('4º') || text.includes('4O') || text.includes('QUARTO'))) return true;
                    
                    return false;
                });
                
                if (alvo) {
                    alvo.click();
                    return { encontrado: true };
                }
                return { encontrado: false, opcoes: opcoesDisponiveis };
            }, trAlvo);

            if (!resultadoSelecao.encontrado) {
                this.addLog(`⚠️ Opções de período detectadas no diário: [${resultadoSelecao.opcoes.join(', ')}]`);
                throw new Error(`O período [${trAlvo}] não foi localizado nas opções disponíveis deste diário.`);
            }

            this.addLog("Aguardando o processamento da requisição e atualização dos dados...");
            
            // 3. Aguarda qualquer tela de carregamento (loader) sumir da tela antes de prosseguir
            try {
                const loaderSelector = '.ajax-loader, .blockUI, .ui-blockui';
                await sleep(1500); 
                await this.page.waitForSelector(loaderSelector, { hidden: true, timeout: 15000 });
            } catch (e) {}

            await sleep(3500, 4500); // Tempo necessário para estabilização completa do DOM

            // 4. Mapeia dinamicamente o ID correto da tabela atualizada
            const idRealTabela = await this.page.evaluate(() => {
                const el = document.querySelector('tbody[id*="tabelaConceitos"], tbody[id*="dataTableConceitos_data"]');
                return el ? `tbody[id="${el.id}"]` : null;
            });

            if (!idRealTabela) {
                throw new Error("A tabela de conceitos sumiu ou não foi renderizada após a troca de período.");
            }

            this.tableBodySelector = idRealTabela; 
            this.addLog(`✅ Tabela mapeada com sucesso: ${idRealTabela}. Alunos prontos para análise.`);

            // Executa a rotina de preenchimento dos conceitos (lápis por lápis)
            let conceptsSuccess = await this._processConceptsPhase();
            
            if (conceptsSuccess) {
                // Validação estrita de segurança pós-lançamento
                const isValid = await this._verifyConceptsIntegrity();
                
                if (!isValid) {
                    throw new Error("A validação pós-execução encontrou inconsistências nos conceitos. Processo interrompido por segurança.");
                }

                this.addLog(`📚 Iniciando Fase 2: Lançamento de Pareceres Pedagógicos (${this.trSelection} e CF)...`);
                await this._processPedagogicalPhase();
            } else {
                throw new Error("A rotina de Conceitos acusou falha interna no processamento de alunos.");
            }
            
            this.addLog(`🏁 Missão cumprida! Todos os passos concluídos com êxito.`);
            return { total: this.totalStudentsProcessed };
        } catch (error) {
            this.addLog(`❌ Erro crítico no processamento: ${error.message}`);
            throw error;
        }
   }
// ================= FASE 1: CONCEITOS =================
   // ================= FASE 1: CONCEITOS =================
    async _processConceptsPhase() {
        try {
            this.addLog("🔄 Iniciando varredura combinada (Trava de Lápis Verde + Regra de CF + Forçar Habilidades)...");
            const seletorTabela = this.tableBodySelector;
            
            const totalAlunos = await this.page.evaluate((tableSelector) => {
                return document.querySelectorAll(`${tableSelector} tr[data-ri]`).length;
            }, seletorTabela);

            this.addLog(`👥 Total de ${totalAlunos} alunos encontrados. Analisando status dos lápis...`);
            this.totalStudentsProcessed = 0;

            for (let i = 0; i < totalAlunos; i++) {
                try { // TRY CATCH INTERNO: Se um aluno falhar, o robô pula para o próximo!
                    const linhaSelector = `${seletorTabela} tr[data-ri="${i}"]`;
                    await this.page.waitForSelector(linhaSelector, { visible: true, timeout: 5000 });

                    const decisaoAluno = await this.page.evaluate((index, tableSelector) => {
                        const linha = document.querySelector(`${tableSelector} tr[data-ri="${index}"]`);
                        if (!linha) return { acao: 'pular', motivo: 'Linha não encontrada', nome: 'Desconhecido' };
                        const celulas = Array.from(linha.querySelectorAll('td'));
                        const nome = celulas[1] ? celulas[1].innerText.trim() : `Aluno ${index + 1}`;

                        const linkEditar = linha.querySelector('a[id*="linkEditarAtitudes"]');
                        if (linkEditar) {
                            const titulo = linkEditar.getAttribute('title') || '';
                            const estilo = linkEditar.getAttribute('style') || '';
                            if (titulo.includes('(Preenchido)') || estilo.includes('color:#00b900') || estilo.includes('color: rgb(0, 185, 0)')) {
                                return { acao: 'pular', motivo: 'Lápis já está Verde (Preenchido)', nome: nome };
                            }
                        }

                        const selectCF = linha.querySelector('select[id*="comboConceitoFinal_input"], select[id*="conceitoFinal"]');
                        let valorCF = "";
                        if (selectCF && selectCF.value) {
                            valorCF = selectCF.value.trim().toUpperCase();
                        } else {
                            const labelCF = linha.querySelector('label[id*="comboConceitoFinal_label"]');
                            if (labelCF && labelCF.innerText) valorCF = labelCF.innerText.trim().toUpperCase();
                        }

                        if (valorCF === 'C' || valorCF === 'PIA') {
                            return { acao: 'pular', motivo: 'Possui Conceito Final C (PIA)', nome: nome };
                        }

                        let atitudeAlvo = "PAP";
                        let conceitoNormalizado = "A";
                        if (valorCF === 'A' || valorCF === 'PAP') {
                            atitudeAlvo = "PAP";
                            conceitoNormalizado = "A";
                        } else if (valorCF === 'B' || valorCF === 'POD') {
                            atitudeAlvo = "POD";
                            conceitoNormalizado = "B";
                        }

                        return { acao: 'processar', atitudeAlvo: atitudeAlvo, conceitoNormalizado: conceitoNormalizado, nome: nome };
                    }, i, seletorTabela);

                    if (decisaoAluno.acao === 'pular') {
                        this.addLog(`⏭️ [Aluno ${i + 1}/${totalAlunos}] ${decisaoAluno.nome} ignorado ➔ Motivo: ${decisaoAluno.motivo}.`);
                        continue;
                    }

                    this.addLog(`\n👤 [Aluno ${i + 1}/${totalAlunos}] Processando: ${decisaoAluno.nome} ➔ Alvo: [${decisaoAluno.atitudeAlvo}] (Conceito: ${decisaoAluno.conceitoNormalizado})`);

                    const lapisSelector = `${linhaSelector} a[id*="linkEditarAtitudes"]`;
                    await this.page.waitForSelector(lapisSelector, { visible: true, timeout: 10000 });
                    await this.page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
                    }, lapisSelector);
                    
                    await this.page.waitForSelector('div[id*="formAtitudes:panelMediaParcialEstudante"]', { visible: true, timeout: 15000 });
                    await sleep(1000, 1500);

                    await this.page.evaluate((targetText) => {
                        const nativeSelect = document.querySelector('select[id="formAtitudes:mediaParcialEstudante_input"]');
                        const labelVisual = document.querySelector('label[id="formAtitudes:mediaParcialEstudante_label"]');
                        if (!nativeSelect) return false;
                        const opcao = Array.from(nativeSelect.options).find(o => o.text.trim().toUpperCase() === targetText);
                        if (!opcao) return false;
                        nativeSelect.value = opcao.value;
                        if (labelVisual) labelVisual.innerText = targetText;
                        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }, decisaoAluno.atitudeAlvo);

                    await sleep(1000, 1500);

                    // --- SANFONA 1: Habilidades ---
                    const headerHabilidades = 'div[id="formAtitudes:panelAtitudes:accordionHabilidades_header"]';
                    const habilidadesExpandidaPeloBot = await this.page.evaluate((sel) => {
                        const header = document.querySelector(sel);
                        if (header) {
                            const isExpanded = header.getAttribute('aria-expanded') === 'true' || 
                                               header.classList.contains('ui-state-active') || 
                                               header.classList.contains('ui-accordion-header-active');
                            if (!isExpanded) {
                                header.click();
                                return true;
                            }
                        }
                        return false;
                    }, headerHabilidades);
                    
                    if (habilidadesExpandidaPeloBot) await sleep(800, 1200);
                    else await sleep(200, 400);

                    await this.page.waitForSelector('button[id="formAtitudes:panelAtitudes:importarConceitos"]', { visible: true, timeout: 5000 });
                    await this.page.click('button[id="formAtitudes:panelAtitudes:importarConceitos"]');
                    await sleep(1500, 2000); 
                    
                    await this.page.evaluate(() => {
                        const d = document.querySelector('div[id="confirmDialogConceitos"]');
                        if (d && d.style.display !== 'none') {
                            const b = Array.from(d.querySelectorAll('button')).find(btn => btn.innerText.includes('Confirmar'));
                            if (b) b.click();
                        }
                    });
                    await sleep(2500, 3500);

                    // =========================================================================
                    // ETAPA EXTRA EXCLUSIVA: VALIDAÇÃO E PREENCHIMENTO MANUAL FORÇADO
                    // =========================================================================
                    const precisaPreencherManual = await this.page.evaluate(() => {
                        // Captura todas as linhas da tabela de habilidades dinamicamente
                        const linhasHabilidades = document.querySelectorAll('tbody[id="formAtitudes:panelAtitudes:dataTableHabilidades_data"] tr');
                        if (linhasHabilidades.length === 0) return true; // Se não carregou, falhou
                        
                        // Faz um FOR passando por TODAS as habilidades do aluno na tela
                        for (let k = 0; k < linhasHabilidades.length; k++) {
                            const selectEl = document.getElementById(`formAtitudes:panelAtitudes:dataTableHabilidades:${k}:notaConceito_input`);
                            const labelEl = document.getElementById(`formAtitudes:panelAtitudes:dataTableHabilidades:${k}:notaConceito_label`);
                            
                            let val = "";
                            if (selectEl) {
                                val = selectEl.value ? selectEl.value.trim().toUpperCase() : "";
                            } else if (labelEl) {
                                val = labelEl.innerText ? labelEl.innerText.trim().toUpperCase() : "";
                            }
                            
                            // Se encontrar pelo menos UMA habilidade vazia ou diferente do padrão (A ou B)
                            if (val !== 'A' && val !== 'B') {
                                return true; // Retorna true para acionar a varredura corretiva manual
                            }
                        }
                        return false; // Todas estão perfeitas
                    });

                    if (precisaPreencherManual) {
                        this.addLog(`⚠️ Importação falhou ou ficou incompleta. Forçando preenchimento manual "humanizado" para [${decisaoAluno.conceitoNormalizado}] nas habilidades faltantes...`);
                        
                        const totalHabilidades = await this.page.evaluate(() => {
                            return document.querySelectorAll('tbody[id="formAtitudes:panelAtitudes:dataTableHabilidades_data"] tr').length;
                        });

                        let totalInjetados = 0;

                        // Loop Humanizado: Passa por todas corrigindo apenas as que o botão do SGN não preencheu
                        for (let j = 0; j < totalHabilidades; j++) {
                            const alterouLinha = await this.page.evaluate((index, conceitoAlvo) => {
                                const idBase = `formAtitudes:panelAtitudes:dataTableHabilidades:${index}:notaConceito`;
                                const select = document.getElementById(`${idBase}_input`);
                                const labelVisual = document.getElementById(`${idBase}_label`);
                                
                                if (select) {
                                    // Só altera se a nota atual for diferente da nota alvo calculada do aluno
                                    const notaAtual = select.value ? select.value.trim().toUpperCase() : "";
                                    if (notaAtual !== conceitoAlvo) {
                                        select.value = conceitoAlvo;
                                        if (labelVisual) labelVisual.innerText = conceitoAlvo;
                                        
                                        // Fogo! Dispara o AJAX do PrimeFaces
                                        select.dispatchEvent(new Event('change', { bubbles: true }));
                                        return true;
                                    }
                                }
                                return false;
                            }, j, decisaoAluno.conceitoNormalizado);

                            if (alterouLinha) {
                                totalInjetados++;
                                // O SEGREDO: Espera o SGN respirar antes de preencher a próxima linha
                                await sleep(800, 1200); 
                            }
                        }

                        if (totalInjetados > 0) {
                            this.addLog(`⚡ Sucesso: ${totalInjetados} habilidades preenchidas ou corrigidas individualmente com [${decisaoAluno.conceitoNormalizado}].`);
                            await sleep(1000, 1500); 
                        }
                        
                    } else {
                        this.addLog("✅ Confirmação: Todas as habilidades foram importadas com sucesso automaticamente na primeira tentativa.");
                    }
                    // =========================================================================

                    // --- SANFONA 2: Socioemocionais ---
                    const headerSocio = 'div[id="formAtitudes:panelAtitudes:accordionHabilidadesSocioemocionais_header"]';
                    const socioExpandidaPeloBot = await this.page.evaluate((sel) => {
                        const header = document.querySelector(sel);
                        if (header) {
                            const isExpanded = header.getAttribute('aria-expanded') === 'true' || 
                                               header.classList.contains('ui-state-active') || 
                                               header.classList.contains('ui-accordion-header-active');
                            if (!isExpanded) {
                                header.click();
                                return true;
                            }
                        }
                        return false;
                    }, headerSocio);

                    if (socioExpandidaPeloBot) await sleep(800, 1200);
                    else await sleep(200, 400);

                    await this.page.waitForSelector('button[id="formAtitudes:panelAtitudes:importarObservacoes"]', { visible: true, timeout: 5000 });
                    await this.page.click('button[id="formAtitudes:panelAtitudes:importarObservacoes"]');
                    await sleep(1500, 2000);
                    
                    await this.page.evaluate(() => {
                        const d = document.querySelector('div[id="confirmDialogObservacoes"]');
                        if (d && d.style.display !== 'none') {
                            const b = Array.from(d.querySelectorAll('button')).find(btn => btn.innerText.includes('Confirmar'));
                            if (b) b.click();
                        }
                    });

                    await sleep(3000, 4000);
                    
                    await this._saveAndCloseModal();
                    
                    await sleep(2500, 3500); 
                    this.totalStudentsProcessed++;
                    this.addLog(`✅ Aluno ${i + 1} concluído.`);

                } catch (erroInterno) {
                    this.addLog(`❌ Falha no processamento do modal do aluno ${i + 1}: ${erroInterno.message}. Fechando modal e pulando para o próximo.`);
                    // Gatilho de segurança: força o fechamento do modal caso ele tenha travado aberto devido a erro
                    await this.page.evaluate(() => {
                        const btnClose = document.querySelector('div[id*="modalDadosAtitudes"] a.ui-dialog-titlebar-close');
                        if (btnClose) btnClose.click();
                    }).catch(() => {});
                    await sleep(2000);
                }
            } // Fim do FOR

            return true;
        } catch (error) {
            this.addLog(`❌ Erro crítico no fluxo de conceitos: ${error.message}`);
            return false;
        }
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
    // ================= FASE 2: PEDAGÓGICO =================
    async _processPedagogicalPhase() {
        try {
            this.addLog("📚 Iniciando Fase 2: Lançamento de Pareceres Pedagógicos...");

            // 1. Clica na aba pedagógica de forma blindada (sem usar o helper antigo que quebrava)
            const abaClicada = await this.page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const alvo = links.find(l => l.innerText && l.innerText.toUpperCase().includes('PEDAGÓGICO'));
                if (alvo) {
                    alvo.click();
                    return true;
                }
                return false;
            });

            if (!abaClicada) {
                this.addLog("⚠️ Aba 'Pedagógico' não encontrada pelo texto. Tentando seletor alternativo...");
                await this.page.click('li a[href*="Pedagogico"], a[href*="pedagogico"]');
            }
            
            await sleep(3000, 4000); // Aguarda o SGN carregar a aba

            // 2. Captura os estudantes do select nativo oculto
            const estudantes = await this.page.evaluate(() => {
                const nativeSelect = document.querySelector('select[id*="selectEstudantes_input"]');
                return nativeSelect ? Array.from(nativeSelect.options)
                    .filter(o => o.value && o.value !== "" && o.text && o.text.trim().toUpperCase() !== "SELECIONE" && o.text.trim().toUpperCase() !== "&NBSP;")
                    .map(o => o.text.trim()) : [];
            });

            this.addLog(`👥 Total de ${estudantes.length} alunos mapeados para preenchimento de parecer.`);

            const trAlvo = (this.trSelection || 'TR1').toUpperCase();
            
            // Suporta a propriedade de pareceres independente do nome usado no seu arquivo original
            const dbPareceres = this.pareceresDb || this.PARECERES || {};

            for (let i = 0; i < estudantes.length; i++) {
                const nomeAluno = estudantes[i];
                if (!nomeAluno) continue; // Blinda contra nomes vazios

                this.addLog(`\n👤 [Aluno ${i + 1}/${estudantes.length}] Parecer: ${nomeAluno}`);

                try {
                    // Garante que a interface não deslogou ou mudou de aba acidentalmente
                    await this.page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a'));
                        const alvo = links.find(l => l.innerText && l.innerText.toUpperCase().includes('PEDAGÓGICO'));
                        const ativo = document.querySelector('.ui-tabs-selected a, .ui-state-active a');
                        if (ativo && !ativo.innerText.toUpperCase().includes('PEDAGÓGICO') && alvo) {
                            alvo.click();
                        }
                    });

                    // 3. Seleciona o aluno no dropdown inteligente do PrimeFaces
                    await this.page.waitForSelector('div[id*="selectEstudantes"] .ui-selectonemenu-trigger', { visible: true, timeout: 10000 });
                    await this.page.click('div[id*="selectEstudantes"] .ui-selectonemenu-trigger');
                    await sleep(1000);
                    
                    await this.page.evaluate((nome) => {
                        const itens = Array.from(document.querySelectorAll('li.ui-selectonemenu-item'));
                        const alvo = itens.find(li => li.innerText && li.innerText.trim() === nome);
                        if (alvo) alvo.click();
                    }, nomeAluno);

                    await sleep(4000, 5000); // Aguarda carga pesada dos dados do aluno no SGN

                    // 4. Garante as sanfonas de Desempenho e Média abertas para a textarea aparecer
                    await this.page.evaluate(() => {
                        const headers = Array.from(document.querySelectorAll('.ui-accordion-header'));
                        const hDesempenho = headers.find(h => h.id.includes('sanfonaDesempenho') && !h.id.includes('sanfonaMedia'));
                        if (hDesempenho && !hDesempenho.classList.contains('ui-state-active')) hDesempenho.click();
                    });
                    await sleep(1500);

                    await this.page.evaluate(() => {
                        const headers = Array.from(document.querySelectorAll('.ui-accordion-header'));
                        const hMedia = headers.find(h => h.id.includes('sanfonaMedia') || h.id.includes('sanfonaParecer'));
                        if (hMedia && !hMedia.classList.contains('ui-state-active')) hMedia.click();
                    });
                    await sleep(1500);

                    // 5. Detecta visualmente o conceito final daquele aluno lendo a tabela
                    let conceitoFinal = await this.page.evaluate((tr) => {
                        const linhas = Array.from(document.querySelectorAll('tbody[id*="desempenhoMedias_data"] tr, tbody[id*="Medias"] tr'));
                        
                        const extrairConceito = (linha) => {
                            if (!linha) return null;
                            const tds = Array.from(linha.querySelectorAll('td'));
                            for (const td of tds) {
                                if (td.querySelector('textarea')) continue;
                                const txt = td.innerText.trim().toUpperCase();
                                if (['A', 'B', 'C', 'NE'].includes(txt)) return txt;
                                const internos = td.querySelectorAll('span, label');
                                for (const el of internos) {
                                    const t = el.innerText.trim().toUpperCase();
                                    if (['A', 'B', 'C', 'NE'].includes(t)) return t;
                                }
                            }
                            return null;
                        };

                        const linhaTr = linhas.find(t => t.innerText.toUpperCase().includes(tr));
                        let c = extrairConceito(linhaTr);
                        if (c) return c;

                        const linhaCF = linhas.find(t => t.innerText.toUpperCase().includes('FINAL') || t.innerText.toUpperCase().includes('CF'));
                        c = extrairConceito(linhaCF);
                        if (c) return c;

                        for (const linha of linhas) {
                            c = extrairConceito(linha);
                            if (c) return c;
                        }
                        return null;
                    }, trAlvo);

                    if (!conceitoFinal) {
                        this.addLog(`  ⏭️ Ignorado: Conceito Final (CF) não preenchido ou em branco.`);
                        continue; // Interrompe as ações deste aluno e vai direto para o próximo
                    } else {
                        this.addLog(`  🎯 Conceito detectado: [${conceitoFinal}]`);
                    }
                    
                    // 6. Sorteia o parecer dentro do JSON
                    const opcoes = dbPareceres[conceitoFinal] || dbPareceres["B"] || ["Parecer padrão de desempenho acadêmico."];
                    const textoParecer = opcoes[Math.floor(Math.random() * opcoes.length)];

                    // 7. Encontra a textarea correta e injeta o texto com disparos nativos
                    const textareaId = await this.page.evaluate((tr) => {
                        const linhas = Array.from(document.querySelectorAll('tbody[id*="desempenhoMedias_data"] tr, tbody[id*="Medias"] tr'));
                        let linhaAlvo = linhas.find(t => t.innerText.toUpperCase().includes(tr));
                        if (!linhaAlvo) linhaAlvo = linhas.find(t => t.innerText.toUpperCase().includes('FINAL') || t.innerText.toUpperCase().includes('CF'));
                        if (!linhaAlvo && linhas.length > 0) linhaAlvo = linhas.find(t => t.querySelector('textarea'));
                        
                        if (linhaAlvo) {
                            const txt = linhaAlvo.querySelector('textarea');
                            return txt ? txt.id : null;
                        }
                        const qualquerTextarea = document.querySelector('div[id*="sanfonaMedia"] textarea, div[id*="sanfonaDesempenho"] textarea');
                        return qualquerTextarea ? qualquerTextarea.id : null;
                    }, trAlvo);

                    if (textareaId) {
                        await this.page.evaluate((id, txt) => { 
                            const el = document.getElementById(id);
                            if (el) {
                                el.value = txt; 
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                el.dispatchEvent(new Event('blur', { bubbles: true }));
                            }
                        }, textareaId, textoParecer);
                        
                        await sleep(1500);
                        
                        // Clica em Salvar Parecer/Desempenho
                        await this.page.evaluate(() => {
                            const btn = document.querySelector('button[id*="botaoSalvarDesempenho"], button[id*="SalvarDesempenho"], button[id*="btnSalvar"]');
                            if (btn) btn.click();
                        });
                        await sleep(3500, 4500); 
                        
                        this.addLog(`  ✅ Parecer salvo com sucesso!`);
                    } else {
                        this.addLog(`  ❌ Erro: Caixa de texto do período [${trAlvo}] não encontrada.`);
                    }
                } catch (erroAluno) {
                    this.addLog(`  ❌ Erro isolado ao preencher parecer deste aluno: ${erroAluno.message}`);
                }
            }
            return true;
        } catch (error) {
            this.addLog(`❌ Erro crítico no fluxo da fase pedagógica: ${error.message}`);
            return false;
        }
    }





//    async _processConceptsPhase() {
//         try {
//             this.addLog("🔄 Iniciando varredura combinada (Trava de Lápis Verde + Regra de CF)...");
//             const seletorTabela = this.tableBodySelector;
            
//             const totalAlunos = await this.page.evaluate((tableSelector) => {
//                 return document.querySelectorAll(`${tableSelector} tr[data-ri]`).length;
//             }, seletorTabela);

//             this.addLog(`👥 Total de ${totalAlunos} alunos encontrados. Analisando status dos lápis...`);

//             for (let i = 0; i < totalAlunos; i++) {
//                 const linhaSelector = `${seletorTabela} tr[data-ri="${i}"]`;
//                 await this.page.waitForSelector(linhaSelector, { visible: true, timeout: 5000 });

//                 const decisaoAluno = await this.page.evaluate((index, tableSelector) => {
//                     const linha = document.querySelector(`${tableSelector} tr[data-ri="${index}"]`);
//                     if (!linha) return { acao: 'pular', motivo: 'Linha não encontrada', nome: 'Desconhecido' };
//                     const celulas = Array.from(linha.querySelectorAll('td'));
//                     const nome = celulas[1] ? celulas[1].innerText.trim() : `Aluno ${index + 1}`;

//                     const linkEditar = linha.querySelector('a[id*="linkEditarAtitudes"]');
//                     if (linkEditar) {
//                         const titulo = linkEditar.getAttribute('title') || '';
//                         const estilo = linkEditar.getAttribute('style') || '';
//                         if (titulo.includes('(Preenchido)') || estilo.includes('color:#00b900') || estilo.includes('color: rgb(0, 185, 0)')) {
//                             return { acao: 'pular', motivo: 'Lápis já está Verde (Preenchido)', nome: nome };
//                         }
//                     }

//                     const selectCF = linha.querySelector('select[id*="comboConceitoFinal_input"], select[id*="conceitoFinal"]');
//                     let valorCF = "";
//                     if (selectCF && selectCF.value) {
//                         valorCF = selectCF.value.trim().toUpperCase();
//                     } else {
//                         const labelCF = linha.querySelector('label[id*="comboConceitoFinal_label"]');
//                         if (labelCF && labelCF.innerText) valorCF = labelCF.innerText.trim().toUpperCase();
//                     }

//                     if (valorCF === 'C' || valorCF === 'PIA') {
//                         return { acao: 'pular', motivo: 'Possui Conceito Final C (PIA)', nome: nome };
//                     }

//                     let atitudeAlvo = "PAP";
//                     if (valorCF === 'A' || valorCF === 'PAP') atitudeAlvo = "PAP";
//                     else if (valorCF === 'B' || valorCF === 'POD') atitudeAlvo = "POD";

//                     return { acao: 'processar', atitudeAlvo: atitudeAlvo, nome: nome };
//                 }, i, seletorTabela);

//                 if (decisaoAluno.acao === 'pular') {
//                     this.addLog(`⏭️ [Aluno ${i + 1}/${totalAlunos}] ${decisaoAluno.nome} ignorado ➔ Motivo: ${decisaoAluno.motivo}.`);
//                     continue;
//                 }

//                 this.addLog(`\n👤 [Aluno ${i + 1}/${totalAlunos}] Processando: ${decisaoAluno.nome} ➔ Alvo: [${decisaoAluno.atitudeAlvo}]`);

//                 const lapisSelector = `${linhaSelector} a[id*="linkEditarAtitudes"]`;
//                 await this.page.waitForSelector(lapisSelector, { visible: true, timeout: 10000 });
//                 await this.page.evaluate((sel) => {
//                     const el = document.querySelector(sel);
//                     if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
//                 }, lapisSelector);
                
//                 await this.page.waitForSelector('div[id*="formAtitudes:panelMediaParcialEstudante"]', { visible: true, timeout: 15000 });
//                 await sleep(1000, 1500);

//                 await this.page.evaluate((targetText) => {
//                     const nativeSelect = document.querySelector('select[id="formAtitudes:mediaParcialEstudante_input"]');
//                     const labelVisual = document.querySelector('label[id="formAtitudes:mediaParcialEstudante_label"]');
//                     if (!nativeSelect) return false;
//                     const opcao = Array.from(nativeSelect.options).find(o => o.text.trim().toUpperCase() === targetText);
//                     if (!opcao) return false;
//                     nativeSelect.value = opcao.value;
//                     if (labelVisual) labelVisual.innerText = targetText;
//                     nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
//                     return true;
//                 }, decisaoAluno.atitudeAlvo);

//                 await sleep(1000, 1500);

//                 // --- SANFONA 1: Conceitos das Habilidades ---
//                 const headerHabilidades = 'div[id="formAtitudes:panelAtitudes:accordionHabilidades_header"]';
//                 await this.page.waitForSelector(headerHabilidades, { visible: true, timeout: 5000 });
                
//                 const habilidadesPrefechada = await this.page.evaluate((sel) => {
//                     const header = document.querySelector(sel);
//                     if (header) {
//                         const isExpanded = header.getAttribute('aria-expanded') === 'true' || 
//                                            header.classList.contains('ui-state-active');
//                         if (!isExpanded) {
//                             header.click(); // SÓ clica se NÃO estiver expandida
//                             return true;
//                         }
//                     }
//                     return false;
//                 }, headerHabilidades);
                
//                 if (habilidadesPrefechada) {
//                     await sleep(1000, 1500); // Espera a animação de abrir abrir
//                 }

//                 await this.page.waitForSelector('button[id="formAtitudes:panelAtitudes:importarConceitos"]', { visible: true, timeout: 5000 });
//                 await this.page.click('button[id="formAtitudes:panelAtitudes:importarConceitos"]');
//                 await sleep(1500, 2000); 
                
//                 await this.page.evaluate(() => {
//                     const d = document.querySelector('div[id="confirmDialogConceitos"]');
//                     if (d && d.style.display !== 'none') {
//                         const b = Array.from(d.querySelectorAll('button')).find(btn => btn.innerText.includes('Confirmar'));
//                         if (b) b.click();
//                     }
//                 });
//                 await sleep(2500, 3500);

//                 // --- SANFONA 2: Observações Socioemocionais ---
//                 const headerSocio = 'div[id="formAtitudes:panelAtitudes:accordionHabilidadesSocioemocionais_header"]';
//                 await this.page.waitForSelector(headerSocio, { visible: true, timeout: 5000 });
                
//                 const socioPrefechada = await this.page.evaluate((sel) => {
//                     const header = document.querySelector(sel);
//                     if (header) {
//                         const isExpanded = header.getAttribute('aria-expanded') === 'true' || 
//                                            header.classList.contains('ui-state-active');
//                         if (!isExpanded) {
//                             header.click(); // SÓ clica se NÃO estiver expandida
//                             return true;
//                         }
//                     }
//                     return false;
//                 }, headerSocio);

//                 if (socioPrefechada) {
//                     await sleep(1000, 1500); // Espera a animação de abrir
//                 }

//                 await this.page.waitForSelector('button[id="formAtitudes:panelAtitudes:importarObservacoes"]', { visible: true, timeout: 5000 });
//                 await this.page.click('button[id="formAtitudes:panelAtitudes:importarObservacoes"]');
//                 await sleep(1500, 2000);
                
//                 await this.page.evaluate(() => {
//                     const d = document.querySelector('div[id="confirmDialogObservacoes"]');
//                     if (d && d.style.display !== 'none') {
//                         const b = Array.from(d.querySelectorAll('button')).find(btn => btn.innerText.includes('Confirmar'));
//                         if (b) b.click();
//                     }
//                 });

//                 await sleep(3000, 4000);
                
//                 // Salva e fecha o modal usando o método inteligente da classe
//                 await this._saveAndCloseModal();
                
//                 await sleep(2500, 3500); 
//                 this.addLog(`✅ Aluno ${i + 1} concluído.`);
//             }
//             return true;
//         } catch (error) {
//             this.addLog(`❌ Erro no fluxo de conceitos: ${error.message}`);
//             return false;
//         }
//     }

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
            this.addLog("🔎 Iniciando auditoria e verificação da tradução automática dos conceitos (PAP/POD/PIA)...");

            // Recarrega/garante leitura da tabela ativa
            const seletorTabela = this.tableBodySelector || 'tbody[id*="tabelaConceitos"]';
            
            // Avalia a integridade de cada linha diretamente no contexto do navegador
            const integridadeValida = await this.page.evaluate((tableSelector) => {
                const linhas = Array.from(document.querySelectorAll(`${tableSelector} tr[data-ri]`));
                if (linhas.length === 0) return false;

                let tudoCerto = true;

                for (const linha of linhas) {
                    // Busca pelo texto parcial (PAP, POD ou PIA) gravado na linha do aluno
                    const textoLinha = linha.innerText ? linha.innerText.toUpperCase() : '';
                    
                    // Acha o combobox do Conceito Final (CF) correspondente na mesma linha
                    const selectCF = linha.querySelector('select[id*="conceitoFinal"], select[id*="comboConceitoFinal"]');
                    if (!selectCF) continue;

                    const valorSelecionadoCF = selectCF.value; // Geralmente 'A', 'B', 'C'

                    // Validação das Regras de Negócio estipuladas
                    if (textoLinha.includes('PAP') && valorSelecionadoCF !== 'A') {
                        tudoCerto = false;
                        linha.style.backgroundColor = '#ffcccc'; // Marca visualmente o erro na tela (Modo visível)
                    } else if (textoLinha.includes('POD') && valorSelecionadoCF !== 'B') {
                        tudoCerto = false;
                        linha.style.backgroundColor = '#ffcccc';
                    } else if (textoLinha.includes('PIA') && valorSelecionadoCF !== 'C') {
                        tudoCerto = false;
                        linha.style.backgroundColor = '#ffcccc';
                    }
                }

                return tudoCerto;
            }, seletorTabela);

            if (integridadeValida) {
                this.addLog("✅ Auditoria Concluída: Todos os conceitos importados batem com as regras (PAP=A, POD=B, PIA=C).");
                return true;
            } else {
                this.addLog("⚠️ Inconsistência Detectada: Existem alunos cujo conceito final (CF) não corresponde ao resultado importado.");
                return false;
            }

        } catch (error) {
            this.addLog(`❌ Erro durante a verificação de integridade: ${error.message}`);
            return false;
        }
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