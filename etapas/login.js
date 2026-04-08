import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Adiciona os plugins de disfarce para evitar bloqueios
puppeteer.use(StealthPlugin());

/**
 * Etapa 1: Realiza o login no SGN e redireciona para o link alvo (Diário)
 * * @param {string} user - Usuário de acesso
 * @param {string} password - Senha de acesso
 * @param {string} targetUrl - Link do diário que deve ser aberto após o login
 * @param {function} addLog - Função de callback para registrar os logs no servidor/interface
 * @returns {object} Retorna o { browser, page, success } para ser usado nas próximas etapas
 */
export async function realizarLogin(user, password, targetUrl, addLog) {
    addLog(`[Login] Iniciando navegador...`);
    
// MODO VISIVEL
    // const browser = await puppeteer.launch({
    //     headless: false, // Abre o navegador na sua tela
    //     slowMo: 50,      // Opcional: reduz a velocidade para você conseguir acompanhar o que ele faz
    //     args: [
    //         '--no-sandbox',
    //         '--disable-setuid-sandbox'
    //     ],
    // });


    // MODO INVISIVEL    
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
    await page.setViewport({ width: 1366, height: 768 });

    try {
        addLog(`[Login] Acessando URL inicial: ${targetUrl}`);
        // Acessa o link. Se não estiver logado, o SGN vai mostrar o botão de Entrar
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // 1. Verifica se existe o botão "Entrar com FIESC" (Página pré-IDP)
        const fiescSelector = '#formLogin\\:entrar';
        const fiescBtn = await page.$(fiescSelector).catch(() => null);
        
        if (fiescBtn) {
            addLog('[Login] Botão "Entrar com FIESC" detectado. Indo para o IDP...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 80000 }),
                fiescBtn.click()
            ]);
        } else {
            // Pode ser que o botão seja outro dependendo da versão, tenta um genérico
            const btnGenerico = await page.$('button.ui-button span.ui-button-text');
            if (btnGenerico) {
                const text = await page.evaluate(el => el.innerText, btnGenerico);
                if (text.toLowerCase().includes('entrar') || text.toLowerCase().includes('login')) {
                    addLog('[Login] Botão genérico de Entrar detectado. Indo para o IDP...');
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 80000 }),
                        btnGenerico.click()
                    ]);
                }
            }
        }

        // Aguarda um pequeno delay para garantir que os campos do IDP renderizaram
        await new Promise(r => setTimeout(r, 6000));

        // 2. Preenche credenciais no IDP (se os campos existirem na tela)
        const userField = await page.$('#username').catch(() => null);
        
        if (userField) {
            addLog('[Login] Preenchendo usuário e senha...');
            await page.type('#username', user, { delay: 50 });
            await page.type('#password', password, { delay: 50 });

            addLog('[Login] Clicando em Log In e aguardando redirecionamento do IDP...');
            // O IDP faz vários redirecionamentos rápidos. Vamos clicar e esperar a navegação assentar.
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 80000 }).catch(() => {}),
                page.click('#login-botao')
            ]);
            
            // Espera extra garantida para o SGN processar o token do IDP e carregar a interface pesada
            addLog('[Login] Aguardando o carregamento da interface do SGN...');
            await new Promise(r => setTimeout(r, 10000));
        } else {
            addLog('[Login] ⚠️ Tela de credenciais não encontrada. Assumindo que já está logado ou houve erro.');
        }

        // 3. Garantia Final: Verificar se estamos no link correto após todo o fluxo
        const currentUrl = page.url();
        if (!currentUrl.includes(targetUrl.split('?')[0])) {
            addLog('[Login] Forçando navegação para o link exato do diário...');
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 10000)); // Espera o diário carregar
        }

        addLog('✅ Login concluído com sucesso!');
        
        // Retorna as instâncias para que o orquestrador passe para a próxima etapa
        return { 
            success: true, 
            browser, 
            page 
        };

    } catch (error) {
        addLog(`❌ [Login] Erro fatal: ${error.message}`);
        if (browser) await browser.close();
        return { 
            success: false, 
            error: error.message 
        };
    }
}