

https://github.com/user-attachments/assets/1b3c5a23-c601-4b75-a0e5-0db44b62d788

# 🚛 FleetMaster Bot

Bot de atendimento via WhatsApp com inteligência artificial, construído sobre Firebase Cloud Functions, Google Gemini e Evolution API.

---

https://github.com/user-attachments/assets/5706b7f5-d34f-47ab-a271-d6a57aaf82d1



## 📑 Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [1. Google AI Studio](#1-google-ai-studio)
- [2. Firebase](#2-firebase)
- [3. Evolution API](#3-evolution-api)
- [4. ngrok](#4-ngrok)
- [5. Google Secret Manager](#5-google-secret-manager)
- [6. Deploy](#6-deploy)
- [7. Webhook](#7-webhook)
- [8. Monitoramento](#8-monitoramento)
- [9. Testando](#9-testando)
- [10. Problemas Comuns](#10-problemas-comuns)

---

## Visão Geral

O FleetMaster Bot recebe mensagens do WhatsApp, consulta o histórico da conversa no Firestore, envia o contexto ao Gemini e devolve a resposta ao usuário — tudo em tempo real via Cloud Functions.

O histórico é armazenado por número de telefone no Firestore, o que controla o consumo de tokens e reduz custos. Mensagens duplicadas são descartadas via deduplicação com transação atômica. Chaves de API ficam no Google Secret Manager, nunca no código.

---

## Arquitetura

```
WhatsApp
   │
   ▼
Evolution API  ──webhook──►  Cloud Function (Firebase)
                                      │
                          ┌───────────┼───────────┐
                          ▼           ▼           ▼
                       Firestore   Gemini AI   Secret Manager
                    (histórico)  (resposta)   (chaves seguras)
                          │
                          ▼
                    Evolution API  ──►  WhatsApp
```

---

## Pré-requisitos

- [Node.js 18+](https://nodejs.org)
- [Docker e Docker Compose](https://docs.docker.com/get-docker/)
- [Conta Google](https://accounts.google.com)
- [Conta ngrok](https://ngrok.com) (desenvolvimento local)

---

## 1. Google AI Studio

O AI Studio é onde você define o comportamento do bot através do **System Instruction** e obtém a chave de acesso ao Gemini.

**Passos:**

1. Acesse [aistudio.google.com](https://aistudio.google.com)
2. Clique em **"Create new prompt"**
3. Em **"System Instructions"** escreva as regras de negócio do bot (tom, escopo, limitações)
4. Selecione o modelo **Gemini 2.5 Flash**
5. Teste o comportamento interativamente antes de continuar
6. Vá em **"Get API Key"** → **"Create API Key"**
7. Selecione um projeto Google Cloud **sem organização** — projetos com organização corporativa podem bloquear a chave
8. Copie e guarde a chave gerada com segurança

> ℹ️ O System Instruction definido aqui é a fonte da verdade do comportamento do bot. O código apenas o referencia — não duplique regras de negócio em dois lugares.

---

## 2. Firebase

O Firebase hospeda a Cloud Function e o banco de dados Firestore.

### 2.1 Criar o projeto

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Clique em **"Adicionar projeto"**
3. No canto inferior esquerdo faça upgrade para o plano **Blaze** — é obrigatório para Cloud Functions fazerem chamadas externas

### 2.2 Criar o Firestore

1. No menu lateral clique em **"Firestore Database"**
2. Clique em **"Criar banco de dados"** → **"Modo de teste"**
3. Região: **`us-east1`**

### 2.3 Instalar o Firebase CLI e inicializar o projeto

```bash
npm install -g firebase-tools
firebase login
firebase init functions
```

Nas perguntas do `init`:
- **Use an existing project** → selecione o projeto criado
- **Language** → TypeScript
- **ESLint** → No
- **Install dependencies** → Yes

### 2.4 Instalar dependências do projeto

```bash
cd functions
npm install @google/genai axios firebase-functions
```

> ℹ️ Usamos o SDK oficial `@google/genai` em vez de chamadas HTTP diretas (Axios) porque o SDK gerencia autenticação, tipagem TypeScript e retry automático. Se a API do Gemini mudar, basta atualizar o pacote.

---

## 3. Evolution API

A Evolution API é a ponte entre o WhatsApp e o webhook. Roda localmente via Docker com PostgreSQL como banco de dados.

### 3.1 Configurar as variáveis de ambiente

Crie o arquivo `evolution-api/.env` com base no `evolution-api/.env.example` disponível no repositório:

```bash
cp evolution-api/.env.example evolution-api/.env
```

Edite o arquivo e preencha os valores:

- `AUTHENTICATION_API_KEY` — chave que você define para proteger a API (mínimo 20 caracteres)
- `CONFIG_SESSION_PHONE_VERSION` — versão do cliente WhatsApp Web. Consulte a versão mais recente na [documentação oficial](https://doc.evolution-api.com) se o QR Code não aparecer

### 3.2 Subir os containers

```bash
cd evolution-api
docker-compose up -d
```

### 3.3 Verificar se está rodando

```bash
docker logs evolution-api --tail 20
```

Aguarde até ver `HTTP - ON: 8080`. Confirme no terminal:

```bash
curl http://localhost:8080
```
<img width="1844" height="813" alt="image" src="https://github.com/user-attachments/assets/aa8905c7-24f9-43a8-8cee-8d912e119eea" />

Resposta esperada:
```json
{"status":200,"message":"Welcome to the Evolution API, it is working!"}
```

### 3.4 Criar a instância e conectar o WhatsApp

```bash
curl -X POST "http://localhost:8080/instance/create" \
  -H "apikey: SUA_CHAVE_EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "fleetmaster",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

Acesse o manager no navegador, faça login com sua API key e escaneie o QR Code:

```
http://localhost:8080/manager
```

Confirme que a instância está conectada:

```bash
curl -X GET "http://localhost:8080/instance/fetchInstances" \
  -H "apikey: SUA_CHAVE_EVOLUTION"
```

O campo `connectionStatus` deve retornar `"open"`.

---

## 4. ngrok

Em desenvolvimento, a Cloud Function roda nos servidores do Google e não consegue alcançar `localhost`. O ngrok cria um túnel público que redireciona para a Evolution API local.

### 4.1 Instalar

```bash
sudo snap install ngrok
```

### 4.2 Autenticar

```bash
ngrok config add-authtoken SEU_TOKEN_NGROK
```

### 4.3 Expor a porta da Evolution API

```bash
ngrok http 8080
```

Anote a URL gerada (ex: `https://xxxx.ngrok-free.app`). Ela será usada como `EVOLUTION_API_URL` no Secret Manager.

> ⚠️ No plano gratuito do ngrok a URL muda a cada reinicialização. Sempre que isso acontecer, atualize o secret `EVOLUTION_API_URL` e faça um novo deploy. Para produção, hospede a Evolution API em uma VPS com URL fixa.

---

## 5. Google Secret Manager

As chaves de API ficam no Secret Manager — nunca no código ou em arquivos `.env` commitados. A Cloud Function acessa os secrets em tempo de execução com permissão explícita.

### 5.1 Instalar o Google Cloud CLI

```bash
sudo snap install google-cloud-cli --classic
gcloud auth login
gcloud config set project SEU_PROJECT_ID
```

### 5.2 Criar os secrets

```bash
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_URL --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_INSTANCE --replication-policy="automatic"
```

### 5.3 Adicionar os valores

```bash
echo -n "SUA_CHAVE_GEMINI" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
echo -n "https://xxxx.ngrok-free.app" | gcloud secrets versions add EVOLUTION_API_URL --data-file=-
echo -n "SUA_CHAVE_EVOLUTION" | gcloud secrets versions add EVOLUTION_API_KEY --data-file=-
echo -n "fleetmaster" | gcloud secrets versions add EVOLUTION_INSTANCE --data-file=-
```

### 5.4 Dar permissão à conta de serviço da Cloud Function

Substitua `SEU_PROJECT_NUMBER` pelo número do projeto (visível no Google Cloud Console):

```bash
for secret in GEMINI_API_KEY EVOLUTION_API_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:SEU_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 6. Deploy

### 6.1 Build e deploy

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions
```

O comando faz o build do TypeScript, empacota e envia para o Firebase. Ao final, a URL da função é exibida no terminal.

### 6.2 Configurar permissões no IAM

Acesse [IAM do Google Cloud](https://console.cloud.google.com/iam-admin/iam) e adicione os seguintes papéis para a conta `SEU_PROJECT_NUMBER-compute@developer.gserviceaccount.com`:

- **Cloud Build Service Account**
- **Logs Writer**
- **Storage Object Admin**
- **Artifact Registry Writer**
- **Cloud Datastore User**

### 6.3 Liberar acesso público à Cloud Function

1. Acesse [console.cloud.google.com/run](https://console.cloud.google.com/run)
2. Clique em **whatsappwebhook**
3. Aba **"Segurança"** → selecione **"Permitir acesso público"**
4. Salve

---

## 7. Webhook

Com a Cloud Function deployada e a Evolution API rodando, registre o webhook para que as mensagens do WhatsApp sejam enviadas à função:

```bash
curl -X POST "http://localhost:8080/webhook/set/fleetmaster" \
  -H "apikey: SUA_CHAVE_EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "url": "https://URL_DA_SUA_CLOUD_FUNCTION",
      "enabled": true,
      "events": ["MESSAGES_UPSERT"],
      "webhookByEvents": false,
      "webhookBase64": false
    }
  }'
```

Confirme que o webhook foi registrado:

```bash
curl -X GET "http://localhost:8080/webhook/find/fleetmaster" \
  -H "apikey: SUA_CHAVE_EVOLUTION"
```

---

## 8. Monitoramento

### 8.1 Criar canal de notificação por email

```bash
gcloud alpha monitoring channels create \
  --display-name="FleetMaster Alerts" \
  --type=email \
  --channel-labels=email_address=seu@email.com
```

O comando retorna um ID no formato `projects/.../notificationChannels/NUMERO`.

### 8.2 Criar política de alertas

1. Acesse [console.cloud.google.com/monitoring/alerting](https://console.cloud.google.com/monitoring/alerting)
2. Clique em **"Criar política"**
3. Métrica: **Cloud Run Revision → Request Count**
4. Filtros: `service_name = whatsappwebhook` e `response_code_class = 5xx`
5. Threshold: `3` erros em `5 minutos`
6. Notificação: canal criado no passo anterior
7. Nome: `FleetMaster Bot - Erros Críticos`

### 8.3 Visualizar logs em tempo real

```bash
firebase functions:log --only whatsappWebhook
```

---

## 9. Testando

### 9.1 Simular uma mensagem sem número real

```bash
curl -X POST "https://URL_DA_SUA_CLOUD_FUNCTION" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "fromMe": false,
        "id": "TEST_ID_001"
      },
      "message": {
        "conversation": "Olá, quero saber sobre os planos"
      }
    }
  }'
```

Resposta esperada: `OK`

### 9.2 Testar envio direto pela Evolution API

```bash
curl -X POST "http://localhost:8080/message/sendText/fleetmaster" \
  -H "apikey: SUA_CHAVE_EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5511999999999",
    "text": "Teste de envio direto"
  }'
```

### 9.3 Atualizar a URL do ngrok

Sempre que o ngrok for reiniciado, atualize o secret e faça novo deploy:

```bash
echo -n "https://nova-url.ngrok-free.app" | gcloud secrets versions add EVOLUTION_API_URL --data-file=-
firebase deploy --only functions
```

---

## 10. Problemas Comuns

**QR Code não aparece no manager**
Atualize a variável `CONFIG_SESSION_PHONE_VERSION` no `evolution-api/.env` com a versão mais recente do cliente WhatsApp Web. Consulte a [documentação da Evolution API](https://doc.evolution-api.com).

**Mensagem duplicada no WhatsApp**
O WhatsApp envia dois webhooks para a mesma mensagem — um com `@s.whatsapp.net` e outro com `@lid`. O código filtra `@lid` automaticamente. Se o problema persistir, verifique os logs da função.

**Cloud Function retorna 403**
O acesso público não foi liberado no Cloud Run. Siga o passo [6.3](#63-liberar-acesso-público-à-cloud-function).

**Secret não encontrado no deploy**
Confirme que a conta de serviço tem o papel `roles/secretmanager.secretAccessor` para cada secret. Execute novamente o comando do passo [5.4](#54-dar-permissão-à-conta-de-serviço-da-cloud-function).

**ngrok retorna 502 ou timeout**
A Evolution API caiu. Reinicie o container:

```bash
docker-compose restart evolution-api
```

**Variável de ambiente conflita com secret**
Se houver um `.env` local na pasta `functions`, remova-o — ele conflita com o Secret Manager:

```bash
rm functions/.env
```

---

## Checklist de Produção

Antes de ir para produção, certifique-se de:

- [ ] Hospedar a Evolution API em uma VPS com URL fixa (sem ngrok)
- [ ] Atualizar `EVOLUTION_API_URL` no Secret Manager com a URL da VPS
- [ ] Configurar reconexão automática do WhatsApp
- [ ] Revisar as regras de segurança do Firestore
- [ ] Verificar se os alertas de monitoramento estão ativos
- [ ] Remover qualquer arquivo `.env` do repositório

---

## Tecnologias

| Tecnologia | Papel |
|---|---|
| Firebase Cloud Functions | Webhook e orquestração |
| Google Firestore | Histórico de conversas por número |
| Google Secret Manager | Armazenamento seguro de chaves |
| Google Gemini 2.5 Flash | Modelo de linguagem |
| Evolution API | Integração com WhatsApp |
| Docker + PostgreSQL | Infraestrutura local da Evolution API |
| ngrok | Túnel para desenvolvimento local |

---

## Licença

MIT
