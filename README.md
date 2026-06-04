# FleetMaster Bot - Guia Completo de Instalação e Configuração

O **FleetMaster Bot** é um assistente logístico inteligente que integra o **Google Gemini 2.5** ao WhatsApp via **Firebase Functions** e **Evolution API**. Este guia detalha o passo a passo para configurar o ambiente do zero.

---

## 📌 Sumário
1. [Configuração do Google AI Studio](#1-configuração-do-google-ai-studio)
2. [Ambiente Local e Google Cloud CLI](#2-ambiente-local-e-google-cloud-cli)
3. [Segurança com Google Secret Manager](#3-segurança-com-google-secret-manager)
4. [Configuração do Firebase](#4-configuração-do-firebase)
5. [Desenvolvimento e Deploy](#5-desenvolvimento-e-deploy)
6. [Túnel com Ngrok](#6-túnel-com-ngrok)
7. [Testes e Validação](#7-testes-e-validação)

---

## 1. Configuração do Google AI Studio
O "cérebro" do bot é o modelo Gemini hospedado no AI Studio.

1.  Acesse o [Google AI Studio](https://aistudio.google.com/).
2.  **Plano**: Garanta que o faturamento esteja ativo ou use a cota gratuita (ajuste para o plano Pay-as-you-go se necessário para produção).
3.  **API Key**: Gere sua chave. Ela terá o prefixo `AQ.A...` (novo formato 2026).
4.  **Modelo**: O sistema está configurado para o `gemini-2.5-flash`.

---

## 2. Ambiente Local e Google Cloud CLI
Prepare seu terminal para gerenciar os serviços do Google Cloud.

### Instalar Google Cloud CLI
```bash
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
Em vez de usar arquivos `.env` (que podem vazar chaves), utilizamos o **Secret Manager** para armazenar credenciais sensíveis.

### Criar os Secrets
```bash
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_URL --replication-policy="automatic"
gcloud secrets create EVOLUTION_API_KEY --replication-policy="automatic"
gcloud secrets create EVOLUTION_INSTANCE --replication-policy="automatic"
```

### Adicionar Valores aos Secrets
```bash
echo -n "SUA_API_KEY_AQUI" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
echo -n "https://sua-url-ngrok.ngrok-free.app" | gcloud secrets versions add EVOLUTION_API_URL --data-file=-
echo -n "sua_chave_evolution" | gcloud secrets versions add EVOLUTION_API_KEY --data-file=-
echo -n "nome_da_instancia" | gcloud secrets versions add EVOLUTION_INSTANCE --data-file=-
```

### Dar Permissão de Acesso à Function
Substitua `[NUMERO_DO_PROJETO]` pelo número real do seu projeto Google Cloud.
```bash
for secret in GEMINI_API_KEY EVOLUTION_API_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:[NUMERO_DO_PROJETO]-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 4. Configuração do Firebase
O Firebase gerencia as Cloud Functions e o banco de dados Firestore.

### Firestore (Permissões)
Garantir que o Firestore esteja no modo nativo e com regras de segurança que permitam o acesso das Functions.
*   **Coleções necessárias**: `conversations` (histórico) e `processed_messages` (deduplicação).

### Inicialização local
```bash
npm install -g firebase-tools
firebase login
firebase init functions
```

---

## 5. Desenvolvimento e Deploy

### Instalar Dependências
```bash
cd functions
npm install @google/genai axios firebase-admin firebase-functions
```

### Build e Deploy
Sempre execute o build antes do deploy para transpilar o TypeScript.
```bash
# Compilar TS para JS
npm run build

# Deploy apenas da função do Webhook
firebase deploy --only functions
```

### Limpeza de Variáveis Legadas
Se você migrou do `.env` para o Secret Manager, remova as variáveis antigas para evitar conflitos:
```bash
gcloud run services update whatsappwebhook \
  --region=us-central1 \
  --remove-env-vars=GEMINI_API_KEY,EVOLUTION_API_URL,EVOLUTION_API_KEY,EVOLUTION_INSTANCE
```

---

## 6. Túnel com Ngrok
Para que a Evolution API (local ou docker) consiga falar com o mundo externo ou para testes locais.

1.  Inicie o ngrok na porta da sua Evolution API (geralmente 8080):
    ```bash
    ngrok http 8080
    ```
2.  Acompanhe as requisições em tempo real:
    Acesse [http://localhost:4040](http://localhost:4040) no seu navegador.

---

## 7. Testes e Validação
Você pode simular um recebimento de mensagem do WhatsApp usando o `curl`.

```bash
curl -X POST "https://us-central1-[SEU-PROJETO].cloudfunctions.net/whatsappWebhook" \
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
        "conversation": "Olá, como funciona o plano Starter?"
      }
    },
    "sender": "5511999999999@s.whatsapp.net"
  }'
```

---
*Este projeto foi estruturado seguindo as melhores práticas de Engenharia de Software e Segurança.*
