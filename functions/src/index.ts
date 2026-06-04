import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";

/**
 * Inicialização e Configuração do Ambiente
 */
initializeApp();
const db = getFirestore();

/** 
 * Definição dos Secrets do Google Cloud Secret Manager.
 * Estes valores são injetados na runtime da função para garantir máxima segurança.
 */
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const EVOLUTION_API_URL = defineSecret("EVOLUTION_API_URL");
const EVOLUTION_API_KEY = defineSecret("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE = defineSecret("EVOLUTION_INSTANCE");

/**
 * Instruções de Sistema (Prompt Base): Define a personalidade e regras de negócio do bot.
 */
const SYSTEM_INSTRUCTION = `Você é o assistente virtual do FleetMaster Logistics, uma plataforma SaaS de gestão 
logística para distribuidoras de materiais de construção.
... (restante das instruções)`;

const GEMINI_MODEL = "gemini-2.5-flash";
const HISTORY_LIMIT = 12;

let geminiClient: GoogleGenAI | null = null;

/**
 * Inicializa ou retorna a instância singleton do cliente Gemini (SDK v2.x).
 * @param {string} apiKey - Chave de API do Google AI Studio.
 * @returns {GoogleGenAI} Cliente configurado.
 */
function getGeminiClient(apiKey: string): GoogleGenAI {
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

/**
 * Sincroniza o histórico de mensagens no Firestore e formata para o padrão do Gemini.
 * Mantém uma janela deslizante de mensagens para controle de contexto/custo.
 * @param {string} phone - ID da conversa (Telefone).
 * @param {"user" | "model"} role - Autor da mensagem.
 * @param {string} text - Conteúdo da mensagem.
 * @returns {Promise<any[]>} Histórico atualizado.
 */
async function syncChatHistory(phone: string, role: "user" | "model", text: string) {
  const docRef = db.collection("conversations").doc(phone);

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    let history: any[] = doc.exists ? doc.data()?.messages || [] : [];

    history.push({ role, parts: [{ text }] });

    // Limita o tamanho do histórico
    if (history.length > HISTORY_LIMIT) {
      history = history.slice(-HISTORY_LIMIT);
    }

    // Valida que o histórico comece com o usuário (exigência do SDK)
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

/**
 * Realiza a chamada de geração de conteúdo para o modelo Gemini 2.5.
 * Inclui proteção de timeout e tratamento de resposta vazia.
 * @param {any[]} history - Histórico completo da conversa.
 * @param {string} apiKey - Chave de acesso.
 * @returns {Promise<string>} Resposta textual da IA.
 */
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

/**
 * Envia a resposta final para a Evolution API.
 * Formata o número removendo sufixos para garantir a entrega via WhatsApp.
 */
async function sendWhatsApp(remoteJid: string, text: string, evolutionUrl: string, evolutionKey: string, instance: string): Promise<void> {
  const number = remoteJid.split("@")[0];

  const response = await axios.post(
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

  console.log(`[Evolution] Status: ${response.status}`);
}

/**
 * Garante que cada mensagem seja processada apenas uma vez (Idempotência).
 * Utiliza o Firestore para rastrear IDs de mensagens processadas.
 */
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

/**
 * Webhook Principal: Ponto de entrada para todas as notificações de mensagens.
 * Gerencia o fluxo completo de atendimento automático.
 */
export const whatsappWebhook = onRequest(
  { secrets: [GEMINI_API_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE] },
  async (req, res) => {
    const { event, data } = req.body;

    // Filtro de pré-processamento
    if (event !== "messages.upsert" || !data || data.key?.fromMe) {
      res.status(200).send("Ignored");
      return;
    }

    const remoteJid: string = data.key.remoteJid;
    const messageId: string = data.key.id;

    // Bloqueia grupos e contatos @lid indesejados
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

    // Controle de duplicidade
    if (!(await isMessageNew(messageId, remoteJid, userText))) {
      console.log(`[Dedup] Ignorado: ${messageId}`);
      res.status(200).send("Duplicate");
      return;
    }

    try {
      console.log(`[Incoming] ${remoteJid}: ${userText}`);

      // Execução do Fluxo de IA
      const history = await syncChatHistory(remoteJid, "user", userText);
      const aiResponse = await callGemini(history, GEMINI_API_KEY.value());
      await syncChatHistory(remoteJid, "model", aiResponse);

      // Resposta ao usuário
      await sendWhatsApp(
        remoteJid,
        aiResponse,
        EVOLUTION_API_URL.value(),
        EVOLUTION_API_KEY.value(),
        EVOLUTION_INSTANCE.value()
      );

      console.log(`[Success] ${remoteJid}`);
      res.status(200).send("OK");

    } catch (error: any) {
      console.error("[Error]", error.message, error.response?.data);
      res.status(500).send({ status: "error", message: error.message });
    }
  }
);

/**
 * Função Agendada: Limpa documentos antigos de controle de idempotência a cada 24h.
 * Evita custos excessivos de armazenamento no Firestore.
 */
export const cleanProcessedMessages = onSchedule("every 24 hours", async () => {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  const snapshot = await db
    .collection("processed_messages")
    .where("processedAt", "<", cutoff)
    .limit(500)
    .get();

  if (snapshot.empty) {
    console.log("[Cleanup] Nada para limpar.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  console.log(`[Cleanup] ${snapshot.size} documentos removidos.`);
});