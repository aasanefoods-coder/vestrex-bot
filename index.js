const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });

// TEST LINK: Browser mein khol kar check karein logs chal rahi hain ya nahi
app.get("/", (req, res) => {
  console.log("✅ LOGS CHECK: Kisi ne Home Page khola hai!");
  res.send("<h1>Vestrex Server is Active! Check Logs now.</h1>");
});

// WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN || "vestrex123secret";
  if (req.query["hub.verify_token"] === verify_token) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

// MESSAGE HANDLER (Heavy Logging)
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Meta ko foran response dena zaroori hai
  
  // YE LINES LOGS MEIN ZAROOR NAZAR AAYENGI
  console.log("*****************************************");
  console.log("📩 NAYA DATA AAYA HAI!");
  console.log("TIME:", new Date().toLocaleString());
  console.log("FULL DATA:", JSON.stringify(req.body, null, 2));
  console.log("*****************************************");

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    if (msg?.text?.body) {
      const from = msg.from;
      const text = msg.text.body;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Tu Vestrex ka rep hai." }, { role: "user", content: text }],
      });

      await axios.post(`https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", recipient_type: "individual", to: from, type: "text", text: { body: completion.choices[0].message.content }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN.trim()}`, "Content-Type": "application/json" } });
      
      console.log(`✅ Jawab bhej diya gaya number: ${from} ko`);
    }
  } catch (e) {
    console.error("❌ ERROR AAYA HAI:", e.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("=========================================");
  console.log(`🚀 SERVER START HOGYA PORT ${PORT} PAR`);
  console.log("=========================================");
});
