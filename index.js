const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : "" 
});

// Dynamic Settings & In-Memory Storage
let SYSTEM_PROMPT = `
Tu "Vestrex" (Pakistani Premium Clothing Brand) ki polite sales representative hai. Tu WhatsApp par Roman Urdu / English me baat karti hai.

BRAND DETAILS:
- Products: Premium T-Shirts, Dress Shirts, Polos, Denim.
- Sizes: Small (S), Medium (M), Large (L), Extra Large (XL).
- Prices: T-Shirts Rs. 1,200 | Polo Rs. 1,500 | Dress Shirts Rs. 1,800.
- Delivery Charges: Karachi Rs. 150 | Other Cities Rs. 250.

RULES:
- Customer se Size, Color, Quantity, Name, Phone Number, aur Address (City ke sath) poocho.
- Order confirm karne se pehle summary zaroor dikhao.
- Short, polite aur sales-focused replies do.
`;

const chatHistories = new Map(); // OpenAI Memory
const allChats = new Map();      // Dashboard Chat Store (phone -> messages[])
const pausedUsers = new Map();   // AI Pause State (phone -> boolean)

// Helper: Send WhatsApp Text via Meta API
async function sendWhatsAppMessage(to, text) {
  const phoneId = process.env.PHONE_NUMBER_ID ? process.env.PHONE_NUMBER_ID.trim() : "";
  const waToken = process.env.WHATSAPP_TOKEN ? process.env.WHATSAPP_TOKEN.trim() : "";

  return await axios.post(
    `https://graph.facebook.com/v26.0/${phoneId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { body: text }
    },
    { headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" } }
  );
}

// ------------------- ADMIN DASHBOARD UI -------------------
app.get("/admin", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vestrex Live Control Panel</title>
      <style>
        * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; }
        body { background: #f0f2f5; height: 100vh; display: flex; flex-direction: column; }
        header { background: #111827; color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
        header h1 { font-size: 20px; }
        .main { display: flex; flex: 1; overflow: hidden; }
        .sidebar { width: 320px; background: white; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; }
        .chat-list { flex: 1; overflow-y: auto; }
        .chat-item { padding: 15px; border-bottom: 1px solid #f3f4f6; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .chat-item:hover, .chat-item.active { background: #e0e7ff; }
        .chat-area { flex: 1; display: flex; flex-direction: column; background: #efeae2; }
        .chat-header { background: white; padding: 15px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        .msg { max-width: 65%; padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
        .msg.user { background: white; align-self: flex-start; border-bottom-left-radius: 0; }
        .msg.ai { background: #d9fdd3; align-self: flex-end; border-bottom-right-radius: 0; }
        .msg.admin { background: #c7d2fe; align-self: flex-end; border-bottom-right-radius: 0; border: 1px solid #818cf8; }
        .msg .time { font-size: 10px; color: #6b7280; text-align: right; margin-top: 4px; }
        .input-area { background: white; padding: 15px; display: flex; gap: 10px; border-top: 1px solid #e5e7eb; }
        input[type="text"] { flex: 1; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; outline: none; }
        button { padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
        button:hover { background: #4338ca; }
        .badge { font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: bold; }
        .badge.paused { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
        .badge.active { background: #f0fdf4; color: #16a34a; border: 1px solid #86efac; }
        .settings-btn { background: #374151; }
        .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 100; }
        .modal-content { background: white; width: 90%; max-width: 600px; padding: 25px; border-radius: 12px; }
        textarea { width: 100%; height: 250px; padding: 12px; margin: 15px 0; border: 1px solid #d1d5db; border-radius: 8px; font-family: monospace; }
      </style>
    </head>
    <body>
      <header>
        <h1>👕 Vestrex Live Admin Dashboard</h1>
        <button class="settings-btn" onclick="openSettings()">⚙️ Bot Settings / Rules</button>
      </header>

      <div class="main">
        <div class="sidebar">
          <div style="padding: 15px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #374151;">Customers</div>
          <div class="chat-list" id="chatList"></div>
        </div>

        <div class="chat-area">
          <div class="chat-header" id="chatHeader">
            <div><strong>Select a customer to start live chat</strong></div>
          </div>
          <div class="messages" id="messages"></div>
          <div class="input-area" id="inputArea" style="display: none;">
            <input type="text" id="adminInput" placeholder="Type your manual reply here..." onkeypress="if(event.key==='Enter') sendReply()">
            <button onclick="sendReply()">Send Reply</button>
          </div>
        </div>
      </div>

      <div class="modal" id="settingsModal">
        <div class="modal-content">
          <h2>⚙️ Edit Bot Rules & System Prompt</h2>
          <p style="font-size: 13px; color: #6b7280; margin-top: 5px;">Change prices, sizes, rules or tone here. Changes apply instantly!</p>
          <textarea id="promptInput">${SYSTEM_PROMPT.trim()}</textarea>
          <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button class="settings-btn" onclick="closeSettings()">Cancel</button>
            <button onclick="savePrompt()">Save Settings</button>
          </div>
        </div>
      </div>

      <script>
        let selectedPhone = null;

        async function fetchChats() {
          const res = await fetch('/api/chats');
          const data = await res.json();
          
          const chatList = document.getElementById('chatList');
          chatList.innerHTML = '';

          Object.keys(data.chats).forEach(phone => {
            const chat = data.chats[phone];
            const isPaused = data.paused[phone];
            const item = document.createElement('div');
            item.className = 'chat-item ' + (selectedPhone === phone ? 'active' : '');
            item.onclick = () => selectChat(phone, data);
            
            const lastMsg = chat.messages[chat.messages.length - 1]?.text || 'No messages';
            item.innerHTML = \`
              <div>
                <div style="font-weight: bold; color: #111827;">\${phone}</div>
                <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">\${lastMsg.substring(0, 25)}...</div>
              </div>
              <span class="badge \${isPaused ? 'paused' : 'active'}">\${isPaused ? 'AI Paused' : 'AI Active'}</span>
            \`;
            chatList.appendChild(item);
          });

          if (selectedPhone && data.chats[selectedPhone]) {
            renderMessages(data.chats[selectedPhone].messages);
            renderHeader(selectedPhone, data.paused[selectedPhone]);
          }
        }

        function selectChat(phone, data) {
          selectedPhone = phone;
          document.getElementById('inputArea').style.display = 'flex';
          fetchChats();
        }

        function renderHeader(phone, isPaused) {
          document.getElementById('chatHeader').innerHTML = \`
            <div>
              <strong>Customer: \${phone}</strong>
            </div>
            <button style="background: \${isPaused ? '#16a34a' : '#dc2626'};" onclick="togglePause('\${phone}')">
              \${isPaused ? '▶️ Resume AI' : '⏸️ Pause AI (Silence Bot)'}
            </button>
          \`;
        }

        function renderMessages(msgs) {
          const container = document.getElementById('messages');
          container.innerHTML = '';
          msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'msg ' + m.sender;
            div.innerHTML = \`
              <div>\${m.text}</div>
              <div class="time">\${m.sender.toUpperCase()} • \${m.time}</div>
            \`;
            container.appendChild(div);
          });
          container.scrollTop = container.scrollHeight;
        }

        async function sendReply() {
          const input = document.getElementById('adminInput');
          const text = input.value.trim();
          if (!text || !selectedPhone) return;

          input.value = '';
          await fetch('/api/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: selectedPhone, message: text })
          });
          fetchChats();
        }

        async function togglePause(phone) {
          await fetch('/api/toggle-pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
          });
          fetchChats();
        }

        function openSettings() { document.getElementById('settingsModal').style.display = 'flex'; }
        function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }

        async function savePrompt() {
          const prompt = document.getElementById('promptInput').value;
          await fetch('/api/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
          });
          alert('✅ Settings saved! Bot will now use updated rules.');
          closeSettings();
        }

        setInterval(fetchChats, 3000); // Live Auto-refresh every 3s
        fetchChats();
      </script>
    </body>
    </html>
  `);
});

// ------------------- API ENDPOINTS -------------------

// 1. Get Live Chats
app.get("/api/chats", (req, res) => {
  const chatsObj = {};
  const pausedObj = {};
  
  allChats.forEach((val, key) => { chatsObj[key] = val; });
  pausedUsers.forEach((val, key) => { pausedObj[key] = val; });

  res.json({ chats: chatsObj, paused: pausedObj });
});

// 2. Admin Manual Reply (Auto-pauses AI so AI doesn't interfere)
app.post("/api/reply", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).send("Missing data");

  try {
    await sendWhatsAppMessage(phone, message);

    // Auto Pause AI for this customer when Admin manually replies
    pausedUsers.set(phone, true);

    if (!allChats.has(phone)) allChats.set(phone, { messages: [] });
    
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    allChats.get(phone).messages.push({ sender: "admin", text: message, time: timeStr });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Toggle AI Pause / Resume
app.post("/api/toggle-pause", (req, res) => {
  const { phone } = req.body;
  const current = pausedUsers.get(phone) || false;
  pausedUsers.set(phone, !current);
  res.json({ success: true, paused: !current });
});

// 4. Update Bot Rules/Prompt
app.post("/api/prompt", (req, res) => {
  if (req.body.prompt) {
    SYSTEM_PROMPT = req.body.prompt.trim();
    console.log("⚙️ System Prompt Updated via Admin Panel!");
  }
  res.json({ success: true });
});

// ------------------- META WEBHOOKS -------------------

app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN || "vestrex123secret";
  if (req.query["hub.verify_token"] === verify_token) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];

    if (!msg || msg.type !== "text") return;

    const from = msg.from;
    const text = msg.text?.body;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    console.log(`📩 Customer (${from}): "${text}"`);

    // Store in Dashboard Chat History
    if (!allChats.has(from)) allChats.set(from, { messages: [] });
    allChats.get(from).messages.push({ sender: "user", text: text, time: timeStr });

    // Check if AI is Paused for this Customer
    if (pausedUsers.get(from) === true) {
      console.log(`⏸️ AI is PAUSED for ${from}. Skipping automated reply.`);
      return;
    }

    // OpenAI Conversation History
    if (!chatHistories.has(from)) {
      chatHistories.set(from, [{ role: "system", content: SYSTEM_PROMPT }]);
    } else {
      chatHistories.get(from)[0] = { role: "system", content: SYSTEM_PROMPT };
    }

    const history = chatHistories.get(from);
    history.push({ role: "user", content: text });
    if (history.length > 12) history.splice(1, history.length - 12);

    // AI Completion
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history,
      max_tokens: 250,
      temperature: 0.3
    });

    const aiReply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: aiReply });

    // Log AI reply
    allChats.get(from).messages.push({ sender: "ai", text: aiReply, time: timeStr });

    // Send AI Reply via WhatsApp
    await sendWhatsAppMessage(from, aiReply);
    console.log(`🤖 AI Replied to ${from}`);

  } catch (e) {
    console.error("❌ Webhook Error:", e.message);
  }
});

app.get("/", (req, res) => res.redirect("/admin"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Vestrex Master Control Dashboard Live on Port ${PORT}`);
});
