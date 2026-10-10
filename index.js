// index.js — Vestrex WhatsApp AI Bot v3.2.2 (Dashboard Fix)
const express = require('express');
const { OpenAI } = require('openai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// 💾 PERSISTENT STORAGE SETUP
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) { console.error('Dir error:', e); }
});

const FILES = {
    chats: path.join(DATA_DIR, 'chats.json'),
    settings: path.join(DATA_DIR, 'settings.json'),
    prompt: path.join(DATA_DIR, 'prompt.json'),
    media: path.join(DATA_DIR, 'media.json'),
    pausedAi: path.join(DATA_DIR, 'paused.json')
};

function loadJSON(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) { console.error(`Load error ${filePath}:`, err.message); }
    return defaultValue;
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) { console.error(`Save error ${filePath}:`, err.message); return false; }
}

const chatStore = new Map(loadJSON(FILES.chats, []));
const aiPausedSet = new Set(loadJSON(FILES.pausedAi, []));

let botSettings = loadJSON(FILES.settings, {
    botName: 'Vestrex Bot', language: 'Roman Urdu + English',
    welcomeMessage: 'Assalam o Alaikum! 👕 Vestrex Clothing mein khush aamdeed! Kaise madad kar sakta hoon?',
    awayMessage: 'Shukriya aapke message ka! Humari team jaldi reply karegi. 🙏',
    isAway: false, autoReplyDelay: 0, workingHoursEnabled: false, workingHoursStart: '09:00', workingHoursEnd: '22:00',
    maxAIResponseLength: 300, aiTemperature: 0.7, aiModel: 'gpt-4o-mini'
});

let systemPrompt = loadJSON(FILES.prompt, { 
    prompt: `Tu Vestrex Clothing ka official WhatsApp sales assistant hai. Tera naam "Vestrex Bot" hai.\nTu Pakistani Roman Urdu aur English mix mein baat karega.\n\nBRAND INFO:\n- Brand: Vestrex\n- Products: T-Shirts, Polo Shirts, Dress Shirts\n- Sizes: S, M, L, XL\n- Delivery: Karachi 150 PKR | Other 250 PKR\n- COD Available\n\nPRICING:\n- Basic T-Shirt: 899 PKR\n- Premium: 1299 PKR\n- Polo: 1499 PKR\n- Dress Shirt: 1799 PKR\n\nRULES:\n1. Friendly reh\n2. Short replies de (2-3 lines max)\n3. Order details le: Name, City, Address, Phone, Product, Size` 
}).prompt;

function saveChats() { saveJSON(FILES.chats, Array.from(chatStore.entries())); }
function savePaused() { saveJSON(FILES.pausedAi, Array.from(aiPausedSet)); }

setInterval(() => { saveChats(); savePaused(); }, 15000);

// ============================================
// UPLOADS SETUP
// ============================================
app.use('/uploads', express.static(UPLOADS_DIR));
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 16 * 1024 * 1024 } });

// ============================================
// ENV & API SETUP
// ============================================
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1411969538659249';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'vestrex123secret';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================
// WHATSAPP API HELPERS
// ============================================
async function uploadMediaToWhatsApp(filePath, mimeType) {
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));
        formData.append('type', mimeType);
        formData.append('messaging_product', 'whatsapp');
        
        const response = await fetch(`https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/media`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, ...formData.getHeaders() }, body: formData
        });
        const data = await response.json();
        return data.id || null;
    } catch (err) { console.error('Upload Error:', err.message); return null; }
}

async function sendWAMessage(to, payload) {
    try {
        const response = await fetch(`https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload })
        });
        const data = await response.json();
        if (data.error) return { success: false, error: data.error.message };
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function getAIReply(phone) {
    const chat = chatStore.get(phone);
    if (!chat) return botSettings.welcomeMessage;
    const messages = [{ role: 'system', content: systemPrompt }, ...chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-15).map(m => ({ role: m.role, content: m.content || '[Media]' }))];
    try {
        const res = await openai.chat.completions.create({ model: botSettings.aiModel, messages, max_tokens: botSettings.maxAIResponseLength, temperature: botSettings.aiTemperature });
        return res.choices[0].message.content.trim();
    } catch (err) { return 'Sorry, system busy hai. Thodi der baad try karein.'; }
}

// ============================================
// WEBHOOK (Incoming Messages)
// ============================================
app.get('/webhook', (req, res) => req.query['hub.verify_token'] === VERIFY_TOKEN ? res.status(200).send(req.query['hub.challenge']) : res.sendStatus(403));

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        const entries = req.body.entry;
        if (!entries) return;
        for (const entry of entries) {
            for (const change of entry.changes || []) {
                const value = change.value;
                if (!value || !value.messages) continue;
                
                const contactName = value.contacts?.[0]?.profile?.name || '';
                for (const msg of value.messages) {
                    const phone = msg.from;
                    if (!phone) continue;

                    if (!chatStore.has(phone)) {
                        chatStore.set(phone, { 
                            messages: [], 
                            name: contactName || '+' + phone, 
                            lastSeen: new Date().toISOString(), 
                            aiPaused: false, 
                            unread: 0 
                        });
                    }
                    const chat = chatStore.get(phone);
                    if (contactName) chat.name = contactName;
                    chat.lastSeen = new Date().toISOString();
                    chat.unread = (chat.unread || 0) + 1;
                    
                    let content = `[${msg.type}]`, type = msg.type;
                    if (msg.type === 'text') content = msg.text?.body || '';
                    else if (msg.type === 'image') content = msg.image?.caption || '📷 Photo';
                    else if (msg.type === 'audio') content = '🎤 Voice Note';
                    
                    chat.messages.push({ role: 'user', content, timestamp: new Date().toISOString(), type });
                    saveChats();

                    if (aiPausedSet.has(phone) || chat.aiPaused || botSettings.isAway) continue;

                    if (msg.type === 'text') {
                        const aiReply = await getAIReply(phone);
                        const sent = await sendWAMessage(phone, { type: 'text', text: { body: aiReply } });
                        if (sent.success) {
                            chat.messages.push({ role: 'assistant', content: aiReply, timestamp: new Date().toISOString(), sender: 'ai', type: 'text' });
                            saveChats();
                        }
                    }
                }
            }
        }
    } catch (err) { console.error('Webhook Error:', err.message); }
});

// ============================================
// API ROUTES FOR DASHBOARD
// ============================================
app.get('/api/chats', (req, res) => {
    try {
        const chats = Array.from(chatStore.entries()).map(([phone, chat]) => {
            const msgs = chat.messages || [];
            const lastMsgObj = msgs.length ? msgs[msgs.length - 1] : null;
            const lastMsgText = lastMsgObj ? String(lastMsgObj.content || lastMsgObj.type || '') : '';
            
            return {
                phone: String(phone || ''),
                name: String(chat.name || phone || 'Customer'),
                lastMessage: lastMsgText.substring(0, 50),
                lastSeen: chat.lastSeen || new Date().toISOString(),
                aiPaused: Boolean(aiPausedSet.has(phone) || chat.aiPaused),
                unread: Number(chat.unread || 0)
            };
        }).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
        
        res.json(chats);
    } catch (e) {
        console.error('API /api/chats Error:', e);
        res.json([]);
    }
});

app.get('/api/chats/:phone', (req, res) => {
    const phone = req.params.phone;
    const chat = chatStore.get(phone);
    if (!chat) return res.status(404).json({ error: 'Not found' });
    chat.unread = 0; saveChats();
    res.json({ 
        phone: String(phone), 
        name: String(chat.name || phone), 
        aiPaused: Boolean(aiPausedSet.has(phone) || chat.aiPaused), 
        messages: chat.messages || [] 
    });
});

// SEND TEXT REPLY
app.post('/api/reply', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });
    
    aiPausedSet.add(phone); savePaused();
    let chat = chatStore.get(phone);
    if (!chat) {
        chatStore.set(phone, { messages: [], name: '+' + phone, lastSeen: new Date().toISOString(), aiPaused: true, unread: 0 });
        chat = chatStore.get(phone);
    }
    chat.aiPaused = true;
    
    const sent = await sendWAMessage(phone, { type: 'text', text: { body: message } });
    if (sent.success) {
        chat.messages.push({ role: 'assistant', content: message, timestamp: new Date().toISOString(), sender: 'admin', type: 'text' });
        chat.lastSeen = new Date().toISOString();
        saveChats();
        return res.json({ success: true });
    }
    res.status(500).json({ error: sent.error });
});

// SEND MEDIA REPLY
app.post('/api/reply-media', upload.single('media'), async (req, res) => {
    const { phone, caption } = req.body;
    if (!phone || !req.file) return res.status(400).json({ error: 'Missing file or phone' });
    
    aiPausedSet.add(phone); savePaused();
    let chat = chatStore.get(phone);
    if (!chat) {
        chatStore.set(phone, { messages: [], name: '+' + phone, lastSeen: new Date().toISOString(), aiPaused: true, unread: 0 });
        chat = chatStore.get(phone);
    }
    chat.aiPaused = true;

    const waMediaId = await uploadMediaToWhatsApp(req.file.path, req.file.mimetype);
    if (!waMediaId) return res.status(500).json({ error: 'Meta upload failed' });

    let payload = {}, type = 'document';
    if (req.file.mimetype.startsWith('image/')) { type = 'image'; payload = { type: 'image', image: { id: waMediaId, caption: caption || '' } }; }
    else if (req.file.mimetype.startsWith('video/')) { type = 'video'; payload = { type: 'video', video: { id: waMediaId, caption: caption || '' } }; }
    else { payload = { type: 'document', document: { id: waMediaId, filename: req.file.originalname, caption: caption || '' } }; }

    const sent = await sendWAMessage(phone, payload);
    if (sent.success) {
        chat.messages.push({ role: 'assistant', content: caption || `[${type} sent]`, timestamp: new Date().toISOString(), sender: 'admin', type, mediaUrl: `/uploads/${req.file.filename}` });
        chat.lastSeen = new Date().toISOString();
        saveChats();
        return res.json({ success: true });
    }
    res.status(500).json({ error: sent.error });
});

// SEND VOICE
app.post('/api/send-voice', upload.single('voice'), async (req, res) => {
    const { phone } = req.body;
    if (!phone || !req.file) return res.status(400).json({ error: 'Missing voice file or phone' });
    
    aiPausedSet.add(phone); savePaused();
    let chat = chatStore.get(phone);
    if (!chat) {
        chatStore.set(phone, { messages: [], name: '+' + phone, lastSeen: new Date().toISOString(), aiPaused: true, unread: 0 });
        chat = chatStore.get(phone);
    }
    chat.aiPaused = true;

    const waMediaId = await uploadMediaToWhatsApp(req.file.path, 'audio/ogg; codecs=opus');
    if (!waMediaId) return res.status(500).json({ error: 'Voice upload failed' });

    const sent = await sendWAMessage(phone, { type: 'audio', audio: { id: waMediaId } });
    if (sent.success) {
        chat.messages.push({ role: 'assistant', content: '🎤 Voice note sent', timestamp: new Date().toISOString(), sender: 'admin', type: 'audio', mediaUrl: `/uploads/${req.file.filename}` });
        chat.lastSeen = new Date().toISOString();
        saveChats();
        return res.json({ success: true });
    }
    res.status(500).json({ error: sent.error });
});

app.post('/api/pause/:phone', (req, res) => { 
    aiPausedSet.add(req.params.phone); 
    const chat = chatStore.get(req.params.phone); if (chat) chat.aiPaused = true;
    savePaused(); saveChats(); 
    res.json({ success: true }); 
});

app.post('/api/resume/:phone', (req, res) => { 
    aiPausedSet.delete(req.params.phone); 
    const chat = chatStore.get(req.params.phone); if (chat) chat.aiPaused = false;
    savePaused(); saveChats(); 
    res.json({ success: true }); 
});

app.get('/api/prompt', (req, res) => res.json({ prompt: systemPrompt }));
app.post('/api/prompt', (req, res) => { systemPrompt = req.body.prompt; saveJSON(FILES.prompt, { prompt: systemPrompt }); res.json({ success: true }); });

app.get('/api/settings', (req, res) => res.json(botSettings));
app.post('/api/settings', (req, res) => { botSettings = { ...botSettings, ...req.body }; saveJSON(FILES.settings, botSettings); res.json({ success: true }); });

// SERVE DASHBOARD
app.get('/admin', (req, res) => res.send(getAdminHTML()));

// START SERVER
app.listen(PORT, () => console.log(`🚀 Vestrex Bot v3.2.2 Running on port ${PORT}`));

// ============================================
// ADMIN DASHBOARD HTML (BULLETPROOF FRONTEND)
// ============================================
function getAdminHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Vestrex Admin Dashboard</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
    --bg: #0f1115; --panel: #1a1c23; --card: #232530; --hover: #2a2d39; --border: #2d303e;
    --text: #e2e8f0; --dim: #94a3b8; --accent: #6366f1; --accent-hover: #4f46e5;
    --green: #10b981; --red: #ef4444; --orange: #f59e0b;
}
html, body { height: 100dvh; overflow: hidden; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; }
.app-container { display: flex; height: 100dvh; width: 100vw; overflow: hidden; }
.sidebar { width: 340px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; z-index: 10; }
.sb-header { padding: 16px; border-bottom: 1px solid var(--border); }
.brand { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: 1px; }
.sb-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.btn-sm { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 8px; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer; text-align: center; }
.btn-sm:hover { background: var(--hover); border-color: var(--accent); }
.chat-list { flex: 1; overflow-y: auto; padding: 8px; }
.chat-item { display: flex; align-items: center; padding: 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; border: 1px solid transparent; }
.chat-item:hover { background: var(--card); }
.chat-item.active { background: rgba(99,102,241,0.15); border-color: var(--accent); }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; flex-shrink: 0; margin-right: 12px; }
.chat-info { flex: 1; min-width: 0; }
.chat-name { font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-preview { font-size: 12px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.badge { background: var(--red); color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: bold; }
.main-area { flex: 1; display: flex; flex-direction: column; background: var(--bg); min-width: 0; position: relative; }
.no-chat-selected { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--dim); }
.chat-header { padding: 16px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.ch-left { display: flex; align-items: center; gap: 12px; }
.back-btn { display: none; background: none; border: none; color: var(--text); font-size: 20px; cursor: pointer; padding: 0 8px; }
.ch-status { font-size: 11px; padding: 4px 8px; border-radius: 12px; font-weight: 600; }
.st-on { background: rgba(16,185,129,0.2); color: var(--green); }
.st-off { background: rgba(245,158,11,0.2); color: var(--orange); }
.messages-wrapper { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.msg { max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
.msg-u { align-self: flex-start; background: var(--card); border-bottom-left-radius: 2px; }
.msg-ai { align-self: flex-end; background: #2d3748; border-bottom-right-radius: 2px; }
.msg-adm { align-self: flex-end; background: var(--accent); color: white; border-bottom-right-radius: 2px; }
.msg img, .msg video { max-width: 100%; border-radius: 8px; margin-top: 5px; }
.msg audio { width: 250px; margin-top: 5px; }
.m-meta { font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 4px; text-align: right; }
.reply-area { padding: 16px; background: var(--panel); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.tools { display: flex; gap: 8px; }
.tool-btn { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.input-row { display: flex; gap: 10px; align-items: flex-end; }
textarea { flex: 1; background: var(--bg); border: 1px solid var(--border); color: white; padding: 12px; border-radius: 10px; resize: none; outline: none; font-family: inherit; font-size: 14px; min-height: 45px; max-height: 120px; }
.send-btn { background: var(--accent); color: white; border: none; padding: 12px 20px; border-radius: 10px; font-weight: bold; cursor: pointer; height: 45px; }
.file-preview { display: none; background: var(--card); padding: 10px; border-radius: 8px; border: 1px solid var(--border); justify-content: space-between; align-items: center; }
.voice-ui { display: none; background: var(--card); padding: 12px; border-radius: 8px; border: 1px solid var(--red); align-items: center; gap: 12px; }
.vr-dot { width: 10px; height: 10px; background: var(--red); border-radius: 50%; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0; } }
.modal-bg { display: none; position: fixed; top:0; left:0; width: 100vw; height: 100dvh; background: rgba(0,0,0,0.8); z-index: 100; align-items: center; justify-content: center; padding: 16px; }
.modal { background: var(--panel); width: 100%; max-width: 500px; max-height: 90vh; border-radius: 16px; border: 1px solid var(--border); display: flex; flex-direction: column; }
.m-head { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
.m-body { padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.m-foot { padding: 16px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }
.modal input, .modal textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: white; padding: 10px; border-radius: 8px; outline: none; }
.btn-save { background: var(--green); color: white; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; }
.btn-close { background: transparent; border: none; color: var(--dim); cursor: pointer; font-size: 20px; }
#toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--accent); color: white; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: bold; z-index: 999; display: none; }
@media (max-width: 768px) {
    .sidebar { width: 100%; position: absolute; height: 100%; transition: 0.3s transform; }
    .main-area { width: 100%; position: absolute; height: 100%; transform: translateX(100%); transition: 0.3s transform; background: var(--bg); z-index: 20; }
    .app-container.chat-open .sidebar { transform: translateX(-30%); }
    .app-container.chat-open .main-area { transform: translateX(0); }
    .back-btn { display: block; }
    .msg { max-width: 85%; }
}
</style>
</head>
<body>

<div class="app-container" id="app">
    <div class="sidebar">
        <div class="sb-header">
            <div class="brand">VESTREX BOT</div>
            <div style="font-size: 11px; color: var(--green); margin-top: 4px;">● System Online</div>
            <div class="sb-actions">
                <button class="btn-sm" onclick="openModal('m-prompt')">✏️ Prompt</button>
                <button class="btn-sm" onclick="openModal('m-settings')">⚙️ Settings</button>
            </div>
        </div>
        <div style="padding: 10px; border-bottom: 1px solid var(--border);">
            <input type="text" id="search" placeholder="🔍 Search chats..." style="width: 100%; background: var(--bg); border: 1px solid var(--border); color: white; padding: 8px 12px; border-radius: 8px; outline: none; font-size: 13px;">
        </div>
        <div class="chat-list" id="chatList">
            <div style="text-align:center; color:var(--dim); padding:20px;">Loading chats...</div>
        </div>
    </div>

    <div class="main-area">
        <div id="noChat" class="no-chat-selected">
            <h2 style="color:white; margin-bottom:10px;">Vestrex Live Chat</h2>
            <p>Select a customer from the left sidebar to view messages.</p>
        </div>

        <div id="chatView" style="display: none; flex-direction: column; height: 100%;">
            <div class="chat-header">
                <div class="ch-left">
                    <button class="back-btn" onclick="closeChat()">←</button>
                    <div class="avatar" id="c-avatar">V</div>
                    <div>
                        <div style="font-weight: 600; color: white;" id="c-name">Customer</div>
                        <div style="font-size: 11px; color: var(--dim);" id="c-phone">+92...</div>
                    </div>
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <span id="aiBadge" class="ch-status st-on">🤖 AI On</span>
                    <button id="toggleAiBtn" onclick="toggleAI()" style="background:var(--card); border:1px solid var(--border); color:white; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">Pause</button>
                </div>
            </div>

            <div class="messages-wrapper" id="msgs"></div>

            <div class="reply-area">
                <div class="file-preview" id="filePrev">
                    <span id="fName" style="color:white; font-size:12px;">file.jpg</span>
                    <button onclick="clearFile()" style="background:var(--red); color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">X</button>
                </div>
                
                <div class="voice-ui" id="voiceUi">
                    <div class="vr-dot"></div>
                    <span id="vTime" style="color:white; font-weight:bold;">00:00</span>
                    <button onclick="stopVoice()" style="background:var(--card); color:white; border:1px solid var(--border); padding:6px 12px; border-radius:6px; cursor:pointer;">Stop</button>
                    <button id="vSendBtn" onclick="sendVoice()" style="display:none; background:var(--green); color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer;">Send Voice</button>
                    <button onclick="cancelVoice()" style="background:transparent; color:var(--dim); border:none; cursor:pointer;">Cancel</button>
                </div>

                <div class="tools">
                    <button class="tool-btn" onclick="document.getElementById('fileInput').click()">📎 Photo / Document</button>
                    <button class="tool-btn" onclick="startVoice()">🎤 Record Voice</button>
                </div>
                
                <div class="input-row">
                    <textarea id="msgInput" placeholder="Type a message..."></textarea>
                    <button class="send-btn" id="sendBtn" onclick="sendMessage()">Send</button>
                </div>
            </div>
        </div>
    </div>
</div>

<input type="file" id="fileInput" style="display:none;" accept="image/*,video/*,audio/*,.pdf" onchange="handleFileSelect(event)">

<div class="modal-bg" id="m-prompt">
    <div class="modal">
        <div class="m-head"><span>✏️ Edit AI Prompt</span><button class="btn-close" onclick="closeModal('m-prompt')">✕</button></div>
        <div class="m-body"><textarea id="promptText" style="height:300px; font-family:monospace;"></textarea></div>
        <div class="m-foot"><button class="btn-save" onclick="savePrompt()">Save Changes</button></div>
    </div>
</div>

<div class="modal-bg" id="m-settings">
    <div class="modal">
        <div class="m-head"><span>⚙️ Bot Settings</span><button class="btn-close" onclick="closeModal('m-settings')">✕</button></div>
        <div class="m-body">
            <label style="color:var(--dim); font-size:12px;">Welcome Message</label>
            <input type="text" id="setWelcome">
            <label style="color:var(--dim); font-size:12px;">Away Message</label>
            <input type="text" id="setAway">
            <label style="color:var(--text); font-size:14px; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="setIsAway" style="width:auto;"> Enable Away Mode
            </label>
        </div>
        <div class="m-foot"><button class="btn-save" onclick="saveSettings()">Save Settings</button></div>
    </div>
</div>

<div id="toast">Message</div>

<script>
var chats = [], currentPhone = null, pollTimer = null;
var pendingFile = null;
var mediaRec = null, audioChunks = [], recTimer = null, recSecs = 0, recBlob = null;

document.addEventListener('DOMContentLoaded', function() {
    fetchChats();
    pollTimer = setInterval(function() { 
        if(!pendingFile && !recBlob) fetchChats(true); 
    }, 2000);
});

function showToast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.style.background = isErr ? 'var(--red)' : 'var(--accent)';
    t.style.display = 'block'; setTimeout(function(){ t.style.display = 'none'; }, 3000);
}

function fetchChats(silent) {
    fetch('/api/chats')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        chats = Array.isArray(data) ? data : [];
        renderSidebar();
        if (currentPhone) fetchMessages(currentPhone, silent);
    })
    .catch(function(e) { console.error('Fetch chats error', e); });
}

function renderSidebar() {
    var term = (document.getElementById('search').value || '').toLowerCase();
    var list = document.getElementById('chatList');
    
    var filtered = chats.filter(function(c) {
        var nameStr = String(c.name || c.phone || 'Customer').toLowerCase();
        var phoneStr = String(c.phone || '');
        return nameStr.indexOf(term) > -1 || phoneStr.indexOf(term) > -1;
    });
    
    if(!filtered.length) { 
        list.innerHTML = '<div style="text-align:center; color:var(--dim); padding:20px;">No chats yet</div>'; 
        return; 
    }
    
    var html = '';
    for(var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        var cPhone = String(c.phone || '');
        var cName = String(c.name || cPhone || 'Customer');
        var cMsg = String(c.lastMessage || '');
        var active = cPhone === currentPhone ? ' active' : '';
        var badge = (c.unread > 0 && cPhone !== currentPhone) ? '<div class="badge">' + c.unread + '</div>' : '';
        var paused = c.aiPaused ? '⏸ ' : '';
        var timeStr = c.lastSeen ? new Date(c.lastSeen).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
        var initial = cName.charAt(0).toUpperCase() || 'C';

        html += '<div class="chat-item' + active + '" onclick="openChat(\'' + cPhone + '\')">' +
            '<div class="avatar">' + initial + '</div>' +
            '<div class="chat-info">' +
                '<div style="display:flex; justify-content:space-between;">' +
                    '<div class="chat-name">' + escapeHtml(cName) + '</div>' +
                    '<div style="font-size:10px; color:var(--dim);">' + timeStr + '</div>' +
                '</div>' +
                '<div style="display:flex; justify-content:space-between; margin-top:4px;">' +
                    '<div class="chat-preview">' + paused + escapeHtml(cMsg) + '</div>' + badge +
                '</div>' +
            '</div>' +
        '</div>';
    }
    list.innerHTML = html;
}

function openChat(phone) {
    currentPhone = String(phone);
    document.getElementById('app').classList.add('chat-open');
    document.getElementById('noChat').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('msgInput').focus();
    fetchMessages(currentPhone);
    renderSidebar();
}

function closeChat() {
    currentPhone = null;
    document.getElementById('app').classList.remove('chat-open');
}

function fetchMessages(phone, silent) {
    if(phone !== currentPhone) return;
    fetch('/api/chats/' + phone)
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var nameStr = String(data.name || data.phone || 'Customer');
        document.getElementById('c-name').textContent = nameStr;
        document.getElementById('c-phone').textContent = '+' + data.phone;
        document.getElementById('c-avatar').textContent = nameStr.charAt(0).toUpperCase();
        
        var badge = document.getElementById('aiBadge');
        var btn = document.getElementById('toggleAiBtn');
        if(data.aiPaused) { badge.className = 'ch-status st-off'; badge.textContent = '⏸ AI Paused'; btn.textContent = '▶️ Resume AI'; }
        else { badge.className = 'ch-status st-on'; badge.textContent = '🤖 AI Active'; btn.textContent = '⏸ Pause AI'; }

        var box = document.getElementById('msgs');
        var isBottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 60;
        
        var msgs = Array.isArray(data.messages) ? data.messages : [];
        var html = '';
        for(var i = 0; i < msgs.length; i++) {
            var m = msgs[i];
            var cls = 'msg-u', sender = 'Customer';
            if(m.sender === 'admin') { cls = 'msg-adm'; sender = 'You'; }
            else if(m.sender === 'ai') { cls = 'msg-ai'; sender = 'AI Bot'; }
            
            var media = '';
            if(m.mediaUrl) {
                if(m.type === 'image') media = '<br><img src="' + m.mediaUrl + '">';
                else if(m.type === 'video') media = '<br><video src="' + m.mediaUrl + '" controls></video>';
                else if(m.type === 'audio') media = '<br><audio src="' + m.mediaUrl + '" controls></audio>';
                else media = '<br><a href="' + m.mediaUrl + '" target="_blank" style="color:#fff;">📄 Open Attachment</a>';
            }
            var timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
            html += '<div class="msg ' + cls + '">' + escapeHtml(m.content || '') + media + '<div class="m-meta">' + sender + ' • ' + timeStr + '</div></div>';
        }
        box.innerHTML = html;
        if(isBottom || !silent) box.scrollTop = box.scrollHeight;
    })
    .catch(function(e) {});
}

function sendMessage() {
    if(!currentPhone) return;
    var text = document.getElementById('msgInput').value.trim();
    var btn = document.getElementById('sendBtn');
    
    if(pendingFile) { sendMediaWithText(text); return; }
    if(!text) return;

    btn.textContent = '...'; btn.disabled = true;
    fetch('/api/reply', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ phone: currentPhone, message: text }) 
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if(d.success) { 
            document.getElementById('msgInput').value = ''; 
            fetchMessages(currentPhone); 
            showToast('Message Sent', false); 
        } else { 
            showToast('Error: ' + (d.error || 'Failed'), true); 
        }
        btn.textContent = 'Send'; btn.disabled = false;
    })
    .catch(function(e) { 
        showToast('Network Error', true); 
        btn.textContent = 'Send'; btn.disabled = false; 
    });
}

function handleFileSelect(e) {
    if(!e.target.files[0]) return;
    pendingFile = e.target.files[0];
    document.getElementById('fName').textContent = pendingFile.name;
    document.getElementById('filePrev').style.display = 'flex';
}

function clearFile() {
    pendingFile = null; 
    document.getElementById('fileInput').value = '';
    document.getElementById('filePrev').style.display = 'none';
}

function sendMediaWithText(caption) {
    var btn = document.getElementById('sendBtn');
    btn.textContent = 'Up...'; btn.disabled = true;
    var fd = new FormData(); 
    fd.append('phone', currentPhone); 
    fd.append('media', pendingFile); 
    fd.append('caption', caption || '');
    
    fetch('/api/reply-media', { method: 'POST', body: fd })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if(d.success) { 
            document.getElementById('msgInput').value = ''; 
            clearFile(); 
            fetchMessages(currentPhone); 
            showToast('Media Sent', false); 
        } else { 
            showToast('Upload Failed: ' + (d.error || 'Failed'), true); 
        }
        btn.textContent = 'Send'; btn.disabled = false;
    })
    .catch(function(e) { 
        showToast('Upload Error', true); 
        btn.textContent = 'Send'; btn.disabled = false; 
    });
}

function startVoice() {
    try {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
            mediaRec = new MediaRecorder(stream); 
            audioChunks = []; recSecs = 0; recBlob = null;
            mediaRec.ondataavailable = function(e) { if(e.data.size > 0) audioChunks.push(e.data); };
            mediaRec.onstop = function() {
                recBlob = new Blob(audioChunks, { type: 'audio/webm' });
                stream.getTracks().forEach(function(t) { t.stop(); });
                document.getElementById('vSendBtn').style.display = 'block'; 
                clearInterval(recTimer);
            };
            mediaRec.start();
            document.getElementById('voiceUi').style.display = 'flex'; 
            document.getElementById('vSendBtn').style.display = 'none';
            recTimer = setInterval(function() { 
                recSecs++; 
                document.getElementById('vTime').textContent = String(Math.floor(recSecs/60)).padStart(2,'0') + ':' + String(recSecs%60).padStart(2,'0'); 
            }, 1000);
        }).catch(function(e) { showToast('Microphone permission denied', true); });
    } catch(e) { showToast('Microphone error', true); }
}

function stopVoice() { if(mediaRec && mediaRec.state === 'recording') mediaRec.stop(); }

function cancelVoice() {
    if(mediaRec && mediaRec.state === 'recording') mediaRec.stop();
    recBlob = null; 
    document.getElementById('voiceUi').style.display = 'none'; 
    clearInterval(recTimer);
}

function sendVoice() {
    if(!recBlob || !currentPhone) return;
    document.getElementById('vSendBtn').textContent = '...';
    var fd = new FormData(); 
    fd.append('phone', currentPhone); 
    fd.append('voice', recBlob, 'voice.webm');
    
    fetch('/api/send-voice', { method: 'POST', body: fd })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if(d.success) { 
            showToast('Voice Sent', false); 
            fetchMessages(currentPhone); 
            cancelVoice(); 
        } else { 
            showToast('Voice Error: ' + (d.error || 'Failed'), true); 
            document.getElementById('vSendBtn').textContent = 'Send Voice'; 
        }
    })
    .catch(function(e) { 
        showToast('Voice Upload Error', true); 
        document.getElementById('vSendBtn').textContent = 'Send Voice'; 
    });
}

function toggleAI() {
    if(!currentPhone) return;
    var c = chats.find(function(x) { return x.phone === currentPhone; });
    var end = (c && c.aiPaused) ? 'resume' : 'pause';
    fetch('/api/' + end + '/' + currentPhone, { method: 'POST' }).then(function() { fetchChats(true); });
}

function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    if(id === 'm-prompt') { 
        fetch('/api/prompt').then(function(r){ return r.json(); }).then(function(d){ document.getElementById('promptText').value = d.prompt || ''; }); 
    }
    if(id === 'm-settings') { 
        fetch('/api/settings').then(function(r){ return r.json(); }).then(function(d){ 
            document.getElementById('setWelcome').value = d.welcomeMessage || ''; 
            document.getElementById('setAway').value = d.awayMessage || ''; 
            document.getElementById('setIsAway').checked = !!d.isAway; 
        }); 
    }
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function savePrompt() {
    var p = document.getElementById('promptText').value;
    fetch('/api/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: p }) })
    .then(function() { showToast('Prompt Saved', false); closeModal('m-prompt'); });
}

function saveSettings() {
    var s = { 
        welcomeMessage: document.getElementById('setWelcome').value, 
        awayMessage: document.getElementById('setAway').value, 
        isAway: document.getElementById('setIsAway').checked 
    };
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    .then(function() { showToast('Settings Saved', false); closeModal('m-settings'); });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.getElementById('msgInput').addEventListener('keydown', function(e) {
    if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
document.getElementById('search').addEventListener('input', renderSidebar);
</script>
</body>
</html>`;
}
