const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : "" 
});

const chatHistories = new Map();
const lastMsgAt = new Map();
const followupSent = new Map();

// Default Vestrex Prompt (If Google Sheet is not set)
const DEFAULT_SYSTEM_PROMPT = `
Tu "Vestrex" (Pakistani Premium Clothing Brand) ki polite sales representative hai. Tu WhatsApp par Roman Urdu / English me baat karti hai.

BRAND DETAILS:
- Brand Name: Vestrex (Clothing / Apparel)
- Products: Premium T-Shirts, Dress Shirts, Polos, Denim.
- Sizes Available: Small (S), Medium (M), Large (L), Extra Large (XL).
- Price: Customer ko product ke mutabiq price batao.
- DC (Delivery Charges): Karachi Rs. 150 | Other Cities Rs. 250.

RULES:
- Customer se Size, Color, Quantity, Name, Phone Number, aur Full Address (City ke sath) poocho.
- Order confirm karne se pehle Size Chart aur Bill Summary zaroor batao.
- Short, polite, aur sales-focused replies do.
`;

async function getDynamicSystemPrompt() {
  const sheetUrl = process.env.SHEET_CSV_URL ? process.env.SHEET_CSV_URL.trim() : "";
  if (!sheetUrl) return DEFAULT_SYSTEM_PROMPT;
  try {
    const response = await axios.get(sheetUrl, { timeout: 3000 });
    const lines = response.data.split("\n");
    if (lines.length > 1) {
      let prompt = lines.slice(1).join("\n").replace(/^"|"$/g, '').trim();
      if (prompt && prompt.length > 20) return prompt;
    }
  } catch (e) {}
  return DEFAULT_SYSTEM_PROMPT;
}

app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN ? process.env.VERIFY_TOKEN.trim() : "vestrex123secret";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verify_token) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg || msg.type !== "text") return;

    const from = msg.from;
    const text = msg.text?.body;
    const phoneId = process.env.PHONE_NUMBER_ID ? process.env.PHONE_NUMBER_ID.trim() : "";
    const waToken = process.env.WHATSAPP_TOKEN ? process.env.WHATSAPP_TOKEN.trim() : "";

    const currentPrompt = await getDynamicSystemPrompt();

    if (!chatHistories.has(from)) {
      chatHistories.set(from, [{ role: "system", content: currentPrompt }]);
    } else {
      chatHistories.get(from)[0] = { role: "system", content: currentPrompt };
    }

    const history = chatHistories.get(from);
    history.push({ role: "user", content: text });
    if (history.length > 12) history.splice(1, history.length - 12);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history,
      max_tokens: 250,
      temperature: 0.3
    });

    const aiReply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: aiReply });

    await axios.post(
      `https://graph.facebook.com/v26.0/${phoneId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: from,
        type: "text",
        text: { body: aiReply }
      },
      { headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" } }
    );
  } catch (e) {}
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Vestrex Clothing Bot Live on Port ${PORT}`);
});
