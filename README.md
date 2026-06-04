# 🚛 FleetMaster Bot — WhatsApp AI Assistant

Bot de atendimento via WhatsApp integrado ao Gemini AI, construído com Firebase Cloud Functions, Evolution API e Google Secret Manager.

---

## 🏗️ Arquitetura

```
WhatsApp → Evolution API → Cloud Function (Firebase) → Gemini AI → Evolution API → WhatsApp
                                        ↕
                                   Firestore DB
                                (histórico por número)
```

---

## 📋 Pré-requisitos

- Node.js 18+
- Docker e Docker Compose
- Conta Google (Firebase + Google Cloud)
- Conta Google AI Studio
- ngrok (para desenvolvimento local)

---

## 1. 🧠 Configurando o Google AI Studio

### 1.1 Acessar o AI Studio

1. Acesse [aistudio.google.com](https://aistudio.google.com)
2. Clique em **"Create new prompt"**
3. Em **"System Instructions"** defina as regras de negócio do bot
4. Escolha o modelo **Gemini 2.5 Flash** (melhor custo-benefício para bots)
5. Teste o prompt interativamente antes de seguir

### 1.2 Gerar a API Key

1. No menu lateral clique em **"Get API Key"**
2. Clique em **"Create API Key"**
3. Selecione um projeto Google Cloud existente ou crie um novo **sem organização**
4. Guarde a chave gerada com segurança — ela não será exibida novamente

> ⚠️ **Importante:** Chaves geradas em projetos com organização corporativa podem ter restrições. Se a chave começar com `AQ.` em vez de `AIza`, crie um projeto sem organização.

---

## 2. 🔥 Preparando o Firebase

### 2.1 Criar o projeto

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Clique em **"Adicionar projeto"**
3. Dê um nome ao projeto (ex: `fleetmaster-bot`)
4. No canto inferior esquerdo, clique em **"Spark"** → **"Fazer upgrade"** → selecione **Blaze**

> ⚠️ O plano Blaze é necessário pois Cloud Functions fazem requisições externas (Gemini, Evolution API).

### 2.2 Criar o Firestore

1. No menu lateral clique em **"Firestore Database"**
2. Clique em **"Criar banco de dados"**
3. Selecione **"Iniciar no modo de teste"**
4. Região: **`us-east1`**

### 2.3 Configurar regras do Firestore

Na aba **"Regras"** do Firestore, substitua por:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 2.4 Instalar o Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 2.5 Inicializar o projeto

```bash
mkdir fleetmaster-bot
cd fleetmaster-bot
firebase init functions
```

Nas perguntas do init, escolha:
- **Use an existing project** → selecione o projeto criado
- **Language** → TypeScript
- **ESLint** → No
- **Install dependencies** → Yes

### 2.6 Instalar dependências

```bash
cd functions
npm install @google/genai axios firebase-functions
```

---

## 3. 🐳 Configurando a Evolution API (Docker)

### 3.1 Estrutura de pastas

```
fleetmaster-bot/
├── evolution-api/
│   ├── docker-compose.yml
│   └── .env
└── functions/
    └── src/
        └── index.ts
```

### 3.2 Criar o arquivo `.env` da Evolution API

Crie o arquivo `evolution-api/.env`:

```env
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=sua_chave_aqui_minimo_20_caracteres
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:evolution123@postgres:5432/evolution?schema=public
QRCODE_LIMIT=30
STORE_MESSAGES=true
STORE_MESSAGE_UP=true
STORE_CONTACTS=true
STORE_CHATS=true
CONFIG_SESSION_PHONE_VERSION=2.3000.1040689878
```

> ⚠️ A variável `CONFIG_SESSION_PHONE_VERSION` é crítica — sem ela o QR Code não é gerado. Verifique a versão mais recente na [documentação oficial](https://doc.evolution-api.com).

### 3.3 Criar o `docker-compose.yml`

Crie o arquivo `evolution-api/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:15
    container_name: evolution-postgres
    environment:
      - POSTGRES_USER=evolution
      - POSTGRES_PASSWORD=evolution123
      - POSTGRES_DB=evolution
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

  evolution-api:
    image: atendai/evolution-api:v2.1.1
    container_name: evolution-api
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    volumes:
      - evolution_data:/evolution/instances
    restart: always

volumes:
  postgres_data:
  evolution_data:
```

### 3.4 Subir os containers

```bash
cd evolution-api
docker-compose up -d
```

### 3.5 Verificar se está rodando

```bash
docker logs evolution-api --tail 20
```

A saída deve mostrar `HTTP - ON: 8080`. Teste no navegador:

```
http://localhost:8080
```

Resposta esperada:
```json
{"status":200,"message":"Welcome to the Evolution API, it is working!"}
```

---

## 4. 📱 Conectando o WhatsApp

### 4.1 Criar a instância

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

### 4.2 Conectar pelo QR Code

1. Acesse `http://localhost:8080/manager`
2. Faça login com sua API key
3. Clique na instância **fleetmaster**
4. Clique em **"Get QR Code"**
5. Escaneie com o WhatsApp: **Configurações → Dispositivos conectados → Conectar dispositivo**

### 4.3 Verificar conexão

```bash
curl -X GET "http://localhost:8080/instance/fetchInstances" \
  -H "apikey: SUA_CHAVE_EVOLUTION"
```

O campo `connectionStatus` deve ser `"open"`.

---

## 5. 🌐 Expondo a Evolution API com ngrok

> O ngrok é necessário para que a Cloud Function (hospedada no Google) consiga chamar a Evolution API rodando localmente.

### 5.1 Instalar o ngrok

```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list \
  && sudo apt update \
  && sudo apt install ngrok
```

### 5.2 Autenticar

1. Crie uma conta em [ngrok.com](https://ngrok.com)
2. Copie o token do dashboard
3. Execute:

```bash
ngrok config add-authtoken SEU_TOKEN_NGROK
```

### 5.3 Expor a porta 8080

```bash
ngrok http 8080
```

Anote a URL gerada (ex: `https://xxxx-xxx-xxx.ngrok-free.app`). Ela será usada como `EVOLUTION_API_URL`.

> ⚠️ No plano gratuito do ngrok a URL muda a cada reinicialização. Para produção, use uma VPS.

---

## 6. 🔐 Configurando o Google Secret Manager

### 6.1 Instalar o Google Cloud CLI

```bash
sudo snap install google-cloud-cli --classic
gcloud auth login
gcloud config set project SEU_PROJECT_ID
```

### 6.2 Criar os secrets

```bash
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_URL --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_INSTANCE --replication-policy="automatic"
```

### 6.3 Adicionar os valores

```bash
echo -n "SUA_CHAVE_GEMINI" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
echo -n "https://xxxx.ngrok-free.app" | gcloud secrets versions add EVOLUTION_API_URL --data-file=-
echo -n "SUA_CHAVE_EVOLUTION" | gcloud secrets versions add EVOLUTION_API_KEY --data-file=-
echo -n "fleetmaster" | gcloud secrets versions add EVOLUTION_INSTANCE --data-file=-
```

### 6.4 Dar permissão à Cloud Function

```bash
for secret in GEMINI_API_KEY EVOLUTION_API_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:SEU_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

> Substitua `SEU_PROJECT_NUMBER` pelo número do seu projeto (visível no Google Cloud Console).

---

## 7. ☁️ Criando a Cloud Function

### 7.1 Código completo — `functions/src/index.ts`

```typescript
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";

initializeApp();
const db = getFirestore();

// Secrets do Google Secret Manager
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const EVOLUTION_API_URL = defineSecret("EVOLUTION_API_URL");
const EVOLUTION_API_KEY = defineSecret("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE = defineSecret("EVOLUTION_INSTANCE");

const SYSTEM_INSTRUCTION = `Você é o assistente virtual do FleetMaster Logistics...
// Defina aqui as regras de negócio do seu bot`;

const GEMINI_MODEL = "gemini-2.5-flash";
const HISTORY_LIMIT = 12;

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(apiKey: string): GoogleGenAI {
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

async function syncChatHistory(phone: string, role: "user" | "model", text: string) {
  const docRef = db.collection("conversations").doc(phone);

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    let history: any[] = doc.exists ? doc.data()?.messages || [] : [];

    history.push({ role, parts: [{ text }] });

    if (history.length > HISTORY_LIMIT) {
      history = history.slice(-HISTORY_LIMIT);
    }

    while (history.length > 0 && history[0].role !== "user") {
      history.shift();
    }

    transaction.set(docRef, {
      messages: history,
      phone,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return history;
  });
}

async function callGemini(history: any[], apiKey: string): Promise<string> {
  const client = getGeminiClient(apiKey);

  const result = await Promise.race([
    client.models.generateContent({
      model: GEMINI_MODEL,
      contents: history,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      } as any,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Gemini timeout (30s)")), 30000)
    ),
  ]) as any;

  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini retornou resposta vazia.");
  return text;
}

async function sendWhatsApp(
  remoteJid: string,
  text: string,
  evolutionUrl: string,
  evolutionKey: string,
  instance: string
): Promise<void> {
  const number = remoteJid.split("@")[0];

  await axios.post(
    `${evolutionUrl}/message/sendText/${instance}`,
    { number, text },
    {
      headers: {
        apikey: evolutionKey,
        "ngrok-skip-browser-warning": "true",
      },
      timeout: 30000,
    }
  );
}

async function isMessageNew(messageId: string, remoteJid: string, text: string): Promise<boolean> {
  if (!messageId) return true;

  const docRef = db.collection("processed_messages").doc(messageId);

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (doc.exists) return false;

    transaction.set(docRef, {
      processedAt: FieldValue.serverTimestamp(),
      remoteJid,
      text: text.substring(0, 100),
    });
    return true;
  });
}

export const whatsappWebhook = onRequest(
  { secrets: [GEMINI_API_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE] },
  async (req, res) => {
    const { event, data } = req.body;

    if (event !== "messages.upsert" || !data || data.key?.fromMe) {
      res.status(200).send("Ignored");
      return;
    }

    const remoteJid: string = data.key.remoteJid;
    const messageId: string = data.key.id;

    // Ignora grupos e @lid (formato privado do WhatsApp)
    if (remoteJid.includes("@g.us") || remoteJid.includes("@lid")) {
      res.status(200).send("Filtered");
      return;
    }

    const userText: string = data.message?.conversation ||
      data.message?.extendedTextMessage?.text || "";

    if (!userText) {
      res.status(200).send("No text");
      return;
    }

    if (!(await isMessageNew(messageId, remoteJid, userText))) {
      res.status(200).send("Duplicate");
      return;
    }

    try {
      const history = await syncChatHistory(remoteJid, "user", userText);
      const aiResponse = await callGemini(history, GEMINI_API_KEY.value());
      await syncChatHistory(remoteJid, "model", aiResponse);
      await sendWhatsApp(
        remoteJid,
        aiResponse,
        EVOLUTION_API_URL.value(),
        EVOLUTION_API_KEY.value(),
        EVOLUTION_INSTANCE.value()
      );

      res.status(200).send("OK");
    } catch (error: any) {
      console.error("[Error]", error.message);
      res.status(500).send({ status: "error", message: error.message });
    }
  }
);

// Limpeza diária do Firestore
export const cleanProcessedMessages = onSchedule("every 24 hours", async () => {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  const snapshot = await db
    .collection("processed_messages")
    .where("processedAt", "<", cutoff)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  console.log(`[Cleanup] ${snapshot.size} documentos removidos.`);
});
```

### 7.2 Por que usamos o SDK `@google/genai` em vez de Axios?

| | SDK `@google/genai` | Axios direto |
|---|---|---|
| Tipagem TypeScript | ✅ Nativa | ❌ Manual |
| Manutenção | ✅ Automática com updates | ❌ Quebra com mudanças de API |
| Autenticação | ✅ Gerenciada | ❌ Manual |
| Retry automático | ✅ Sim | ❌ Não |

### 7.3 Por que usar Secret Manager em vez de `.env`?

| | Secret Manager | `.env` local |
|---|---|---|
| Segurança | ✅ Criptografado | ❌ Texto puro |
| Rotação de chaves | ✅ Versionado | ❌ Manual |
| Acesso auditado | ✅ Logs de acesso | ❌ Nenhum |
| CI/CD | ✅ Integrado | ❌ Risco de commit |

---

## 8. 🚀 Deploy

### 8.1 Build e deploy

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions
```

### 8.2 Configurar permissões de acesso público

Após o primeiro deploy, libere o acesso público à Cloud Function:

1. Acesse [console.cloud.google.com/run](https://console.cloud.google.com/run)
2. Clique em **whatsappwebhook**
3. Aba **"Segurança"** → selecione **"Permitir acesso público"**
4. Salve

### 8.3 Configurar permissões do IAM

Acesse [IAM do Google Cloud](https://console.cloud.google.com/iam-admin/iam) e adicione os seguintes papéis para a conta `SEU_PROJECT_NUMBER-compute@developer.gserviceaccount.com`:

- Cloud Build Service Account
- Logs Writer
- Storage Object Admin
- Artifact Registry Writer
- Cloud Datastore User

---

## 9. 🔗 Configurando o Webhook da Evolution API

### 9.1 Registrar o webhook

```bash
curl -X POST "http://localhost:8080/webhook/set/fleetmaster" \
  -H "apikey: SUA_CHAVE_EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "url": "https://whatsappwebhook-XXXX-uc.a.run.app",
      "enabled": true,
      "events": ["MESSAGES_UPSERT"],
      "webhookByEvents": false,
      "webhookBase64": false
    }
  }'
```

### 9.2 Verificar o webhook

```bash
curl -X GET "http://localhost:8080/webhook/find/fleetmaster" \
  -H "apikey: SUA_CHAVE_EVOLUTION"
```

---

## 10. 🧪 Testando sem número real

Simule uma mensagem chegando diretamente na Cloud Function:

```bash
curl -X POST "https://whatsappwebhook-XXXX-uc.a.run.app" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "fromMe": false,
        "id": "TEST_MESSAGE_ID_001"
      },
      "message": {
        "conversation": "Olá, quero saber sobre os planos"
      }
    }
  }'
```

Resposta esperada: `OK`

### 10.1 Testar envio direto pela Evolution API

```bash
curl -X POST "http://localhost:8080/message/sendText/fleetmaster" \
  -H "apikey: SUA_CHAVE_EVOLUTION" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5511999999999",
    "text": "Teste direto da Evolution API"
  }'
```

---

## 11. 📊 Monitoramento

### 11.1 Criar canal de notificação

```bash
gcloud alpha monitoring channels create \
  --display-name="FleetMaster Alerts" \
  --type=email \
  --channel-labels=email_address=seu@email.com
```

### 11.2 Criar política de alertas

1. Acesse [console.cloud.google.com/monitoring/alerting](https://console.cloud.google.com/monitoring/alerting)
2. Clique em **"Criar política"**
3. Métrica: **Cloud Run Revision → Request Count**
4. Filtros:
   - `service_name = whatsappwebhook`
   - `response_code_class = 5xx`
5. Threshold: `3` erros em `5 minutos`
6. Notificação: canal criado no passo anterior
7. Nome: `FleetMaster Bot - Erros Críticos`

---

## 12. 🔄 Atualizar a URL do ngrok

Sempre que reiniciar o ngrok, a URL muda. Atualize o secret:

```bash
echo -n "https://nova-url.ngrok-free.app" | gcloud secrets versions add EVOLUTION_API_URL --data-file=-
firebase deploy --only functions
```

---

## 13. 📁 Estrutura do Projeto

```
fleetmaster-bot/
├── evolution-api/
│   ├── docker-compose.yml
│   └── .env                    # NÃO commitar no git
├── functions/
│   ├── src/
│   │   └── index.ts            # Cloud Function principal
│   ├── lib/                    # Build gerado automaticamente
│   ├── package.json
│   └── tsconfig.json
├── .firebaserc
├── firebase.json
└── README.md
```

---

## 14. ⚠️ Problemas Comuns

**QR Code não aparece**
→ Verifique a variável `CONFIG_SESSION_PHONE_VERSION` no `.env` da Evolution API. Use a versão mais recente.

**Mensagem duplicada**
→ A Evolution API envia dois webhooks para a mesma mensagem (um `@s.whatsapp.net` e um `@lid`). O código já filtra `@lid` automaticamente e usa deduplicação por `messageId`.

**Cloud Function retorna 403**
→ Verifique se o acesso público está liberado no Cloud Run.

**Secret não encontrado**
→ Confirme que a conta de serviço tem o papel `roles/secretmanager.secretAccessor`.

**ngrok retorna 502**
→ A Evolution API caiu. Execute `docker-compose restart evolution-api`.

---

## 15. ✅ Checklist de Produção

- [ ] Evolution API em VPS (não depender do ngrok)
- [ ] URL fixa configurada no Secret Manager
- [ ] Reconexão automática do WhatsApp configurada
- [ ] Alertas de monitoramento ativos
- [ ] Backup do Firestore configurado
- [ ] Regras de segurança do Firestore revisadas

---

## 🛠️ Tecnologias

| Tecnologia | Uso |
|---|---|
| Firebase Cloud Functions | Webhook e lógica principal |
| Google Firestore | Histórico de conversas |
| Google Secret Manager | Armazenamento seguro de chaves |
| Google Gemini 2.5 Flash | Modelo de IA |
| Evolution API | Integração com WhatsApp |
| Docker + PostgreSQL | Infraestrutura da Evolution API |
| ngrok | Túnel para desenvolvimento local |

---

## 📄 Licença

MIT
