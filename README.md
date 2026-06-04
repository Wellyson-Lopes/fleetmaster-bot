# FleetMaster Bot - Guia Completo de Instalação e Configuração

O **FleetMaster Bot** é um assistente logístico inteligente que integra o **Google Gemini 2.5** ao WhatsApp via **Firebase Functions** e **Evolution API**. Este guia detalha o passo a passo para configurar o ambiente do zero.

---

## 📌 Sumário
1. [Configuração do Google AI Studio](#1-configuração-do-google-ai-studio)
2. [Ambiente Local e Google Cloud CLI](#2-ambiente-local-e-google-cloud-cli)
3. [Segurança com Google Secret Manager](#3-segurança-com-google-secret-manager)
4. [Configuração do Firebase e Firestore](#4-configuração-do-firebase-e-firestore)
5. [Configuração da Evolution API (Docker)](#5-configuração-da-evolution-api-docker)
6. [Túnel e Exposição com Ngrok](#6-túnel-e-exposição-com-ngrok)
7. [Desenvolvimento e Deploy](#7-desenvolvimento-e-deploy)
8. [Monitoramento e Alertas](#8-monitoramento-e-alertas)
9. [Testes e Validação](#9-testes-e-validação)

---

## 1. Configuração do Google AI Studio
O "cérebro" do bot é o modelo Gemini hospedado no AI Studio.

1.  Acesse o [Google AI Studio](https://aistudio.google.com/).
2.  **Plano**: Clique em **Settings > Billing** para ativar o faturamento (plano Pay-as-you-go) ou use a cota gratuita para testes.
3.  **Prompt**: Crie um novo Chat Prompt para testar suas regras de negócio.
4.  **API Key**: Gere sua chave em "Get API Key". Ela terá o prefixo `AQ.A...`.
5.  **Modelo**: O sistema está configurado para o `gemini-2.5-flash`.

---

## 2. Ambiente Local e Google Cloud CLI
Prepare seu terminal para gerenciar os serviços do Google Cloud.

### Instalar Dependências Básicas
```bash
# Node.js e NPM (Recomendado v20+)
sudo apt update && sudo apt install nodejs npm git -y

# Google Cloud CLI
sudo snap install google-cloud-cli --classic
```

### Autenticação e Projeto
```bash
# Login na conta Google
gcloud auth login

# Definir o projeto padrão
gcloud config set project [ID-DO-SEU-PROJETO]
```

---

## 3. Segurança com Google Secret Manager
Em vez de usar arquivos `.env`, utilizamos o **Secret Manager** para máxima segurança.

### Criar os Secrets
```bash
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_URL --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_INSTANCE --replication-policy="automatic"
```

### Adicionar Valores (Exemplos)
```bash
echo -n "AQ.A_SUA_CHAVE_GEMINI" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
echo -n "https://sua-url-ngrok.ngrok-free.app" | gcloud secrets versions add EVOLUTION_API_URL --data-file=-
echo -n "chave_mestra_123" | gcloud secrets versions add EVOLUTION_API_KEY --data-file=-
echo -n "fleetmaster" | gcloud secrets versions add EVOLUTION_INSTANCE --data-file=-
```

### Permissões de Acesso
```bash
for secret in GEMINI_API_KEY EVOLUTION_API_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:[NUMERO_DO_PROJETO]-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 4. Configuração do Firebase e Firestore
O Firebase gerencia as Cloud Functions e o banco de dados.

1.  **Habilitar Firestore**: No console do Firebase, crie o banco de dados em **Modo Nativo**.
2.  **Regras**: Use as regras padrão que permitem leitura/escrita para o Service Account da Function.
3.  **Inicialização Local**:
    ```bash
    npm install -g firebase-tools
    firebase login
    firebase init functions
    ```

---

## 5. Configuração da Evolution API (Docker)
A Evolution API é o gateway para o WhatsApp.

1.  Navegue até a pasta: `cd evolution-api`
2.  Suba os serviços:
    ```bash
    docker-compose up -d
    ```
    *Isso iniciará a API, o PostgreSQL e o Redis.*

---

## 6. Túnel e Exposição com Ngrok
O ngrok expõe sua porta local 8080 para que o Firebase possa enviar mensagens de volta para a Evolution API.

### Instalação
```bash
# Via Snap (Linux)
sudo snap install ngrok

# Ou download direto
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok
```

### Configuração e Autenticação
1.  Crie uma conta em [ngrok.com](https://ngrok.com/).
2.  Adicione seu token:
    ```bash
    ngrok config add-authtoken [SEU_TOKEN_AQUI]
    ```

### Execução e Inspeção
```bash
# Iniciar túnel
ngrok http 8080

# Monitorar tráfego (Painel de Inspeção)
# Acesse no navegador: http://localhost:4040
```

---

## 7. Desenvolvimento e Deploy

### Build e Deploy
```bash
cd functions
npm run build
firebase deploy --only functions
```

### Limpeza de Variáveis Legadas
```bash
gcloud run services update whatsappwebhook \
  --region=us-central1 \
  --remove-env-vars=GEMINI_API_KEY,EVOLUTION_API_URL,EVOLUTION_API_KEY,EVOLUTION_INSTANCE
```

---

## 8. Monitoramento e Alertas
Mantenha o sistema saudável configurando alertas no Google Cloud Console.

1.  **Logs**: Acesse **Logs Explorer** e filtre por `resource.type="cloud_function"`.
2.  **Alertas de Erro**:
    *   Vá em **Monitoring > Alerting**.
    *   Crie uma política baseada em "Error Reporting".
    *   Configure notificações por E-mail ou Slack para erros `Fatal Error` identificados nos logs do bot.
3.  **Uso de Cota**: Monitore o consumo da API Gemini para evitar interrupções inesperadas.

---

## 9. Testes e Validação
Simule uma mensagem do WhatsApp:

```bash
curl -X POST "https://[URL-DA-SUA-FUNCTION]/whatsappWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "fromMe": false,
        "id": "MSG_TESTE_123"
      },
      "message": { "conversation": "Como posso contratar?" }
    },
    "sender": "5511999999999@s.whatsapp.net"
  }'
```

---
*FleetMaster Logistics - Engenharia de Software de Alta Performance.*
