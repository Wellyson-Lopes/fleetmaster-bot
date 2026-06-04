# FleetMaster Bot - Assistente Logístico Inteligente

O **FleetMaster Bot** é um assistente virtual inteligente desenvolvido para a **FleetMaster Logistics**, uma plataforma SaaS de gestão logística para distribuidoras de materiais de construção. O bot utiliza inteligência artificial avançada para atender gestores, motoristas e interessados via WhatsApp.

## 🚀 Objetivo do Projeto
Automatizar o atendimento de primeiro nível, suporte operacional e vendas, integrando o poder do **Google Gemini 2.5** com a robustez do **Firebase** e a flexibilidade da **Evolution API**.

## 🛠️ Arquitetura do Sistema

1.  **Cérebro (Google AI Studio)**: Utiliza o modelo `gemini-2.5-flash` para processamento de linguagem natural, com instruções de sistema personalizadas para o domínio logístico.
2.  **Backend (Firebase Functions)**: Webhook em Node.js/TypeScript que gerencia a lógica de mensagens, controle de estado e integração entre APIs.
3.  **Persistência (Cloud Firestore)**: Armazenamento de histórico de conversas (Threads) e controle de idempotência para evitar respostas duplicadas.
4.  **Integração WhatsApp (Evolution API)**: Ponte de comunicação entre o WhatsApp e o backend Firebase.

## 📋 Diretrizes e Configuração

### 1. Configurando o Cérebro (Google AI Studio)
*   Acesso via [Google AI Studio](https://aistudio.google.com/).
*   As regras de negócio (System Instruction) definem o tom e as capacidades do bot.
*   Uso de API Key (formato `AQ.A...`).

### 2. Preparando o Backend (Firebase)
*   Projeto configurado no Firebase Console sob o plano **Blaze**.
*   Uso do SDK `@google/genai` (v2.x) para comunicação com o Gemini.
*   Ambiente de execução: Node.js 24.

### 3. Fluxo do Webhook (Cloud Functions)
*   **Recebimento**: Validação de eventos `messages.upsert`.
*   **Estado**: Sincronização automática do histórico no Firestore por número de telefone.
*   **Processamento**: Injeção de contexto de sistema e chamada ao Gemini.
*   **Resposta**: Envio formatado para a rota da Evolution API.

### 4. Conectando o WhatsApp
*   Webhook apontando para a URL da Cloud Function.
*   Configuração de eventos focada em mensagens para otimização de recursos.

## 👨‍💻 Desenvolvimento
O projeto segue padrões de Senior Engineering, com logs detalhados de depuração (Step-by-Step) e tratamento de erros robusto para garantir alta disponibilidade.

---
*FleetMaster Logistics - Transformando a gestão logística com IA.*
