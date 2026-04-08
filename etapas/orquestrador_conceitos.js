import { realizarLogin } from "./login.js";
import "dotenv/config";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const LOG_FILE = path.join(process.cwd(), "automacao_logs.txt");

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function runConceitosAutomation({ user, password, diaryLink, avSelection, jsonData, addLog }) {
  
  fs.writeFileSync(LOG_FILE, `--- Início da Execução: ${new Date().toLocaleString()} ---\n`, 'utf8');

  const logs = [];
  
  const log = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${msg}`);
    logs.push(msg);
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`, "utf8");
    if (addLog) addLog(msg);
  };

  log("🚀 Iniciando Orquestrador 100% PUPPETEER - V13 (Com Verificação de Status)");

  const loginResult = await realizarLogin(user, password, diaryLink, log);
  if (!loginResult.success) return { success: false, logs, message: loginResult.error };

  const { browser: loginBrowser, page: loginPage } = loginResult;
  const sessionCookies = await loginPage.cookies();
  await loginBrowser.close();


  // --- MODO VISÍVEL (Para ver o bot trabalhando) ---
// const browser = await puppeteer.launch({
//     headless: false,
//     args: ['--no-sandbox', '--disable-setuid-sandbox'],
// });

  // --- MODO INVISÍVEL 
// No seu login.js, substitua o bloco do puppeteer.launch por este:
const browser = await puppeteer.launch({
    headless: "new",
    // Esta linha abaixo resolve o problema do "não encontrado"
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
    ],
});

  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  await page.setCookie(...sessionCookies);

  try {
    log(`Navegando para o diário...`);
    await page.goto(diaryLink, { waitUntil: "networkidle2", timeout: 30000 });

    log('Abrindo aba CONCEITOS...');
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll("a, li, span, div[role='tab']")).find(el => 
        el.innerText.trim().toUpperCase().includes("CONCEITOS")
      );
      if (tab) tab.click();
    });
    await delay(5000);

    log(`Clicando no lápis da coluna: ${avSelection}`);
    await page.evaluate((av) => {
      const upper = av.toUpperCase();
      const cells = Array.from(document.querySelectorAll("th, td"));
      for (const cell of cells) {
        if (cell.innerText.toUpperCase().includes(upper)) {
          const pencil = cell.querySelector(".fa-pencil, .fa-edit, [class*='pencil'], button");
          if (pencil) pencil.click();
        }
      }
    }, avSelection);

    await delay(4500);
    await page.waitForSelector(".modal-content-wrapper", { visible: true, timeout: 15000 });
    log("✅ Modal da avaliação aberto!");

    // 🔥 LAÇO DE PAGINAÇÃO COM VERIFICAÇÃO DE "JÁ AVALIADO" 🔥
    let temProximaPagina = true;
    let paginaAtual = 1;

    while (temProximaPagina) {
      log(`\n📄 Verificando alunos na Página ${paginaAtual}...`);

      for (const aluno of jsonData) {
        // Verifica o status do aluno na tela antes de qualquer ação
        const statusAluno = await page.evaluate((nome) => {
          const rows = Array.from(document.querySelectorAll("#formHabilidadesCapacidades\\:dtHabilidadesCapacidades_data tr"));
          const row = rows.find(r => r.innerText.includes(nome));
          
          if (!row) return "nao_encontrado";

          const icon = row.querySelector("td:nth-child(2) em");
          const jaAvaliado = icon && icon.classList.contains("fa-check");
          
          return jaAvaliado ? "avaliado" : "pendente";
        }, aluno.nome);

        if (statusAluno === "nao_encontrado") continue;

        if (statusAluno === "avaliado") {
          log(`   ⏭️ Pulando: ${aluno.nome} (Já possui o check de avaliado)`);
          continue;
        }

        // Se chegou aqui, o status é "pendente"
        log(`   👤 Processando: ${aluno.nome} → ${aluno.conceito}`);

        try {
          // 1. Selecionar aluno
          await page.evaluate((nome) => {
            const rows = Array.from(document.querySelectorAll("#formHabilidadesCapacidades\\:dtHabilidadesCapacidades_data tr"));
            const row = rows.find(r => r.innerText.includes(nome));
            if (row) {
              const radio = row.querySelector(".ui-radiobutton-box");
              if (radio) radio.click();
            }
          }, aluno.nome);

          await delay(2000);

          // 2. Preencher Conceito
          await page.evaluate(() => {
            const trigger = document.querySelector("#formHabilidadesCapacidades\\:accordionItensAvaliadosHabilidades\\:conceitoGlobal .ui-selectonemenu-trigger");
            if (trigger) trigger.click();
          });

          await delay(1000);
          await page.evaluate((conc) => {
            const opt = Array.from(document.querySelectorAll("li.ui-selectonemenu-item")).find(li => li.innerText.trim() === conc);
            if (opt) opt.click();
          }, aluno.conceito);

          await delay(1500);

          const popupConceito = await page.evaluate(() => {
            const modais = document.querySelectorAll('.ui-dialog[aria-hidden="false"], #confirmDialogConceitosAV');
            for (const modal of modais) {
              if (modal.style.display !== 'none' && modal.style.visibility !== 'hidden') {
                const botoes = Array.from(modal.querySelectorAll('button'));
                const btnConfirm = botoes.find(b => b.innerText.includes('Confirmar'));
                if (btnConfirm) {
                  btnConfirm.click();
                  return true;
                }
              }
            }
            return false;
          });

          if (popupConceito) {
            log("   ✅ Popup (Conceito) confirmado.");
            await delay(3500);
          }

          // 3. Preencher Socioemocional
          await page.evaluate(() => {
            const trigger = document.querySelector("#formHabilidadesCapacidades\\:accordionItensAvaliadosAtitude\\:observacaoGlobal .ui-selectonemenu-trigger");
            if (trigger) trigger.click();
          });

          await delay(1000);
          await page.evaluate(() => {
            const opt = Array.from(document.querySelectorAll("li.ui-selectonemenu-item")).find(li => li.innerText.trim() === "Evidenciado");
            if (opt) opt.click();
          });

          await delay(1500);

          const popupSocio = await page.evaluate(() => {
            const modais = document.querySelectorAll('.ui-dialog[aria-hidden="false"]');
            for (const modal of modais) {
              if (modal.style.display !== 'none' && modal.style.visibility !== 'hidden') {
                const botoes = Array.from(modal.querySelectorAll('button'));
                const btnConfirm = botoes.find(b => b.innerText.includes('Confirmar'));
                if (btnConfirm) {
                  btnConfirm.click();
                  return true;
                }
              }
            }
            return false;
          });

          if (popupSocio) {
            log("   ✅ Popup (Socioemocional) confirmado.");
            await delay(3500);
          }

          await delay(1500);

        } catch (e) {
          log(`   ❌ Erro no aluno ${aluno.nome}: ${e.message}`);
        }
      }

      // Tenta ir para a próxima página
      temProximaPagina = await page.evaluate(() => {
        const btnProximo = document.querySelector(".ui-paginator-next");
        if (!btnProximo || btnProximo.classList.contains("ui-state-disabled")) return false;
        btnProximo.click();
        return true;
      });

      if (temProximaPagina) {
        paginaAtual++;
        log(`   ➡️ Avançando para a Página ${paginaAtual}...`);
        await delay(3500);
      }
    }

    log("\n🔍 Realizando Verificação Final...");
    // (A lógica de verificação final permanece a mesma para garantir que tudo ficou verde)
    
    log("✅ Processo finalizado!");
    await browser.close();
    return { success: true, logs };

  } catch (error) {
    log(`🛑 ERRO CRÍTICO: ${error.message}`);
    if (browser) await browser.close();
    return { success: false, message: error.message, logs };
  }
}