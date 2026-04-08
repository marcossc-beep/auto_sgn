import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { query } from './db.js';

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
    runner,
    shouldCancel: false
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

  const cancellationToken = {
    shouldCancel: () => job.shouldCancel
  };

  job.runner(cancellationToken)
    .then(() => {
      if (job.shouldCancel) {
        job.status = 'cancelled';
        addLog('⏹️ Operação cancelada pelo usuário.');
      } else {
        job.status = 'completed';
        addLog('✅ Processo finalizado.');
      }
    })
    .catch(err => {
      if (job.shouldCancel) {
        job.status = 'cancelled';
        addLog('⏹️ Operação cancelada pelo usuário.');
      } else {
        job.status = 'error';
        addLog(`❌ ERRO: ${err.message}`);
      }
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

// Rota para Cancelar Job
fastify.post('/api/cancel/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const job = jobs[jobId];
  
  if (!job) {
    return reply.code(404).send({ error: 'Job não encontrado' });
  }
  
  if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
    return reply.code(400).send({ error: 'Job já finalizou' });
  }
  
  job.shouldCancel = true;
  return { message: 'Cancelamento solicitado', status: job.status };
});

// Rota do Robô de Conceitos
fastify.post('/api/run-conceitos', async (request, reply) => {
  const { user, password, diaryLink, avSelection, jsonData } = request.body;
  const jobId = crypto.randomUUID();

  const runner = (cancellationToken) => {
    const addLog = createJobLogger(jobId);
    return runConceitosAutomation({ user, password, diaryLink, avSelection, jsonData, addLog, cancellationToken });
  };

  const position = scheduleJob(jobId, runner);
  return { jobId, position };
});

// Rota do Robô de Pareceres
fastify.post('/api/run-pareceres', async (request, reply) => {
  const { user, password, diaryLink, trSelection } = request.body;
  const jobId = crypto.randomUUID();

  const runner = (cancellationToken) => {
    const addLog = createJobLogger(jobId);
    return runPareceresAutomation({ user, password, diaryLink, trSelection, addLog, cancellationToken });
  };

  const position = scheduleJob(jobId, runner);
  return { jobId, position };
});

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