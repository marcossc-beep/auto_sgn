import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { query } from './db.js';
import fs from 'fs';
import { runRAAutomation } from './etapas/preenchedor_RA.js';
import multipart from '@fastify/multipart';

// Importação dos orquestradores
import { runConceitosAutomation } from './etapas/orquestrador_conceitos.js';
import { runPareceresAutomation } from './etapas/orquestrador_pareceres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fastify = Fastify({ logger: false });

// 1. Configuração de CORS (Essencial para evitar bloqueios de método)
await fastify.register(cors, { 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
});

if (!fastify.hasPlugin('@fastify/multipart')) {
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // Limite de 10MB por arquivo
    }
  });
}

const raUploadsDir = path.join(__dirname, 'uploads', 'RA');
if (!fs.existsSync(raUploadsDir)) {
  fs.mkdirSync(raUploadsDir, { recursive: true });
}

fastify.get('/api/ra/arquivos', async (request, reply) => {
  try {
    if (!fs.existsSync(raUploadsDir)) {
      return reply.send([]);
    }
    const arquivos = fs.readdirSync(raUploadsDir).filter(file => {
      // Ignora arquivos ocultos ou do sistema
      return !file.startsWith('.') && fs.statSync(path.join(raUploadsDir, file)).isFile();
    });
    return reply.send(arquivos);
  } catch (error) {
    return reply.status(500).send({ error: 'Erro ao listar arquivos de RA: ' + error.message });
  }
});

fastify.post('/api/ra/upload', async (request, reply) => {
  try {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Nenhum arquivo enviado.' });
    }

    const targetPath = path.join(raUploadsDir, data.filename);
    
    // Salva o arquivo na pasta uploads/RA utilizando stream
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(targetPath);
      data.file.pipe(writeStream);
      data.file.on('end', resolve);
      writeStream.on('error', reject);
    });

    return reply.send({ success: true, filename: data.filename });
  } catch (error) {
    return reply.status(500).send({ error: 'Falha no upload do arquivo: ' + error.message });
  }
});

fastify.post('/api/ra/iniciar', async (request, reply) => {
  const { 
    user, 
    password, 
    diaries,          
    capacidadesAlvo,  
    dataInicio, 
    dataTermino, 
    justificativa, 
    publicaOnline, 
    nomeArquivoRA,
    deletarNoFinal,
    trSelection
  } = request.body;

  // 1. Validação básica de campos obrigatórios
  if (!user || !password || !diaries || !dataInicio || !dataTermino || !justificativa || !nomeArquivoRA) {
    return reply.status(400).send({ error: 'Faltam informações obrigatórias para executar o robô de RA.' });
  }

  // 2. Camada de Validação estrita das Capacidades Alvo
  try {
    const capsObj = typeof capacidadesAlvo === 'string' ? JSON.parse(capacidadesAlvo) : capacidadesAlvo;
    if (!capsObj || typeof capsObj !== 'object' || Array.isArray(capsObj)) {
      return reply.status(400).send({ error: 'O JSON de capacidades vinculadas está vazio ou é inválido.' });
    }
    const habilidadesComC = Object.entries(capsObj).filter(
      ([_, conceito]) => String(conceito).toUpperCase() === 'C'
    );
    if (habilidadesComC.length !== 1) {
      return reply.status(400).send({ 
        error: `Regra de Negócio Violada: O plano de RA exige que EXATAMENTE uma capacidade seja marcada com o conceito C. Foram encontradas: ${habilidadesComC.length}` 
      });
    }
  } catch (jsonErr) {
    return reply.status(400).send({ error: 'Falha crítica ao decodificar o JSON das capacidades vinculadas.' });
  }

  const listaDiarios = Array.isArray(diaries) ? diaries : [diaries];
  const jobId = crypto.randomUUID();

  // Função assíncrona pura de processamento
  const executarLoteRA = async () => {
    jobs[jobId].status = 'running';
    const currentLogger = createJobLogger(jobId);
    
    try {
      for (let index = 0; index < listaDiarios.length; index++) {
        const linkDiario = listaDiarios[index].trim();
        if (!linkDiario) continue;

        currentLogger(`⏳ [Progresso ${index + 1}/${listaDiarios.length}] Iniciando motor no diário...`);
        
        const raData = {
          capacidadesAlvo: typeof capacidadesAlvo === 'string' ? JSON.parse(capacidadesAlvo) : capacidadesAlvo,
          dataInicio,
          dataTermino,
          justificativa,
          publicaOnline: !!publicaOnline,
          nomeArquivoRA,
          trSelection // <-- ADICIONADO AQUI DENTRO DO RADATA
        };

        await runRAAutomation({
          user,
          password,
          diaryLink: linkDiario,
          raData,
          addLog: currentLogger
        });
      }

      currentLogger('✅ Todos os diários selecionados foram processados!');
      
      if (deletarNoFinal) {
        const caminhoArquivo = path.join(raUploadsDir, nomeArquivoRA);
        if (fs.existsSync(caminhoArquivo)) {
          fs.unlinkSync(caminhoArquivo);
          currentLogger(`🗑️ Arquivo "${nomeArquivoRA}" removido do servidor conforme solicitado pelo toggle.`);
        }
      }

      jobs[jobId].status = 'completed';
    } catch (err) {
      currentLogger(`❌ Erro crítico durante a execução do lote de RA: ${err.message}`);
      jobs[jobId].status = 'failed';
    } finally {
      robotBusy = false;
      if (jobQueue.length > 0) {
        const nextJobId = jobQueue.shift();
        const nextJob = jobs[nextJobId];
        if (nextJob && nextJob.runner) {
          scheduleJob(nextJobId, nextJob.runner);
        }
      }
    }
  };

  // Cria a estrutura inicial na memória global de jobs
  jobs[jobId] = {
    status: 'queued',
    logs: [],
    diaries: listaDiarios,
    runner: executarLoteRA
  };

  const initLogger = createJobLogger(jobId);
  initLogger(`📋 Job de RA criado. ${listaDiarios.length} diário(s) na fila.`);

  // Aciona o agendador unificado sem duplicar flags de ocupado
  if (robotBusy) {
    jobQueue.push(jobId);
    initLogger(`⏳ Servidor ocupado. Sua automação de RA entrou na fila global (Posição: ${getQueuePosition(jobId)}).`);
  } else {
    scheduleJob(jobId, executarLoteRA);
  }

  return reply.send({ success: true, jobId });
});
// ==========================================

// Armazém de logs em memória
const jobs = {};
let robotBusy = false;
const jobQueue = [];

function getQueuePosition(jobId) {
  return jobQueue.indexOf(jobId) + 1;
}

function createJobLogger(jobId) {
  return (msg) => {
    const time = new Date().toLocaleTimeString();
    jobs[jobId].logs.push(`[${time}] ${msg}`);
  };
}

function scheduleJob(jobId, runner) {
  jobs[jobId] = {
    status: 'queued',
    logs: [],
    runner
  };
  jobQueue.push(jobId);
  const position = jobQueue.length;
  if (!robotBusy) {
    startNextJob();
  }
  return position;
}

function startNextJob() {
  if (robotBusy || jobQueue.length === 0) return;

  const nextJobId = jobQueue.shift();
  const job = jobs[nextJobId];
  if (!job) return;

  robotBusy = true;
  job.status = 'running';
  const addLog = createJobLogger(nextJobId);
  addLog('🤖 Robô liberado. Iniciando processo.');

  job.runner()
    .then(() => {
      job.status = 'completed';
      addLog('✅ Processo finalizado.');
    })
    .catch(err => {
      job.status = 'error';
      addLog(`❌ ERRO: ${err.message}`);
    })
    .finally(() => {
      robotBusy = false;
      startNextJob();
    });
}

// --- AS ROTAS DA API DEVEM VIR PRIMEIRO ---

// Rota de Status
fastify.get('/api/status/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const job = jobs[jobId];
  if (!job) {
    return {
      status: 'not_found',
      logs: ["⚠️ Job não encontrado."],
      robotAvailable: !robotBusy,
      queueLength: jobQueue.length
    };
  }

  const position = job.status === 'queued' ? getQueuePosition(jobId) : null;
  return {
    status: job.status,
    logs: job.logs,
    position,
    robotAvailable: !robotBusy,
    queueLength: jobQueue.length
  };
});

// Rota do Robô de Conceitos
fastify.post('/api/run-conceitos', async (request, reply) => {
  const { user, password, diaryLink, avSelection, jsonData, trSelection } = request.body;
  const jobId = crypto.randomUUID();

  // Se diaryLink for um ID (número) ou nome, resolve para pegar o link_diario real
  let resolvedDiaryLink = diaryLink;
  if (diaryLink && !diaryLink.startsWith('http')) {
    try {
      console.log(`🔍 Resolvendo diaryLink: ${diaryLink}`);
      // Tenta buscar por ID ou nome
      const result = await query('SELECT link_diario FROM UC WHERE id = $1 OR nome = $2 LIMIT 1', [parseInt(diaryLink) || 0, diaryLink]);
      if (result.rows.length > 0) {
        const linkFromDb = result.rows[0].link_diario;
        if (linkFromDb && linkFromDb.trim() !== '') {
          resolvedDiaryLink = linkFromDb;
          console.log(`✅ Link resolvido do banco: ${resolvedDiaryLink}`);
        } else {
          console.log(`⚠️ Banco retornou link_diario vazio. Usando valor original: ${diaryLink}`);
        }
      } else {
        console.log(`⚠️ UC não encontrada no banco (${diaryLink}). Tentando usar como URL direta...`);
      }
    } catch (err) {
      console.log('Aviso: Não conseguiu resolver diaryLink:', err.message);
      // Se falhar, usa o valor original
    }
  }

  // Normaliza o diaryLink para URL válida
  if (resolvedDiaryLink) {
    resolvedDiaryLink = resolvedDiaryLink.trim();
    // Se não for um URL completo, tenta completar com https://
    if (!resolvedDiaryLink.match(/^https?:\/\//i)) {
      if (resolvedDiaryLink.includes('.') || resolvedDiaryLink.includes('/')) {
        // Remove espaços excessivos e codifica
        const encoded = resolvedDiaryLink.split(' ').filter(Boolean).join('%20');
        resolvedDiaryLink = `https://${encoded}`;
      } else {
        console.error('❌ ERRO CRÍTICO: diaryLink não pôde ser resolvido para um link válido!', { original: diaryLink, resolved: resolvedDiaryLink });
        return reply.status(400).send({ 
          error: `O diário "${resolvedDiaryLink}" não pôde ser resolvido para um link válido. Verifique a configuração da UC ou passe a URL completa no campo de link manual.`,
          details: { original: diaryLink, resolved: resolvedDiaryLink }
        });
      }
    }
  }
  // Validação final do diaryLink
  if (!resolvedDiaryLink || resolvedDiaryLink.trim() === '') {
    console.error('❌ ERRO CRÍTICO: diaryLink não pode ser vazio!', { original: diaryLink, resolved: resolvedDiaryLink });
    return reply.status(400).send({ 
      error: 'diaryLink inválido ou vazio. Verifique se a UC foi configurada com um link_diario válido no banco de dados.',
      details: { original: diaryLink, resolved: resolvedDiaryLink }
    });
  }

  const runner = () => {
    const addLog = createJobLogger(jobId);
    return runConceitosAutomation({ user, password, diaryLink: resolvedDiaryLink, avSelection, jsonData, trSelection, addLog });
  };

  const position = scheduleJob(jobId, runner);
  return { jobId, position };
});

// BKP
// // Rota do Robô de Pareceres
// fastify.post('/api/run-pareceres', async (request, reply) => {
//   const { user, password, diaryLink, trSelection } = request.body;
//   const jobId = crypto.randomUUID();

//   const runner = () => {
//     const addLog = createJobLogger(jobId);
//     return runPareceresAutomation({ user, password, diaryLink, trSelection, addLog });
//   };

//   const position = scheduleJob(jobId, runner);
//   return { jobId, position };
// });

// --- CRUD para USUARIO ---
fastify.get('/api/usuarios', async (request, reply) => {
  const result = await query('SELECT * FROM USUARIO');
  return result.rows;
});

fastify.post('/api/usuarios', async (request, reply) => {
  const { email, senha } = request.body;
  const result = await query('INSERT INTO USUARIO (email, senha) VALUES ($1, $2) RETURNING *', [email, senha]);
  return result.rows[0];
});

fastify.get('/api/usuarios/:id', async (request, reply) => {
  const { id } = request.params;
  const result = await query('SELECT * FROM USUARIO WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Usuario not found' });
  } else {
    return result.rows[0];
  }
});

fastify.put('/api/usuarios/:id', async (request, reply) => {
  const { id } = request.params;
  const { email, senha } = request.body;
  const result = await query('UPDATE USUARIO SET email = $1, senha = $2 WHERE id = $3 RETURNING *', [email, senha, id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Usuario not found' });
  } else {
    return result.rows[0];
  }
});

fastify.delete('/api/usuarios/:id', async (request, reply) => {
  const { id } = request.params;
  const result = await query('DELETE FROM USUARIO WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Usuario not found' });
  } else {
    return result.rows[0];
  }
});

// --- CRUD para TURMA ---
fastify.get('/api/turmas', async (request, reply) => {
  const result = await query('SELECT * FROM TURMA');
  return result.rows;
});

fastify.get('/turmas', async (request, reply) => {
  const result = await query('SELECT * FROM TURMA');
  return result.rows;
});

fastify.post('/api/turmas', async (request, reply) => {
  const { nome, alunos } = request.body;
  const result = await query('INSERT INTO TURMA (nome, alunos) VALUES ($1, $2) RETURNING *', [nome, alunos]);
  return result.rows[0];
});

fastify.get('/api/turmas/:id', async (request, reply) => {
  const { id } = request.params;
  const result = await query('SELECT * FROM TURMA WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Turma not found' });
  } else {
    return result.rows[0];
  }
});

fastify.put('/api/turmas/:id', async (request, reply) => {
  const { id } = request.params;
  const { nome, alunos } = request.body;
  const result = await query('UPDATE TURMA SET nome = $1, alunos = $2 WHERE id = $3 RETURNING *', [nome, alunos, id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Turma not found' });
  } else {
    return result.rows[0];
  }
});

fastify.delete('/api/turmas/:id', async (request, reply) => {
  const { id } = request.params;
  const result = await query('DELETE FROM TURMA WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'Turma not found' });
  } else {
    return result.rows[0];
  }
});

// --- CRUD para UC ---
fastify.get('/api/ucs', async (request, reply) => {
  const result = await query('SELECT * FROM UC');
  return result.rows;
});

fastify.get('/ucs', async (request, reply) => {
  const result = await query('SELECT * FROM UC');
  return result.rows;
});

fastify.post('/api/ucs', async (request, reply) => {
  const { nome, link_diario } = request.body;
  const result = await query('INSERT INTO UC (nome, link_diario) VALUES ($1, $2) RETURNING *', [nome, link_diario]);
  return result.rows[0];
});

fastify.get('/api/ucs/:id', async (request, reply) => {
  const { id } = request.params;
  const result = await query('SELECT * FROM UC WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'UC not found' });
  } else {
    return result.rows[0];
  }
});

fastify.put('/api/ucs/:id', async (request, reply) => {
  const { id } = request.params;
  const { nome, link_diario } = request.body;
  const result = await query('UPDATE UC SET nome = $1, link_diario = $2 WHERE id = $3 RETURNING *', [nome, link_diario, id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'UC not found' });
  } else {
    return result.rows[0];
  }
});

fastify.delete('/api/ucs/:id', async (request, reply) => {
  const { id } = request.params;
  const result = await query('DELETE FROM UC WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: 'UC not found' });
  } else {
    return result.rows[0];
  }
});

// --- ENDPOINT ÚNICO E CORRIGIDO PARA PARECERES ---
fastify.post('/api/run-pareceres', async (request, reply) => {
  const { user, password, diaries, trSelection } = request.body;

  if (!user || !password || !diaries || !Array.isArray(diaries) || diaries.length === 0) {
    return reply.status(400).send({ error: 'Parâmetros inválidos ou lista de diários vazia.' });
  }

  const jobId = crypto.randomUUID();

  if (robotBusy) {
    // Adiciona na fila existente do seu servidor
    jobs[jobId] = { status: 'queued', logs: ['⏳ Aguardando na fila...'], diaries, user, password, trSelection };
    jobQueue.push(jobId);
    return { jobId, status: 'queued', position: getQueuePosition(jobId) };
  }

  // Se o robô estiver livre, inicia o processo
  jobs[jobId] = { status: 'running', logs: [] };
  robotBusy = true;

  // Executa o lote em background para liberar a resposta HTTP imediatamente
  processarLoteDiarios(jobId, user, password, diaries, trSelection);

  return { jobId, status: 'running' };
});

// Função auxiliar única para gerenciar o loop dos diários enviados
async function processarLoteDiarios(jobId, user, password, diaries, trSelection) {
  const logger = createJobLogger(jobId);
  jobs[jobId].status = 'running';

  logger(`🚀 Iniciando lote de automação para ${diaries.length} diário(s)...`);
  
  try {
    for (let i = 0; i < diaries.length; i++) {
      const currentDiary = diaries[i].trim();
      if (!currentDiary) continue;

      logger(`\n📂 [Diário ${i + 1}/${diaries.length}] Processando link: ${currentDiary}`);
      
      try {
        // Executa o seu motor original importado do 'orquestrador_pareceres.js'
        await runPareceresAutomation({
          user,
          password,
          diaryLink: currentDiary,
          trSelection,
          addLog: logger
        });
        logger(`✅ [Diário ${i + 1}/${diaries.length}] Concluído com sucesso!`);
      } catch (error) {
        logger(`❌ [Diário ${i + 1}/${diaries.length}] Falhou com erro: ${error.message}`);
      }
    }
    logger(`\n🎉 Todos os diários do lote atual foram processados!`);
    jobs[jobId].status = 'completed';
  } catch (globalError) {
    logger(`❌ Erro crítico no lote: ${globalError.message}`);
    jobs[jobId].status = 'failed';
  } finally {
    robotBusy = false;
    
    // Verifica se há mais alguém aguardando na fila global do servidor
    if (jobQueue.length > 0) {
      const nextJobId = jobQueue.shift();
      const nextJob = jobs[nextJobId];
      if (nextJob) {
        scheduleJob(nextJobId, async () => {
          await processarLoteDiarios(nextJobId, nextJob.user, nextJob.password, nextJob.diaries, nextJob.trSelection);
        });
      }
    }
  }
}

// --- ENDPOINT DE CONSULTA DE LOGS (Essencial para o front-end ver o que está acontecendo) ---
fastify.get('/api/logs/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const job = jobs[jobId];

  // Se o job não existir ainda ou já tiver sido limpo
  if (!job) {
    return reply.status(200).send({ status: 'not_found', logs: [] });
  }

  // Devolve o status atual e a lista de logs
  return reply.send({
    status: job.status,
    logs: job.logs,
    position: getQueuePosition(jobId)
  });
});

// --- O STATIC DEVE VIR POR ÚLTIMO ---
fastify.register(fastifyStatic, {
  root: __dirname,
  prefix: '/', 
});

const porta = process.env.PORT || 3000;

fastify.listen({ port: porta, host: '0.0.0.0' }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Servidor rodando em ${address}`);
});













