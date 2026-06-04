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

const SYSTEM_INSTRUCTION = `Você é o assistente virtual do FleetMaster Logistics, uma plataforma SaaS de gestão 
logística para distribuidoras de materiais de construção.

## Seu papel
Você atende via WhatsApp e deve ajudar três perfis de usuários:
- **Gestores/Administradores**: dúvidas sobre planos, limites, relatórios, cadastros
- **Motoristas**: suporte ao uso do app mobile, registro de ocorrências, abastecimento
- **Novas empresas interessadas**: informações sobre planos, preços e período trial

## Planos disponíveis
- Starter (R$ 197/mês): até 3 funcionários, 5 motoristas, 5 caminhões. Sem IA.
- Professional (R$ 397/mês): até 10 funcionários, 20 motoristas, 20 caminhões. Inclui IA Gemini.
- Enterprise (R$ 797/mês): ilimitado. Suporte prioritário via WhatsApp + Email.
- Todos os planos têm 14 dias grátis, sem cartão de crédito.

## O que você pode fazer
- Informar sobre funcionalidades, planos e preços
- Orientar motoristas sobre uso do app (login, registro de viagem, ocorrências, abastecimento)
- Orientar gestores sobre cadastros, relatórios e alertas de vencimento (CNH, seguro)
- Direcionar problemas técnicos para o suporte humano

## O que você NÃO deve fazer
- Acessar ou alterar dados do sistema diretamente
- Confirmar pagamentos ou processar assinaturas
- Responder sobre assuntos fora da plataforma FleetMaster

## Tom e comportamento
- Responda sempre em português, de forma direta e cordial
- Seja objetivo — motoristas estão na estrada e precisam de respostas rápidas
- Quando não souber a resposta, direcione para: suporte@fleetmaster.com.br
- Para problemas urgentes (motorista parado, carga em risco), priorize encaminhamento humano`;

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

// Webhook principal
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
      console.log(`[Dedup] Ignorado: ${messageId}`);
      res.status(200).send("Duplicate");
      return;
    }

    try {
      console.log(`[Incoming] ${remoteJid}: ${userText}`);

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

      console.log(`[Success] ${remoteJid}`);
      res.status(200).send("OK");

    } catch (error: any) {
      console.error("[Error]", error.message, error.response?.data);
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

  if (snapshot.empty) {
    console.log("[Cleanup] Nada para limpar.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  console.log(`[Cleanup] ${snapshot.size} documentos removidos.`);
});