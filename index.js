const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const app = express();
app.use(express.json());

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : "" 
});

// TEST ROUTE: Taake check kar sakein server chal raha hai
app.get("/", (req, res) => {
  res.send("<h1>Vestrex Bot is Running!</h1><p>Webhook path is: /webhook</p>");
});

// 1. Webhook Verification
app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN || "vestrex123secret";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verify_token) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

// 2. Message Handler
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
        messages: [{ role: "system", content: "Tu Vestrex Clothing ka representative hai." }, { role: "user", content: text }],
      });
      await axios.post(`https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", recipient_type: "individual", to: from, type: "text", text: { body: completion.choices[0].message.content }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}`, "Content-Type": "application/json" } });
    }
  } catch (e) { console.error(e.message); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server on port ${PORT}`));
