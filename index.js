const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const app = express();
app.use(express.json());

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : "" 
});

// HOME PAGE (Check karne ke liye)
app.get("/", (req, res) => {
  res.send("<h1>Vestrex Bot is LIVE!</h1>");
});

// WEBHOOK (Meta Verification)
app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN || "vestrex123secret";
  if (req.query["hub.verify_token"] === verify_token) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// MESSAGE HANDLER WITH LOGS
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (msg?.text?.body) {
      const from = msg.from;
      const text = msg.text.body;

      console.log(`📩 Vestrex Customer (${from}): "${text}"`);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Tu Vestrex Clothing ka representative hai. Roman Urdu me short jawab de." }, { role: "user", content: text }],
      });

      const aiReply = completion.choices[0].message.content;
      console.log(`🤖 Vestrex AI Reply: "${aiReply}"`);

      await axios.post(`https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", recipient_type: "individual", to: from, type: "text", text: { body: aiReply }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}`, "Content-Type": "application/json" } });

      console.log(`✅ Message Delivered to ${from}`);
    }
  } catch (e) { console.error("❌ Error:", e.message); }
});
