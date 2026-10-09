const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : "" 
});

// Vestrex Brand Tone
const SYSTEM_PROMPT = `
Tu "Vestrex" (Pakistan) ki sales representative hai. Tu WhatsApp par Roman Urdu / English me baat karti hai.
- Products: Premium T-Shirts, Dress Shirts, Polos.
- Price: Rs. 1500 - 2500 ke darmiyan (Customer ko rates short me batao).
- DC: Karachi Rs. 150 | Other Cities Rs. 250.
- Greeting: Pehli baar me "Khushamdeed" bolo, baad me direct jawab do.
- Goal: Customer se Size, Color aur Address lekar order confirm karna.
`;

// 1. Webhook Verification (Yahan se Meta connect hota hai)
app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN ? process.env.VERIFY_TOKEN.trim() : "vestrex123secret";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("✅ Webhook Verified Successfully!");
      return res.status(200).send(challenge);
    }
  }
  return res.sendStatus(403);
});

// 2. Incoming Message Handler
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    if (msg?.text?.body) {
      const from = msg.from;
      const text = msg.text.body;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: text }],
      });

      const aiReply = completion.choices[0].message.content;

      await axios.post(`https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: from,
        type: "text",
        text: { body: aiReply }
      }, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}`, "Content-Type": "application/json" }
      });
      console.log("✅ Reply sent to:", from);
    }
  } catch (e) {
    console.error("❌ Error:", e.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Vestrex Bot Live on Port ${PORT}`);
});
