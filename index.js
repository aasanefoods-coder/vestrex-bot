const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });

// AAPKA PERSONAL NUMBER (Jahan OTP forward hoga)
const MY_PERSONAL_NUMBER = "923267084716"; 

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    if (msg?.text?.body) {
      const from = msg.from;
      const text = msg.text.body;

      // 1. AAPKO FORWARD KARNA (OTP ya koi bhi message)
      await axios.post(`https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: MY_PERSONAL_NUMBER,
        type: "text",
        text: { body: `📩 Vestrex Alert!\nFrom: ${from}\nMessage: ${text}` }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}` } });

      // 2. AI REPLY TO CUSTOMER (Sirf agar message aapki taraf se na ho)
      if (from !== MY_PERSONAL_NUMBER) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Tu Vestrex Clothing ka rep hai." }, { role: "user", content: text }],
        });
        await axios.post(`https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`, {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: from,
          type: "text",
          text: { body: completion.choices[0].message.content }
        }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}` } });
      }
    }
  } catch (e) { console.log(e.message); }
});

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) res.send(req.query["hub.challenge"]);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Forwarder Active on ${PORT}`));
