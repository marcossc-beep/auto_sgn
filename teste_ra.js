// teste_ra.js — usa fetch nativo do Node 18+
const payload = {
  user: "marcos.sc",
  password: "#Amorinha1234",
  diaries: ["https://sgn.sesisenai.org.br/pages/diarioClasse/diario-classe.html?idDiario=410836"],
  capacidadesAlvo: JSON.stringify({
    "H1 - Reconhecer ferramentas para o desenvolvimento de atividades (repositório, controle de versão)": "B",
    "H10 - Utilizar padrão de projeto para desenvolvimento de aplicativos": "B",
    "H11 - Utilizar técnicas de integração de aplicações com banco de dados na estruturação do sistema": "B",
    "H12 - Utilizar frameworks para o desenvolvimento de aplicativos": "B",
    "H13 - Reconhecer especificações técnicas e paradigmas de linguagem de programação": "B",
    "H2 - Instalar ferramentas de acordo com requisitos de hardware, software e parâmetro de configuração": "B",
    "H3 - Aplicar linguagem de programação por meio do ambiente integrado de desenvolvimento (IDE)": "B",
    "H4 - Integrar banco de dados por meio da linguagem de programação": "B",
    "H5 - Aplicar métodos e técnicas de programação": "C",
    "H6 - Empregar comentários para documentação do código fonte": "B",
    "H7 - Utilizar o ambiente de desenvolvimento (IDE) para rastreabilidade do código": "B",
    "H8 - Identificar erros de acordo com o requisito do programa e linguagem": "B"
  }),
  dataInicio: "25/05/2026",
  dataTermino: "26/06/2026",
  justificativa: "CONTEXTUALIZAÇÃO\nVocê é um desenvolvedor frontend em São José (SC) e está participando de um processo seletivo para uma vaga de emprego na indústria de tecnologia. Como etapa prática da entrevista de contratação, a empresa precisa avaliar se você conhece ferramentas modernas de desenvolvimento backend. \nO setor de desenvolvimento da empresa enfrenta dificuldades para persistir informações em um banco de dados de forma segura. Como não seria seguro o frontend se conectar diretamente ao banco de dados ficou evidente a necessidade de desenvolver uma API. \n\n\nDESAFIO\nOs recrutadores solicitaram que os candidatos demonstrem o uso prático das ferramentas através de um vídeo tutorial explicando todo o funcionamento do projeto de uma API integrada ao banco de dados. \n\n\nRESULTADOS E ENTREGAS\nUm vídeo no modelo tutorial explicando como criar uma api para gerenciamento de usuários utilizando node.js integrada ao banco de dados postgres contendo os quatro principais métodos do protocolo http sendo get, post, put e delete.\nLink do repositório pronto com o projeto desenvolvido contendo obrigatoriamente:\nreferencias.http (para testes e documentação)\nbanco.sql (com a estrutura da tabela)\nserver.js (com os quatro endpoints desenvolvidos)\npackage.json (configuração do node utilizando type module)\nconfiguração de cors na API para permitir que qualquer frontend se conecte a API.\n\n\nLISTA DE ANEXOS\nLink tutorial exemplo: https://www.youtube.com/watch?v=hHM-hr9q4mo&t=1s\n",
  publicaOnline: true,
  nomeArquivoRA: "RA programação de aplicativos.docx (1).pdf",
  deletarNoFinal: false,
  trSelection: "1"
};

async function testarAutomacao() {
  console.log("🚀 Enviando requisição para iniciar automação de RA...");
  
  try {
    const response = await fetch("http://localhost:3000/api/ra/iniciar", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erro na API (${response.status}): ${errText}`);
    }
    
    const data = await response.json();
    console.log(`✅ Requisição aceita com sucesso! Job ID: ${data.jobId}`);
    
    // Inicia monitoramento de logs
    await monitorarLogs(data.jobId);
    
  } catch (err) {
    console.error(`❌ Falha no teste: ${err.message}`);
  }
}

async function monitorarLogs(jobId) {
  console.log(`🔍 Iniciando monitoramento de logs para o Job ${jobId}...`);
  let lastLogIndex = 0;
  let status = "queued";
  
  while (status === "queued" || status === "running") {
    try {
      const response = await fetch(`http://localhost:3000/api/logs/${jobId}`);
      if (!response.ok) {
        console.log(`⚠️ Não foi possível obter os logs nesta iteração.`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      const data = await response.json();
      status = data.status;
      
      // Imprime novos logs
      if (data.logs && data.logs.length > lastLogIndex) {
        for (let i = lastLogIndex; i < data.logs.length; i++) {
          console.log(data.logs[i]);
        }
        lastLogIndex = data.logs.length;
      }
      
      if (status === "completed" || status === "success") {
        console.log("\n🎉 Automação concluída com sucesso!");
        break;
      } else if (status === "failed" || status === "error") {
        console.log("\n❌ A automação falhou.");
        break;
      }
      
    } catch (e) {
      console.error(`⚠️ Erro ao consultar logs: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
}

testarAutomacao();
