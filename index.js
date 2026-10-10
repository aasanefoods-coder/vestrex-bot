// index.js — Vestrex WhatsApp AI Bot v3.1
// Owner: Aftab Ahmed | Brand: Vestrex Clothing
// NEW: Permanent JSON storage — Data survives redeploys!

const express = require('express');
const fetch = require('node-fetch');
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

// Create directories if they don't exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created: ${dir}`);
    }
});

// File paths for persistent data
const FILES = {
    chats: path.join(DATA_DIR, 'chats.json'),
    settings: path.join(DATA_DIR, 'settings.json'),
    prompt: path.join(DATA_DIR, 'prompt.json'),
    media: path.join(DATA_DIR, 'media.json'),
    scheduled: path.join(DATA_DIR, 'scheduled.json'),
    pausedAi: path.join(DATA_DIR, 'paused.json')
};

// ============================================
// 💾 LOAD DATA FROM DISK
// ============================================
function loadJSON(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error(`❌ Failed to load ${filePath}:`, err.message);
    }
    return defaultValue;
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error(`❌ Failed to save ${filePath}:`, err.message);
        return false;
    }
}

// Load existing data (or defaults)
const chatsData = loadJSON(FILES.chats, []);
const chatStore = new Map(chatsData);
console.log(`💾 Loaded ${chatStore.size} chats from disk`);

const pausedArray = loadJSON(FILES.pausedAi, []);
const aiPausedSet = new Set(pausedArray);
console.log(`💾 Loaded ${aiPausedSet.size} paused chats from disk`);

let mediaLibrary = loadJSON(FILES.media, []);
console.log(`💾 Loaded ${mediaLibrary.length} media items from disk`);

let scheduledMessages = loadJSON(FILES.scheduled, []);
console.log(`💾 Loaded ${scheduledMessages.length} scheduled messages from disk`);

let botSettings = loadJSON(FILES.settings, {
    botName: 'Vestrex Bot',
    language: 'Roman Urdu + English',
    welcomeMessage: 'Assalam o Alaikum! 👕 Vestrex Clothing mein khush aamdeed! Kaise madad kar sakta hoon?',
    awayMessage: 'Shukriya aapke message ka! Humari team jaldi reply karegi. 🙏',
    isAway: false,
    autoReplyDelay: 0,
    workingHoursEnabled: false,
    workingHoursStart: '09:00',
    workingHoursEnd: '22:00',
    sendWelcomeImage: false,
    welcomeImageId: null,
    maxAIResponseLength: 300,
    aiTemperature: 0.7,
    aiModel: 'gpt-4o-mini',
    notifyAdminOnNewChat: true,
    autoSendCatalog: false,
    catalogMediaIds: []
});

let systemPrompt = loadJSON(FILES.prompt, {
    prompt: `Tu Vestrex Clothing ka official WhatsApp sales assistant hai. Tera naam "Vestrex Bot" hai.

Tu Pakistani Roman Urdu aur English mix mein baat karega — bilkul jaise ek friendly shopkeeper baat karta hai.

BRAND INFO:
- Brand: Vestrex
- Products: T-Shirts, Polo Shirts, Dress Shirts
- Available Sizes: S, M, L, XL
- Delivery Charges: Karachi 150 PKR | Other cities 250 PKR
- Payment: Cash on Delivery (COD)
- Delivery Time: 3-5 working days
- Return Policy: 7 din ke andar exchange/return (unused, tags attached)

PRICING:
- Basic T-Shirt: 899 PKR
- Premium T-Shirt: 1299 PKR  
- Polo Shirt: 1499 PKR
- Dress Shirt: 1799 PKR

RULES:
1. Hamesha friendly aur professional reh
2. Customer ko product recommend kar based on unki need
3. Agar customer order dena chahe toh yeh info lo: Name, City, Address, Phone, Product, Size
4. Agar koi sawal tera scope se bahar ho toh bol "Yeh info ke liye humari team se contact karein"
5. Kabhi bhi competitor brands ka naam mat le
6. Har reply concise rakh — 2-3 lines max unless detail zaruri ho
7. Customer ko upsell kar politely
8. Agar customer complaint kare toh empathetic ban`
}).prompt;

// ============================================
// 💾 SAVE FUNCTIONS (Called on every change)
// ============================================
function saveChats() {
    const data = Array.from(chatStore.entries());
    saveJSON(FILES.chats, data);
}

function savePaused() {
    saveJSON(FILES.pausedAi, Array.from(aiPausedSet));
}

function saveSettings() {
    saveJSON(FILES.settings, botSettings);
}

function savePrompt() {
    saveJSON(FILES.prompt, { prompt: systemPrompt });
}

function saveMedia() {
    saveJSON(FILES.media, mediaLibrary);
}

function saveScheduled() {
    saveJSON(FILES.scheduled, scheduledMessages);
}

// ============================================
// 💾 AUTO-SAVE EVERY 30 SECONDS (Safety Net)
// ============================================
setInterval(() => {
    saveChats();
    savePaused();
    console.log(`💾 Auto-saved: ${chatStore.size} chats, ${aiPausedSet.size} paused`);
}, 30000);

// Save on process exit
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, saving data...');
    saveChats(); savePaused(); saveSettings(); savePrompt(); saveMedia(); saveScheduled();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, saving data...');
    saveChats(); savePaused(); saveSettings(); savePrompt(); saveMedia(); saveScheduled();
    process.exit(0);
});

// ============================================
// FILE UPLOADS SETUP
// ============================================
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, unique);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/3gpp',
            'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/opus', 'audio/webm',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('File type not supported'), false);
    }
});

// ============================================
// ENV VARIABLES
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
    const url = `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/media`;
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('type', mimeType);
    formData.append('messaging_product', 'whatsapp');
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, ...formData.getHeaders() },
            body: formData
        });
        const data = await response.json();
        if (data.id) return data.id;
        console.error('Upload failed:', data);
        return null;
    } catch (err) {
        console.error('Upload error:', err.message);
        return null;
    }
}

async function sendWhatsAppMessage(to, text) {
    const url = `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
        });
        const data = await response.json();
        if (data.error) { console.error('Send error:', data.error); return false; }
        return true;
    } catch (err) { console.error('Send failed:', err.message); return false; }
}

async function sendWhatsAppImage(to, mediaId, caption = '') {
    const url = `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;
    try {
        const body = { messaging_product: 'whatsapp', to, type: 'image', image: { id: mediaId } };
        if (caption) body.image.caption = caption;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return !data.error;
    } catch (err) { return false; }
}

async function sendWhatsAppVideo(to, mediaId, caption = '') {
    const url = `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;
    try {
        const body = { messaging_product: 'whatsapp', to, type: 'video', video: { id: mediaId } };
        if (caption) body.video.caption = caption;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return !data.error;
    } catch (err) { return false; }
}

async function sendWhatsAppAudio(to, mediaId) {
    const url = `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'audio', audio: { id: mediaId } })
        });
        const data = await response.json();
        return !data.error;
    } catch (err) { return false; }
}

async function sendWhatsAppDocument(to, mediaId, filename, caption = '') {
    const url = `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;
    try {
        const body = { messaging_product: 'whatsapp', to, type: 'document', document: { id: mediaId, filename } };
        if (caption) body.document.caption = caption;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return !data.error;
    } catch (err) { return false; }
}

async function downloadWhatsAppMedia(mediaId) {
    try {
        const urlRes = await fetch(`https://graph.facebook.com/v26.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
        });
        const urlData = await urlRes.json();
        if (!urlData.url) return null;
        const mediaRes = await fetch(urlData.url, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
        });
        const buffer = await mediaRes.buffer();
        const ext = (urlData.mime_type || 'application/octet-stream').split('/')[1] || 'bin';
        const filename = `received-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, '')}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
        return { filename, mimeType: urlData.mime_type, url: `/uploads/${filename}` };
    } catch (err) { console.error('Media download error:', err.message); return null; }
}

async function getAIReply(phone) {
    const chat = chatStore.get(phone);
    if (!chat) return botSettings.welcomeMessage;
    const messages = [
        { role: 'system', content: systemPrompt },
        ...chat.messages.filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-20)
            .map(m => ({ role: m.role, content: m.content }))
    ];
    try {
        const response = await openai.chat.completions.create({
            model: botSettings.aiModel,
            messages,
            max_tokens: botSettings.maxAIResponseLength,
            temperature: botSettings.aiTemperature
        });
        return response.choices[0].message.content.trim();
    } catch (err) {
        console.error('OpenAI Error:', err.message);
        return 'Sorry, thodi technical issue aa rahi hai. Please thodi der baad try karein.';
    }
}

function getOrCreateChat(phone, name) {
    if (!chatStore.has(phone)) {
        chatStore.set(phone, {
            messages: [],
            name: name || phone,
            lastSeen: new Date().toISOString(),
            aiPaused: false,
            unread: 0,
            isNew: true
        });
    }
    return chatStore.get(phone);
}

function isWithinWorkingHours() {
    if (!botSettings.workingHoursEnabled) return true;
    const now = new Date();
    const pk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
    const current = pk.getHours() * 60 + pk.getMinutes();
    const [sH, sM] = botSettings.workingHoursStart.split(':').map(Number);
    const [eH, eM] = botSettings.workingHoursEnd.split(':').map(Number);
    return current >= (sH * 60 + sM) && current <= (eH * 60 + eM);
}

// ============================================
// WEBHOOK
// ============================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        const body = req.body;
        if (!body.object) return;
        const entries = body.entry;
        if (!entries || !entries.length) return;

        for (const entry of entries) {
            const changes = entry.changes;
            if (!changes || !changes.length) continue;
            for (const change of changes) {
                const value = change.value;
                if (!value || !value.messages || !value.messages.length) continue;
                const contacts = value.contacts || [];
                const contactName = contacts.length > 0 ? contacts[0].profile?.name : null;

                for (const message of value.messages) {
                    const phone = message.from;
                    const timestamp = new Date().toISOString();
                    console.log(`📩 Message from ${phone} (${contactName}): type=${message.type}`);

                    const chat = getOrCreateChat(phone, contactName);
                    const wasNew = chat.isNew;
                    chat.name = contactName || chat.name;
                    chat.lastSeen = timestamp;
                    chat.unread = (chat.unread || 0) + 1;
                    chat.isNew = false;

                    let msgContent = '', msgType = 'text', mediaUrl = null;

                    if (message.type === 'text') {
                        msgContent = message.text.body;
                    } else if (message.type === 'image') {
                        msgType = 'image';
                        const media = await downloadWhatsAppMedia(message.image.id);
                        msgContent = message.image.caption || '📷 Image received';
                        if (media) mediaUrl = media.url;
                    } else if (message.type === 'video') {
                        msgType = 'video';
                        const media = await downloadWhatsAppMedia(message.video.id);
                        msgContent = message.video.caption || '🎥 Video received';
                        if (media) mediaUrl = media.url;
                    } else if (message.type === 'audio') {
                        msgType = 'audio';
                        const media = await downloadWhatsAppMedia(message.audio.id);
                        msgContent = '🎵 Voice message received';
                        if (media) mediaUrl = media.url;
                    } else if (message.type === 'document') {
                        msgType = 'document';
                        const media = await downloadWhatsAppMedia(message.document.id);
                        msgContent = message.document.caption || `📄 ${message.document.filename || 'file'}`;
                        if (media) mediaUrl = media.url;
                    } else if (message.type === 'sticker') {
                        msgType = 'sticker';
                        msgContent = '🏷️ Sticker received';
                    } else if (message.type === 'location') {
                        msgType = 'location';
                        msgContent = `📍 Location: ${message.location.latitude}, ${message.location.longitude}`;
                    } else {
                        msgContent = `[${message.type} message]`;
                    }

                    chat.messages.push({
                        role: 'user', content: msgContent, timestamp, type: msgType, mediaUrl
                    });

                    // 💾 SAVE AFTER EVERY MESSAGE
                    saveChats();

                    if (aiPausedSet.has(phone) || chat.aiPaused) {
                        console.log(`⏸️ AI paused for ${phone}`);
                        continue;
                    }

                    if (botSettings.isAway) {
                        await sendWhatsAppMessage(phone, botSettings.awayMessage);
                        chat.messages.push({ role: 'assistant', content: botSettings.awayMessage, timestamp: new Date().toISOString(), sender: 'ai', type: 'text' });
                        saveChats();
                        continue;
                    }

                    if (!isWithinWorkingHours()) {
                        await sendWhatsAppMessage(phone, botSettings.awayMessage);
                        chat.messages.push({ role: 'assistant', content: botSettings.awayMessage, timestamp: new Date().toISOString(), sender: 'ai', type: 'text' });
                        saveChats();
                        continue;
                    }

                    if (wasNew && botSettings.sendWelcomeImage && botSettings.welcomeImageId) {
                        const welcomeMedia = mediaLibrary.find(m => m.id === botSettings.welcomeImageId);
                        if (welcomeMedia && welcomeMedia.whatsappMediaId) {
                            await sendWhatsAppImage(phone, welcomeMedia.whatsappMediaId, botSettings.welcomeMessage);
                            chat.messages.push({ role: 'assistant', content: botSettings.welcomeMessage, timestamp: new Date().toISOString(), sender: 'ai', type: 'image', mediaUrl: welcomeMedia.url });
                            saveChats();
                            continue;
                        }
                    }

                    if (botSettings.autoReplyDelay > 0) {
                        await new Promise(r => setTimeout(r, botSettings.autoReplyDelay * 1000));
                    }

                    if (message.type === 'text') {
                        const aiReply = await getAIReply(phone);
                        const sent = await sendWhatsAppMessage(phone, aiReply);
                        if (sent) {
                            chat.messages.push({ role: 'assistant', content: aiReply, timestamp: new Date().toISOString(), sender: 'ai', type: 'text' });
                            saveChats();
                        }
                    } else {
                        const mediaReply = 'Shukriya! Humne aapka ' +
                            (msgType === 'image' ? 'photo' : msgType === 'audio' ? 'voice message' : msgType === 'video' ? 'video' : 'message') +
                            ' receive kar liya hai. Koi aur madad chahiye toh batayein! 😊';
                        await sendWhatsAppMessage(phone, mediaReply);
                        chat.messages.push({ role: 'assistant', content: mediaReply, timestamp: new Date().toISOString(), sender: 'ai', type: 'text' });
                        saveChats();
                    }
                }
            }
        }
    } catch (err) { console.error('Webhook error:', err.message); }
});

// ============================================
// API ROUTES
// ============================================

// GET all chats
app.get('/api/chats', (req, res) => {
    const chats = [];
    chatStore.forEach((chat, phone) => {
        const lastMsg = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
        let preview = 'No messages yet';
        if (lastMsg) {
            if (lastMsg.type === 'image') preview = '📷 ' + (lastMsg.content || 'Photo');
            else if (lastMsg.type === 'audio') preview = '🎵 Voice message';
            else if (lastMsg.type === 'video') preview = '🎥 Video';
            else if (lastMsg.type === 'document') preview = '📄 Document';
            else preview = lastMsg.content;
        }
        chats.push({
            phone,
            name: chat.name || phone,
            lastMessage: (preview || '').substring(0, 60),
            lastSeen: chat.lastSeen,
            aiPaused: chat.aiPaused || aiPausedSet.has(phone),
            unread: chat.unread || 0,
            messageCount: chat.messages.length
        });
    });
    chats.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    res.json(chats);
});

// GET single chat
app.get('/api/chats/:phone', (req, res) => {
    const chat = chatStore.get(req.params.phone);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    chat.unread = 0;
    saveChats();
    res.json({
        phone: req.params.phone,
        name: chat.name,
        aiPaused: chat.aiPaused || aiPausedSet.has(req.params.phone),
        messages: chat.messages
    });
});

// POST reply
app.post('/api/reply', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' });
    aiPausedSet.add(phone);
    const chat = getOrCreateChat(phone);
    chat.aiPaused = true;
    const sent = await sendWhatsAppMessage(phone, message);
    if (sent) {
        chat.messages.push({ role: 'assistant', content: message, timestamp: new Date().toISOString(), sender: 'admin', type: 'text' });
        chat.lastSeen = new Date().toISOString();
        saveChats(); savePaused();
        return res.json({ success: true });
    }
    res.status(500).json({ error: 'Failed to send' });
});

// POST media reply
app.post('/api/reply-media', upload.single('media'), async (req, res) => {
    const { phone, caption } = req.body;
    const file = req.file;
    if (!phone || !file) return res.status(400).json({ error: 'Phone and media required' });
    aiPausedSet.add(phone);
    const chat = getOrCreateChat(phone);
    chat.aiPaused = true;
    const waMediaId = await uploadMediaToWhatsApp(file.path, file.mimetype);
    if (!waMediaId) return res.status(500).json({ error: 'Upload to WhatsApp failed' });
    let sent = false, msgType = 'document';
    if (file.mimetype.startsWith('image/')) { msgType = 'image'; sent = await sendWhatsAppImage(phone, waMediaId, caption || ''); }
    else if (file.mimetype.startsWith('video/')) { msgType = 'video'; sent = await sendWhatsAppVideo(phone, waMediaId, caption || ''); }
    else if (file.mimetype.startsWith('audio/')) { msgType = 'audio'; sent = await sendWhatsAppAudio(phone, waMediaId); }
    else { msgType = 'document'; sent = await sendWhatsAppDocument(phone, waMediaId, file.originalname, caption || ''); }
    if (sent) {
        chat.messages.push({ role: 'assistant', content: caption || `[${msgType}]`, timestamp: new Date().toISOString(), sender: 'admin', type: msgType, mediaUrl: `/uploads/${file.filename}` });
        chat.lastSeen = new Date().toISOString();
        saveChats(); savePaused();
        return res.json({ success: true, type: msgType });
    }
    res.status(500).json({ error: 'Send failed' });
});

// POST library media
app.post('/api/send-library-media', async (req, res) => {
    const { phone, mediaId, caption } = req.body;
    if (!phone || !mediaId) return res.status(400).json({ error: 'Phone and mediaId required' });
    const media = mediaLibrary.find(m => m.id === mediaId);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    aiPausedSet.add(phone);
    const chat = getOrCreateChat(phone);
    chat.aiPaused = true;
    let waMediaId = media.whatsappMediaId;
    if (!waMediaId) {
        waMediaId = await uploadMediaToWhatsApp(path.join(UPLOADS_DIR, media.filename), media.mimeType);
        if (waMediaId) { media.whatsappMediaId = waMediaId; saveMedia(); }
    }
    if (!waMediaId) return res.status(500).json({ error: 'Upload failed' });
    let sent = false;
    if (media.type === 'image') sent = await sendWhatsAppImage(phone, waMediaId, caption || media.label || '');
    else if (media.type === 'video') sent = await sendWhatsAppVideo(phone, waMediaId, caption || '');
    else if (media.type === 'audio') sent = await sendWhatsAppAudio(phone, waMediaId);
    else sent = await sendWhatsAppDocument(phone, waMediaId, media.filename, caption || '');
    if (sent) {
        chat.messages.push({ role: 'assistant', content: caption || media.label || `[${media.type}]`, timestamp: new Date().toISOString(), sender: 'admin', type: media.type, mediaUrl: media.url });
        chat.lastSeen = new Date().toISOString();
        saveChats(); savePaused();
        return res.json({ success: true });
    }
    res.status(500).json({ error: 'Send failed' });
});

// POST voice
app.post('/api/send-voice', upload.single('voice'), async (req, res) => {
    const { phone } = req.body;
    const file = req.file;
    if (!phone || !file) return res.status(400).json({ error: 'Phone and voice required' });
    aiPausedSet.add(phone);
    const chat = getOrCreateChat(phone);
    chat.aiPaused = true;
    const waMediaId = await uploadMediaToWhatsApp(file.path, 'audio/ogg; codecs=opus');
    if (!waMediaId) return res.status(500).json({ error: 'Voice upload failed' });
    const sent = await sendWhatsAppAudio(phone, waMediaId);
    if (sent) {
        chat.messages.push({ role: 'assistant', content: '🎤 Voice note', timestamp: new Date().toISOString(), sender: 'admin', type: 'audio', mediaUrl: `/uploads/${file.filename}` });
        chat.lastSeen = new Date().toISOString();
        saveChats(); savePaused();
        return res.json({ success: true });
    }
    res.status(500).json({ error: 'Voice send failed' });
});

// Pause / Resume
app.post('/api/pause/:phone', (req, res) => {
    aiPausedSet.add(req.params.phone);
    const chat = chatStore.get(req.params.phone);
    if (chat) chat.aiPaused = true;
    savePaused(); saveChats();
    res.json({ success: true, aiPaused: true });
});

app.post('/api/resume/:phone', (req, res) => {
    aiPausedSet.delete(req.params.phone);
    const chat = chatStore.get(req.params.phone);
    if (chat) chat.aiPaused = false;
    savePaused(); saveChats();
    res.json({ success: true, aiPaused: false });
});

// Prompt
app.get('/api/prompt', (req, res) => res.json({ prompt: systemPrompt }));
app.post('/api/prompt', (req, res) => {
    const { prompt } = req.body;
    if (!prompt || prompt.trim().length < 10) return res.status(400).json({ error: 'Too short' });
    systemPrompt = prompt.trim();
    savePrompt();
    res.json({ success: true });
});

// Settings
app.get('/api/settings', (req, res) => res.json(botSettings));
app.post('/api/settings', (req, res) => {
    const updates = req.body;
    Object.keys(updates).forEach(key => {
        if (botSettings.hasOwnProperty(key)) botSettings[key] = updates[key];
    });
    saveSettings();
    console.log('⚙️ Bot settings saved to disk');
    res.json({ success: true, settings: botSettings });
});

// Media Library
app.get('/api/media', (req, res) => res.json(mediaLibrary));

app.post('/api/media/upload', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file' });
    const { label, category } = req.body;
    let type = 'document';
    if (file.mimetype.startsWith('image/')) type = 'image';
    else if (file.mimetype.startsWith('video/')) type = 'video';
    else if (file.mimetype.startsWith('audio/')) type = 'audio';
    const waMediaId = await uploadMediaToWhatsApp(file.path, file.mimetype);
    const mediaItem = {
        id: 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        filename: file.filename,
        originalName: file.originalname,
        url: `/uploads/${file.filename}`,
        type, mimeType: file.mimetype,
        label: label || file.originalname,
        category: category || 'General',
        uploadedAt: new Date().toISOString(),
        whatsappMediaId: waMediaId,
        size: file.size
    };
    mediaLibrary.push(mediaItem);
    saveMedia();
    console.log(`📁 Media saved: ${mediaItem.label}`);
    res.json({ success: true, media: mediaItem });
});

app.delete('/api/media/:id', (req, res) => {
    const idx = mediaLibrary.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const media = mediaLibrary[idx];
    const filePath = path.join(UPLOADS_DIR, media.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    mediaLibrary.splice(idx, 1);
    saveMedia();
    res.json({ success: true });
});

// Scheduled
app.get('/api/scheduled', (req, res) => res.json(scheduledMessages));
app.post('/api/scheduled', (req, res) => {
    const { mediaId, caption, targetPhones, scheduledTime, type } = req.body;
    if (!scheduledTime) return res.status(400).json({ error: 'Time required' });
    const scheduled = {
        id: 'sched_' + Date.now(),
        mediaId: mediaId || null,
        caption: caption || '',
        targetPhones: targetPhones || 'all',
        scheduledTime, type: type || 'text', sent: false,
        createdAt: new Date().toISOString()
    };
    scheduledMessages.push(scheduled);
    saveScheduled();
    res.json({ success: true, scheduled });
});

app.delete('/api/scheduled/:id', (req, res) => {
    scheduledMessages = scheduledMessages.filter(s => s.id !== req.params.id);
    saveScheduled();
    res.json({ success: true });
});

// Delete chat
app.delete('/api/chats/:phone', (req, res) => {
    chatStore.delete(req.params.phone);
    aiPausedSet.delete(req.params.phone);
    saveChats(); savePaused();
    res.json({ success: true });
});

// Broadcast
app.post('/api/broadcast', async (req, res) => {
    const { message, mediaId } = req.body;
    if (!message && !mediaId) return res.status(400).json({ error: 'Message or media required' });
    const phones = Array.from(chatStore.keys());
    let sentCount = 0;
    for (const phone of phones) {
        if (mediaId) {
            const media = mediaLibrary.find(m => m.id === mediaId);
            if (media && media.whatsappMediaId) {
                if (media.type === 'image') await sendWhatsAppImage(phone, media.whatsappMediaId, message || '');
                else if (media.type === 'video') await sendWhatsAppVideo(phone, media.whatsappMediaId, message || '');
                sentCount++;
            }
        } else {
            if (await sendWhatsAppMessage(phone, message)) sentCount++;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    res.json({ success: true, sentCount, totalPhones: phones.length });
});

// 💾 BACKUP / RESTORE ENDPOINTS
app.get('/api/backup', (req, res) => {
    const backup = {
        chats: Array.from(chatStore.entries()),
        paused: Array.from(aiPausedSet),
        settings: botSettings,
        prompt: systemPrompt,
        media: mediaLibrary,
        scheduled: scheduledMessages,
        timestamp: new Date().toISOString(),
        version: '3.1'
    };
    res.setHeader('Content-Disposition', `attachment; filename="vestrex-backup-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/restore', upload.single('backup'), (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'Backup file required' });
        const content = fs.readFileSync(file.path, 'utf-8');
        const backup = JSON.parse(content);
        if (backup.chats) {
            chatStore.clear();
            backup.chats.forEach(([k, v]) => chatStore.set(k, v));
        }
        if (backup.paused) {
            aiPausedSet.clear();
            backup.paused.forEach(p => aiPausedSet.add(p));
        }
        if (backup.settings) Object.assign(botSettings, backup.settings);
        if (backup.prompt) systemPrompt = backup.prompt;
        if (backup.media) mediaLibrary = backup.media;
        if (backup.scheduled) scheduledMessages = backup.scheduled;
        // Save all
        saveChats(); savePaused(); saveSettings(); savePrompt(); saveMedia(); saveScheduled();
        fs.unlinkSync(file.path);
        res.json({ success: true, message: 'Backup restored successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Scheduler worker
setInterval(async () => {
    const now = new Date();
    let changed = false;
    for (const sched of scheduledMessages) {
        if (sched.sent) continue;
        if (now >= new Date(sched.scheduledTime)) {
            console.log(`⏰ Sending scheduled: ${sched.id}`);
            sched.sent = true;
            changed = true;
            let phones = [];
            if (sched.targetPhones === 'all') phones = Array.from(chatStore.keys());
            else if (Array.isArray(sched.targetPhones)) phones = sched.targetPhones;
            else phones = [sched.targetPhones];
            for (const phone of phones) {
                if (sched.mediaId) {
                    const media = mediaLibrary.find(m => m.id === sched.mediaId);
                    if (media && media.whatsappMediaId) {
                        if (media.type === 'image') await sendWhatsAppImage(phone, media.whatsappMediaId, sched.caption || '');
                        else if (media.type === 'video') await sendWhatsAppVideo(phone, media.whatsappMediaId, sched.caption || '');
                        else if (media.type === 'audio') await sendWhatsAppAudio(phone, media.whatsappMediaId);
                    }
                } else if (sched.caption) {
                    await sendWhatsAppMessage(phone, sched.caption);
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
    if (changed) saveScheduled();
}, 30000);

// Health
app.get('/', (req, res) => {
    res.json({
        status: 'Vestrex Bot v3.1 Running ✅',
        storage: 'Persistent JSON files',
        chats: chatStore.size,
        pausedChats: aiPausedSet.size,
        mediaLibrary: mediaLibrary.length,
        scheduledPending: scheduledMessages.filter(s => !s.sent).length,
        uptime: Math.floor(process.uptime()) + 's',
        dataDir: DATA_DIR
    });
});

// Dashboard
app.get('/admin', (req, res) => res.send(getAdminHTML()));

app.listen(PORT, () => {
    console.log(`🚀 Vestrex Bot v3.1 on port ${PORT}`);
    console.log(`💾 Persistent storage: ${DATA_DIR}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin`);
});

// ============================================
// ADMIN DASHBOARD HTML (Same as v3.0 + Backup button)
// ============================================
function getAdminHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vestrex Admin v3.1</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0f;--panel:#12121a;--card:#1a1a28;--hover:#222235;--input:#1e1e30;--border:#2a2a40;--accent:#6c5ce7;--accent2:#a29bfe;--green:#00b894;--red:#e74c3c;--orange:#f39c12;--blue:#0984e3;--text:#e0e0e0;--dim:#888;--white:#fff}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);height:100vh;overflow:hidden}
.app{display:flex;height:100vh}
.sidebar{width:340px;min-width:340px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column}
.sb-header{padding:16px 20px;border-bottom:1px solid var(--border)}
.brand{font-size:22px;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px}
.brand-sub{font-size:10px;color:var(--dim);margin-top:2px;text-transform:uppercase;letter-spacing:1px}
.storage-badge{display:inline-block;background:var(--green);color:#fff;font-size:9px;padding:2px 7px;border-radius:10px;margin-top:4px;font-weight:600}
.stats{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.stat{background:var(--card);padding:4px 10px;border-radius:16px;font-size:10px;color:var(--dim);border:1px solid var(--border)}
.stat b{color:var(--accent2)}
.search{padding:10px 16px;border-bottom:1px solid var(--border)}
.search input{width:100%;padding:9px 14px;border-radius:8px;border:1px solid var(--border);background:var(--input);color:var(--text);font-size:13px;outline:none}
.search input:focus{border-color:var(--accent)}
.tabs{display:flex;padding:6px 16px;gap:4px;border-bottom:1px solid var(--border)}
.tab{flex:1;padding:7px;text-align:center;font-size:11px;font-weight:600;color:var(--dim);background:none;border:none;border-radius:6px;cursor:pointer}
.tab.active{background:var(--accent);color:#fff}
.tab:hover:not(.active){background:var(--hover);color:var(--text)}
.chatlist{flex:1;overflow-y:auto;padding:6px}
.chatlist::-webkit-scrollbar{width:3px}
.chatlist::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.ci{display:flex;align-items:center;padding:12px 14px;border-radius:10px;cursor:pointer;margin-bottom:2px;position:relative;transition:background .2s}
.ci:hover{background:var(--hover)}
.ci.active{background:var(--accent)}
.ci.active .cn{color:#fff}.ci.active .cp{color:rgba(255,255,255,.7)}.ci.active .ct{color:rgba(255,255,255,.6)}
.cav{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;color:#fff;margin-right:10px;flex-shrink:0}
.cinfo{flex:1;min-width:0}
.cnr{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
.cn{font-weight:600;font-size:13px;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ct{font-size:10px;color:var(--dim);flex-shrink:0;margin-left:6px}
.cpr{display:flex;justify-content:space-between;align-items:center}
.cp{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.ubadge{background:var(--accent);color:#fff;font-size:9px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-left:6px}
.pind{width:7px;height:7px;border-radius:50%;background:var(--orange);position:absolute;top:12px;right:12px;box-shadow:0 0 6px var(--orange)}
.no-chats{text-align:center;padding:50px 20px;color:var(--dim)}
.no-chats .icon{font-size:42px;margin-bottom:10px}
.main{flex:1;display:flex;flex-direction:column;background:var(--bg)}
.welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px}
.welcome .wicon{font-size:70px;margin-bottom:20px}
.welcome h2{font-size:22px;color:var(--white);margin-bottom:8px}
.welcome p{color:var(--dim);font-size:13px;max-width:400px;line-height:1.6}
.toolbar{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;justify-content:center}
.tbtn{padding:10px 20px;border-radius:10px;border:none;font-size:12px;font-weight:600;cursor:pointer;transition:all .3s;color:#fff;display:flex;align-items:center;gap:6px}
.tbtn-purple{background:var(--accent)}.tbtn-green{background:var(--green)}.tbtn-blue{background:var(--blue)}.tbtn-orange{background:var(--orange)}.tbtn-red{background:var(--red)}
.tbtn:hover{transform:scale(1.03);filter:brightness(1.1)}
#chatView{display:none;flex-direction:column;flex:1}
.ch{padding:14px 20px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.chl{display:flex;align-items:center;gap:10px}
.cha{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:14px}
.chn{font-weight:700;font-size:15px;color:var(--white)}
.chp{font-size:11px;color:var(--dim)}
.chr{display:flex;gap:6px;flex-wrap:wrap}
.btn{padding:7px 14px;border-radius:7px;border:none;font-size:11px;font-weight:600;cursor:pointer;color:#fff;transition:all .2s;display:flex;align-items:center;gap:4px}
.btn-p{background:var(--accent)}.btn-g{background:var(--green)}.btn-o{background:var(--orange)}.btn-r{background:var(--red)}.btn-b{background:var(--blue)}
.aist{padding:3px 10px;border-radius:16px;font-size:10px;font-weight:600}
.ai-on{background:rgba(0,184,148,.15);color:var(--green);border:1px solid rgba(0,184,148,.3)}
.ai-off{background:rgba(243,156,18,.15);color:var(--orange);border:1px solid rgba(243,156,18,.3)}
.msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:6px}
.msgs::-webkit-scrollbar{width:4px}.msgs::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
.mb{max-width:65%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.5;word-wrap:break-word}
.mb-u{align-self:flex-start;background:#1e3a5f;color:var(--text);border-bottom-left-radius:3px}
.mb-ai{align-self:flex-end;background:#2d3436;color:var(--text);border-bottom-right-radius:3px}
.mb-admin{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:3px}
.mb img,.mb video,.mb audio{max-width:100%;border-radius:8px;margin-top:6px}
.mb audio{width:100%}
.mm{font-size:9px;color:rgba(255,255,255,.4);margin-top:5px;display:flex;justify-content:space-between;gap:6px}
.mtag{font-size:8px;padding:1px 5px;border-radius:3px;font-weight:600;text-transform:uppercase}
.mtag-u{background:rgba(30,58,95,.5);color:#74b9ff}
.mtag-ai{background:rgba(45,52,54,.5);color:#b2bec3}
.mtag-admin{background:rgba(108,92,231,.3);color:var(--accent2)}
.rbox{padding:12px 20px;background:var(--panel);border-top:1px solid var(--border)}
.rbox-top{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.rbox-main{display:flex;gap:10px;align-items:flex-end}
.rbox textarea{flex:1;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--input);color:var(--text);font-size:13px;resize:none;outline:none;min-height:42px;max-height:120px;font-family:inherit}
.rbox textarea:focus{border-color:var(--accent)}
.sendbtn{padding:10px 22px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap}
.sendbtn:hover{background:var(--accent2)}
.sendbtn:disabled{opacity:.4;cursor:not-allowed}
.attach-btns{display:flex;gap:6px;flex-wrap:wrap}
.abtn{padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:4px}
.abtn:hover{background:var(--hover);border-color:var(--accent)}
.media-preview{padding:8px 12px;background:var(--card);border-radius:8px;margin-bottom:8px;display:none;align-items:center;gap:10px;border:1px solid var(--border)}
.media-preview img{max-height:60px;border-radius:6px}
.media-preview .mp-name{flex:1;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis}
.media-preview .mp-remove{background:var(--red);color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:10px}
.voice-rec{display:none;padding:10px;background:var(--card);border-radius:10px;margin-bottom:8px;border:1px solid var(--border);align-items:center;gap:10px;flex-wrap:wrap}
.voice-rec .vr-dot{width:12px;height:12px;border-radius:50%;background:var(--red);animation:pulse 1s infinite}
.voice-rec .vr-time{font-size:14px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
.voice-rec button{border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:600;font-size:12px}
.vr-stop{background:var(--red);color:#fff}.vr-send{background:var(--green);color:#fff}.vr-cancel{background:var(--card);color:var(--dim);border:1px solid var(--border)!important}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);z-index:1000;justify-content:center;align-items:center}
.modal-overlay.show{display:flex}
.modal{background:var(--panel);border:1px solid var(--border);border-radius:14px;width:92%;max-width:750px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.modal-h{padding:18px 22px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.modal-h h3{font-size:17px;color:var(--white)}
.modal-x{background:none;border:none;color:var(--dim);font-size:22px;cursor:pointer;padding:4px 8px;border-radius:6px}
.modal-x:hover{background:var(--hover);color:var(--text)}
.modal-b{padding:22px;flex:1;overflow-y:auto}
.modal-b::-webkit-scrollbar{width:4px}.modal-b::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
.modal-f{padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.modal textarea,.modal input[type=text],.modal input[type=number],.modal input[type=time],.modal input[type=datetime-local],.modal select{width:100%;padding:10px 14px;background:var(--input);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:inherit}
.modal textarea:focus,.modal input:focus,.modal select:focus{border-color:var(--accent)}
.modal textarea{min-height:200px;resize:vertical;font-family:'Consolas',monospace;line-height:1.6}
.modal label{display:block;font-size:12px;font-weight:600;color:var(--dim);margin-bottom:6px;margin-top:14px;text-transform:uppercase;letter-spacing:.5px}
.modal label:first-child{margin-top:0}
.btn-cancel{padding:9px 18px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:8px;font-weight:600;cursor:pointer}
.btn-save{padding:9px 22px;background:var(--green);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer}
.btn-save:hover{filter:brightness(1.1)}
.toggle{display:flex;align-items:center;gap:10px;margin:8px 0}
.toggle input{display:none}
.toggle .slider{width:44px;height:24px;background:var(--border);border-radius:12px;position:relative;cursor:pointer;transition:.3s}
.toggle input:checked+.slider{background:var(--green)}
.toggle .slider:before{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:.3s}
.toggle input:checked+.slider:before{transform:translateX(20px)}
.toggle span{font-size:13px;color:var(--text)}
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-top:14px}
.mcard{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .2s;position:relative}
.mcard:hover{border-color:var(--accent);transform:translateY(-2px)}
.mcard.selected{border-color:var(--green);box-shadow:0 0 10px var(--green)}
.mcard-img{width:100%;height:100px;object-fit:cover;background:var(--hover);display:flex;align-items:center;justify-content:center;font-size:32px}
.mcard-img img{width:100%;height:100%;object-fit:cover}
.mcard-info{padding:8px 10px}
.mcard-label{font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcard-cat{font-size:9px;color:var(--dim);margin-top:2px}
.mcard-del{position:absolute;top:6px;right:6px;background:var(--red);color:#fff;border:none;border-radius:4px;padding:2px 6px;font-size:9px;cursor:pointer;opacity:0;transition:opacity .2s}
.mcard:hover .mcard-del{opacity:1}
.sched-item{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.sched-info{flex:1;min-width:150px}
.sched-time{font-size:13px;font-weight:600;color:var(--accent2)}
.sched-target{font-size:11px;color:var(--dim);margin-top:3px}
.sched-caption{font-size:12px;color:var(--text);margin-top:3px}
.sched-sent{color:var(--green);font-size:11px;font-weight:600}
.sched-pending{color:var(--orange);font-size:11px;font-weight:600}
.toast{position:fixed;bottom:30px;right:30px;padding:12px 22px;border-radius:10px;font-size:12px;font-weight:600;color:#fff;z-index:2000;animation:slideIn .3s ease,fadeOut .3s ease 2.7s;box-shadow:0 10px 30px rgba(0,0,0,.3)}
.toast-s{background:var(--green)}.toast-e{background:var(--red)}.toast-i{background:var(--accent)}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes fadeOut{from{opacity:1}to{opacity:0}}
@media(max-width:768px){
.sidebar{width:100%;min-width:100%}
.main{display:none}
.app.chat-open .sidebar{display:none}
.app.chat-open .main{display:flex}
.mb{max-width:88%}
.mobile-back{display:inline-flex!important}
.modal{width:95%}
}
@media(min-width:769px){.mobile-back{display:none!important}}
</style>
</head>
<body>

<div class="app" id="app">
<div class="sidebar">
<div class="sb-header">
<div class="brand">VESTREX</div>
<div class="brand-sub">Admin Dashboard v3.1</div>
<span class="storage-badge">💾 PERSISTENT STORAGE</span>
<div class="stats">
<div class="stat">Chats: <b id="totalChats">0</b></div>
<div class="stat">Paused: <b id="pausedCount">0</b></div>
<div class="stat">Media: <b id="mediaCount">0</b></div>
</div>
</div>
<div class="search"><input type="text" id="searchInput" placeholder="🔍 Search..." oninput="filterChats()"></div>
<div class="tabs">
<button class="tab active" onclick="switchTab('all',this)">All</button>
<button class="tab" onclick="switchTab('paused',this)">⏸ Paused</button>
<button class="tab" onclick="switchTab('active',this)">🤖 Active</button>
</div>
<div class="chatlist" id="chatList">
<div class="no-chats"><div class="icon">💬</div><p>Waiting for customers...</p></div>
</div>
</div>

<div class="main" id="mainPanel">
<div class="welcome" id="welcomeScreen">
<div class="wicon">👕</div>
<h2>Vestrex Admin Panel v3.1</h2>
<p>Full control with permanent storage. All chats, media, and settings persist across redeploys.</p>
<div class="toolbar">
<button class="tbtn tbtn-purple" onclick="openPromptEditor()">✏️ Prompt</button>
<button class="tbtn tbtn-green" onclick="openSettings()">⚙️ Settings</button>
<button class="tbtn tbtn-blue" onclick="openMediaLib()">📁 Media</button>
<button class="tbtn tbtn-orange" onclick="openScheduler()">⏰ Schedule</button>
<button class="tbtn tbtn-red" onclick="openBackup()">💾 Backup</button>
</div>
</div>

<div id="chatView">
<div class="ch">
<div class="chl">
<button class="mobile-back btn" style="background:var(--card);border:1px solid var(--border);color:var(--text)" onclick="goBack()">←</button>
<div class="cha" id="chatAvatar">V</div>
<div><div class="chn" id="chatName">Customer</div><div class="chp" id="chatPhone">+92...</div></div>
<div class="aist" id="aiStatus">🤖 AI Active</div>
</div>
<div class="chr">
<button class="btn btn-b" onclick="openMediaLib('pick')">📁</button>
<button class="btn" id="toggleAiBtn" onclick="toggleAI()">⏸</button>
<button class="btn btn-r" onclick="deleteChat()">🗑️</button>
</div>
</div>
<div class="msgs" id="msgsArea"></div>
<div class="rbox">
<div class="media-preview" id="mediaPreview">
<img id="mpThumb" src="" alt="">
<div class="mp-name" id="mpName">file</div>
<button class="mp-remove" onclick="clearMediaPreview()">✕</button>
</div>
<div class="voice-rec" id="voiceRec">
<div class="vr-dot"></div>
<div class="vr-time" id="vrTime">00:00</div>
<button class="vr-stop" onclick="stopRecording()">⏹ Stop</button>
<button class="vr-send" onclick="sendVoice()" style="display:none" id="vrSend">➤ Send</button>
<button class="vr-cancel" onclick="cancelRecording()">✕</button>
</div>
<div class="rbox-top">
<div class="attach-btns">
<button class="abtn" onclick="pickMedia('image')">📷 Photo</button>
<button class="abtn" onclick="pickMedia('video')">🎥 Video</button>
<button class="abtn" onclick="pickMedia('audio')">📎 File</button>
<button class="abtn" onclick="startRecording()">🎤 Voice</button>
<button class="abtn" onclick="openMediaLib('pick')">📁 Library</button>
</div>
</div>
<div class="rbox-main">
<textarea id="replyInput" placeholder="Type reply..." rows="1" onkeydown="handleKey(event)"></textarea>
<button class="sendbtn" id="sendBtn" onclick="sendReply()">➤</button>
</div>
</div>
</div>
</div>
</div>

<!-- MODALS -->
<div class="modal-overlay" id="promptModal">
<div class="modal">
<div class="modal-h"><h3>✏️ System Prompt</h3><button class="modal-x" onclick="closeModal('promptModal')">✕</button></div>
<div class="modal-b"><textarea id="promptText"></textarea></div>
<div class="modal-f"><button class="btn-cancel" onclick="closeModal('promptModal')">Cancel</button><button class="btn-save" onclick="savePrompt()">💾 Save</button></div>
</div>
</div>

<div class="modal-overlay" id="settingsModal">
<div class="modal" style="max-width:600px">
<div class="modal-h"><h3>⚙️ Bot Settings</h3><button class="modal-x" onclick="closeModal('settingsModal')">✕</button></div>
<div class="modal-b" id="settingsBody"></div>
<div class="modal-f"><button class="btn-cancel" onclick="closeModal('settingsModal')">Cancel</button><button class="btn-save" onclick="saveSettings()">💾 Save</button></div>
</div>
</div>

<div class="modal-overlay" id="mediaModal">
<div class="modal" style="max-width:850px">
<div class="modal-h"><h3>📁 Media Library</h3><button class="modal-x" onclick="closeModal('mediaModal')">✕</button></div>
<div class="modal-b">
<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
<label class="abtn" style="margin:0;cursor:pointer">📤 Upload
<input type="file" id="mediaUploadInput" style="display:none" accept="image/*,video/*,audio/*,.pdf,.docx" onchange="uploadMedia(this)">
</label>
<input type="text" id="mediaLabel" placeholder="Label (e.g. Black T-Shirt)" style="flex:1;min-width:120px">
<select id="mediaCategory" style="width:140px">
<option value="Products">Products</option><option value="Catalog">Catalog</option>
<option value="Promotions">Promotions</option><option value="Size Charts">Size Charts</option>
<option value="General">General</option>
</select>
</div>
<div id="uploadProgress" style="display:none;margin-top:10px;color:var(--accent);font-size:12px">⏳ Uploading...</div>
<div class="mgrid" id="mediaGrid"></div>
<div id="noMedia" style="text-align:center;padding:40px;color:var(--dim);font-size:13px">📭 No media yet</div>
</div>
<div class="modal-f"><button class="btn-cancel" onclick="closeModal('mediaModal')">Close</button><button class="btn-save" id="pickMediaBtn" style="display:none" onclick="sendPickedMedia()">📤 Send</button></div>
</div>
</div>

<div class="modal-overlay" id="schedModal">
<div class="modal" style="max-width:650px">
<div class="modal-h"><h3>⏰ Scheduled Messages</h3><button class="modal-x" onclick="closeModal('schedModal')">✕</button></div>
<div class="modal-b">
<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
<label>Schedule Time</label><input type="datetime-local" id="schedTime">
<label>Message/Caption</label><input type="text" id="schedCaption" placeholder="20% OFF today!">
<label>Send To</label><select id="schedTarget"></select>
<label>Attach Media</label><select id="schedMedia"><option value="">No Media</option></select>
<div style="margin-top:12px"><button class="btn-save" onclick="addSchedule()">+ Add</button></div>
</div>
<div id="schedList"></div>
</div>
<div class="modal-f"><button class="btn-cancel" onclick="closeModal('schedModal')">Close</button></div>
</div>
</div>

<div class="modal-overlay" id="backupModal">
<div class="modal" style="max-width:500px">
<div class="modal-h"><h3>💾 Backup & Restore</h3><button class="modal-x" onclick="closeModal('backupModal')">✕</button></div>
<div class="modal-b">
<p style="color:var(--dim);font-size:13px;margin-bottom:16px">Download complete backup (chats, settings, media info) or restore from a backup file. Yeh extra safety hai agar kuch galat ho jaye.</p>
<button class="tbtn tbtn-green" onclick="downloadBackup()" style="width:100%;margin-bottom:12px">📥 Download Backup Now</button>
<label>Restore from Backup File</label>
<input type="file" id="restoreFile" accept=".json" style="margin-top:6px">
<button class="tbtn tbtn-orange" onclick="restoreBackup()" style="width:100%;margin-top:10px">📤 Restore</button>
<p style="color:var(--orange);font-size:11px;margin-top:16px">⚠️ Restore will REPLACE all current data. Download backup first!</p>
</div>
<div class="modal-f"><button class="btn-cancel" onclick="closeModal('backupModal')">Close</button></div>
</div>
</div>

<input type="file" id="hiddenFileInput" style="display:none">

<script>
let allChats=[],currentPhone=null,currentTab='all',mediaLib=[],pickMode=false,selectedMediaId=null;
let mediaRecorder=null,audioChunks=[],recordingTimer=null,recordSeconds=0,recordedBlob=null;
let pendingFile=null,chatPoll=null;

document.addEventListener('DOMContentLoaded',()=>{loadChats();setInterval(loadChats,3000)});

async function loadChats(){
try{const r=await fetch('/api/chats');allChats=await r.json();renderChatList();
document.getElementById('totalChats').textContent=allChats.length;
document.getElementById('pausedCount').textContent=allChats.filter(c=>c.aiPaused).length;
}catch(e){console.error(e)}
}

function renderChatList(){
const c=document.getElementById('chatList'),s=document.getElementById('searchInput').value.toLowerCase();
let f=allChats;
if(currentTab==='paused')f=f.filter(c=>c.aiPaused);
else if(currentTab==='active')f=f.filter(c=>!c.aiPaused);
if(s)f=f.filter(c=>c.name.toLowerCase().includes(s)||c.phone.includes(s));
if(!f.length){c.innerHTML='<div class="no-chats"><div class="icon">📭</div><p>No chats</p></div>';return}
c.innerHTML=f.map(ch=>{
const ini=getIni(ch.name),t=fmtTime(ch.lastSeen),act=ch.phone===currentPhone;
return '<div class="ci'+(act?' active':'')+'" onclick="openChat(\\''+ch.phone+'\\')">'
+(ch.aiPaused?'<div class="pind"></div>':'')
+'<div class="cav">'+ini+'</div><div class="cinfo"><div class="cnr"><div class="cn">'+esc(ch.name)+'</div><div class="ct">'+t+'</div></div>'
+'<div class="cpr"><div class="cp">'+esc(ch.lastMessage)+'</div>'
+(ch.unread>0&&!act?'<div class="ubadge">'+ch.unread+'</div>':'')+'</div></div></div>'
}).join('');
}

async function openChat(phone){
currentPhone=phone;
document.getElementById('app').classList.add('chat-open');
document.getElementById('welcomeScreen').style.display='none';
document.getElementById('chatView').style.display='flex';
await loadMsgs(phone);
if(chatPoll)clearInterval(chatPoll);
chatPoll=setInterval(()=>loadMsgs(phone,true),2500);
renderChatList();
}

async function loadMsgs(phone,silent=false){
if(phone!==currentPhone)return;
try{const r=await fetch('/api/chats/'+phone);if(!r.ok)return;const d=await r.json();
document.getElementById('chatName').textContent=d.name||phone;
document.getElementById('chatPhone').textContent='+'+phone;
document.getElementById('chatAvatar').textContent=getIni(d.name||phone);
const badge=document.getElementById('aiStatus'),btn=document.getElementById('toggleAiBtn');
if(d.aiPaused){badge.className='aist ai-off';badge.innerHTML='⏸ Paused';btn.className='btn btn-g';btn.innerHTML='▶️ Resume'}
else{badge.className='aist ai-on';badge.innerHTML='🤖 Active';btn.className='btn btn-o';btn.innerHTML='⏸ Pause'}
const area=document.getElementById('msgsArea');
const atBottom=area.scrollTop+area.clientHeight>=area.scrollHeight-50;
area.innerHTML=d.messages.map(m=>{
let bc,tc,tt;
if(m.role==='user'){bc='mb-u';tc='mtag-u';tt='👤 Customer'}
else if(m.sender==='admin'){bc='mb-admin';tc='mtag-admin';tt='👨‍💼 Admin'}
else{bc='mb-ai';tc='mtag-ai';tt='🤖 AI'}
let mh='';
if(m.mediaUrl){
if(m.type==='image')mh='<img src="'+m.mediaUrl+'" onclick="window.open(this.src)">';
else if(m.type==='video')mh='<video src="'+m.mediaUrl+'" controls></video>';
else if(m.type==='audio')mh='<audio src="'+m.mediaUrl+'" controls></audio>';
else if(m.type==='document')mh='<a href="'+m.mediaUrl+'" target="_blank" style="color:var(--accent2)">📄 Open</a>';
}
return '<div class="mb '+bc+'">'+esc(m.content)+mh+'<div class="mm"><span class="mtag '+tc+'">'+tt+'</span><span>'+(m.timestamp?fmtTime(m.timestamp):'')+'</span></div></div>'
}).join('');
if(atBottom||!silent)area.scrollTop=area.scrollHeight;
if(!silent)loadChats();
}catch(e){console.error(e)}
}

async function sendReply(){
const inp=document.getElementById('replyInput'),msg=inp.value.trim();
if(!currentPhone)return;
if(pendingFile){await sendMediaFile(msg);return}
if(selectedMediaId){await sendLibMedia(msg);return}
if(!msg)return;
const btn=document.getElementById('sendBtn');btn.disabled=true;btn.textContent='...';
try{const r=await fetch('/api/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:currentPhone,message:msg})});
const d=await r.json();if(d.success){inp.value='';inp.style.height='auto';toast('Sent!','s');loadMsgs(currentPhone);loadChats()}
else toast('Failed','e');
}catch(e){toast('Error','e')}
btn.disabled=false;btn.textContent='➤';
}

async function sendMediaFile(caption){
if(!pendingFile||!currentPhone)return;
const btn=document.getElementById('sendBtn');btn.disabled=true;btn.textContent='...';
const fd=new FormData();fd.append('phone',currentPhone);fd.append('media',pendingFile);fd.append('caption',caption||'');
try{const r=await fetch('/api/reply-media',{method:'POST',body:fd});
const d=await r.json();if(d.success){document.getElementById('replyInput').value='';clearMediaPreview();toast('Sent!','s');loadMsgs(currentPhone);loadChats()}
else toast('Failed','e');
}catch(e){toast('Error','e')}
btn.disabled=false;btn.textContent='➤';
}

async function sendLibMedia(caption){
if(!selectedMediaId||!currentPhone)return;
const btn=document.getElementById('sendBtn');btn.disabled=true;btn.textContent='...';
try{const r=await fetch('/api/send-library-media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:currentPhone,mediaId:selectedMediaId,caption:caption||''})});
const d=await r.json();if(d.success){document.getElementById('replyInput').value='';selectedMediaId=null;clearMediaPreview();toast('Sent!','s');loadMsgs(currentPhone);loadChats();closeModal('mediaModal')}
else toast('Failed','e');
}catch(e){toast('Error','e')}
btn.disabled=false;btn.textContent='➤';
}

function sendPickedMedia(){sendLibMedia(document.getElementById('replyInput').value.trim())}

function pickMedia(type){
const inp=document.getElementById('hiddenFileInput');
if(type==='image')inp.accept='image/*';
else if(type==='video')inp.accept='video/*';
else inp.accept='image/*,video/*,audio/*,.pdf,.docx';
inp.onchange=function(){if(this.files[0]){pendingFile=this.files[0];showMediaPreview(pendingFile)}};
inp.click();
}

function showMediaPreview(file){
const prev=document.getElementById('mediaPreview'),thumb=document.getElementById('mpThumb'),name=document.getElementById('mpName');
prev.style.display='flex';name.textContent=file.name+' ('+formatSize(file.size)+')';
if(file.type.startsWith('image/')){thumb.src=URL.createObjectURL(file);thumb.style.display='block'}
else{thumb.style.display='none'}
}

function clearMediaPreview(){
pendingFile=null;selectedMediaId=null;
document.getElementById('mediaPreview').style.display='none';
document.getElementById('hiddenFileInput').value='';
}

async function startRecording(){
try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});
mediaRecorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'});
audioChunks=[];recordSeconds=0;recordedBlob=null;
mediaRecorder.ondataavailable=e=>{if(e.data.size>0)audioChunks.push(e.data)};
mediaRecorder.onstop=()=>{recordedBlob=new Blob(audioChunks,{type:'audio/ogg; codecs=opus'});stream.getTracks().forEach(t=>t.stop());document.getElementById('vrSend').style.display='inline-block';clearInterval(recordingTimer)};
mediaRecorder.start();
document.getElementById('voiceRec').style.display='flex';
recordingTimer=setInterval(()=>{recordSeconds++;const m=String(Math.floor(recordSeconds/60)).padStart(2,'0'),s=String(recordSeconds%60).padStart(2,'0');document.getElementById('vrTime').textContent=m+':'+s},1000);
}catch(e){toast('Mic denied','e')}
}

function stopRecording(){if(mediaRecorder&&mediaRecorder.state==='recording')mediaRecorder.stop()}

function cancelRecording(){
if(mediaRecorder&&mediaRecorder.state==='recording')mediaRecorder.stop();
recordedBlob=null;audioChunks=[];
document.getElementById('voiceRec').style.display='none';
document.getElementById('vrSend').style.display='none';
clearInterval(recordingTimer);
}

async function sendVoice(){
if(!recordedBlob||!currentPhone)return;
document.getElementById('vrSend').textContent='...';
const fd=new FormData();fd.append('phone',currentPhone);fd.append('voice',recordedBlob,'voice.ogg');
try{const r=await fetch('/api/send-voice',{method:'POST',body:fd});
const d=await r.json();if(d.success){toast('Voice sent!','s');loadMsgs(currentPhone);loadChats()}
else toast('Failed','e');
}catch(e){toast('Error','e')}
cancelRecording();
}

async function toggleAI(){
if(!currentPhone)return;
const ch=allChats.find(c=>c.phone===currentPhone);
const ep=ch&&ch.aiPaused?'resume':'pause';
try{await fetch('/api/'+ep+'/'+currentPhone,{method:'POST'});
toast(ep==='resume'?'AI resumed':'AI paused','i');loadChats();loadMsgs(currentPhone,true)}
catch(e){toast('Error','e')}
}

async function deleteChat(){
if(!currentPhone||!confirm('Delete this chat?'))return;
await fetch('/api/chats/'+currentPhone,{method:'DELETE'});
toast('Deleted','i');currentPhone=null;
document.getElementById('chatView').style.display='none';
document.getElementById('welcomeScreen').style.display='flex';
document.getElementById('app').classList.remove('chat-open');
if(chatPoll)clearInterval(chatPoll);loadChats();
}

async function openPromptEditor(){
try{const r=await fetch('/api/prompt');const d=await r.json();document.getElementById('promptText').value=d.prompt}
catch(e){document.getElementById('promptText').value='Error'}
openModal('promptModal');
}

async function savePrompt(){
const p=document.getElementById('promptText').value.trim();
if(p.length<10){toast('Too short','e');return}
try{const r=await fetch('/api/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:p})});
const d=await r.json();if(d.success){toast('Saved!','s');closeModal('promptModal')}
}catch(e){toast('Error','e')}
}

async function openSettings(){
try{const r=await fetch('/api/settings');const s=await r.json();
document.getElementById('settingsBody').innerHTML=
'<label>Bot Name</label><input type="text" id="sBotName" value="'+esc(s.botName)+'">'
+'<label>Welcome Message</label><input type="text" id="sWelcome" value="'+esc(s.welcomeMessage)+'">'
+'<label>Away Message</label><input type="text" id="sAway" value="'+esc(s.awayMessage)+'">'
+'<div class="toggle"><label style="margin:0">Away Mode</label><input type="checkbox" id="sIsAway"'+(s.isAway?' checked':'')+'><span class="slider"></span></div>'
+'<label>AI Model</label><select id="sModel"><option value="gpt-4o-mini"'+(s.aiModel==='gpt-4o-mini'?' selected':'')+'>gpt-4o-mini</option><option value="gpt-4o"'+(s.aiModel==='gpt-4o'?' selected':'')+'>gpt-4o</option><option value="gpt-3.5-turbo"'+(s.aiModel==='gpt-3.5-turbo'?' selected':'')+'>gpt-3.5-turbo</option></select>'
+'<label>AI Temperature (0.1-1.0)</label><input type="number" id="sTemp" value="'+s.aiTemperature+'" step="0.1" min="0.1" max="1">'
+'<label>Max Response Tokens</label><input type="number" id="sMaxTok" value="'+s.maxAIResponseLength+'" min="50" max="1000">'
+'<label>Auto Reply Delay (seconds)</label><input type="number" id="sDelay" value="'+s.autoReplyDelay+'" min="0" max="30">'
+'<div class="toggle"><label style="margin:0">Working Hours Only</label><input type="checkbox" id="sWorkHrs"'+(s.workingHoursEnabled?' checked':'')+'><span class="slider"></span></div>'
+'<div style="display:flex;gap:10px"><div style="flex:1"><label>Start</label><input type="time" id="sWorkStart" value="'+s.workingHoursStart+'"></div><div style="flex:1"><label>End</label><input type="time" id="sWorkEnd" value="'+s.workingHoursEnd+'"></div></div>'
+'<div class="toggle"><label style="margin:0">Welcome Image to New Customers</label><input type="checkbox" id="sWelImg"'+(s.sendWelcomeImage?' checked':'')+'><span class="slider"></span></div>';
}catch(e){toast('Error','e')}
openModal('settingsModal');
}

async function saveSettings(){
const settings={
botName:document.getElementById('sBotName').value,
welcomeMessage:document.getElementById('sWelcome').value,
awayMessage:document.getElementById('sAway').value,
isAway:document.getElementById('sIsAway').checked,
aiModel:document.getElementById('sModel').value,
aiTemperature:parseFloat(document.getElementById('sTemp').value),
maxAIResponseLength:parseInt(document.getElementById('sMaxTok').value),
autoReplyDelay:parseInt(document.getElementById('sDelay').value),
workingHoursEnabled:document.getElementById('sWorkHrs').checked,
workingHoursStart:document.getElementById('sWorkStart').value,
workingHoursEnd:document.getElementById('sWorkEnd').value,
sendWelcomeImage:document.getElementById('sWelImg').checked
};
try{const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
const d=await r.json();if(d.success){toast('Saved to disk!','s');closeModal('settingsModal')}
}catch(e){toast('Error','e')}
}

async function openMediaLib(mode){
pickMode=mode==='pick';
try{const r=await fetch('/api/media');mediaLib=await r.json();
document.getElementById('mediaCount').textContent=mediaLib.length;renderMediaGrid();
}catch(e){}
document.getElementById('pickMediaBtn').style.display=pickMode?'inline-block':'none';
openModal('mediaModal');
}

function renderMediaGrid(){
const grid=document.getElementById('mediaGrid'),noMedia=document.getElementById('noMedia');
if(!mediaLib.length){grid.innerHTML='';noMedia.style.display='block';return}
noMedia.style.display='none';
grid.innerHTML=mediaLib.map(m=>{
let thumb='';
if(m.type==='image')thumb='<div class="mcard-img"><img src="'+m.url+'"></div>';
else if(m.type==='video')thumb='<div class="mcard-img">🎥</div>';
else if(m.type==='audio')thumb='<div class="mcard-img">🎵</div>';
else thumb='<div class="mcard-img">📄</div>';
return '<div class="mcard'+(selectedMediaId===m.id?' selected':'')+'" onclick="'+(pickMode?'selectMedia(\\''+m.id+'\\')':'')+'">'+thumb
+'<button class="mcard-del" onclick="event.stopPropagation();deleteMedia(\\''+m.id+'\\')">🗑️</button>'
+'<div class="mcard-info"><div class="mcard-label">'+esc(m.label)+'</div><div class="mcard-cat">'+esc(m.category)+' • '+formatSize(m.size)+'</div></div></div>'
}).join('');
}

function selectMedia(id){
selectedMediaId=selectedMediaId===id?null:id;renderMediaGrid();
const media=mediaLib.find(m=>m.id===id);
if(media&&selectedMediaId){
const prev=document.getElementById('mediaPreview'),thumb=document.getElementById('mpThumb'),name=document.getElementById('mpName');
prev.style.display='flex';name.textContent='📁 '+media.label;
if(media.type==='image'){thumb.src=media.url;thumb.style.display='block'}else{thumb.style.display='none'}
pendingFile=null;
}
}

async function uploadMedia(input){
const file=input.files[0];if(!file)return;
const label=document.getElementById('mediaLabel').value||file.name;
const category=document.getElementById('mediaCategory').value;
document.getElementById('uploadProgress').style.display='block';
const fd=new FormData();fd.append('file',file);fd.append('label',label);fd.append('category',category);
try{const r=await fetch('/api/media/upload',{method:'POST',body:fd});
const d=await r.json();if(d.success){toast('Uploaded!','s');mediaLib.push(d.media);renderMediaGrid();document.getElementById('mediaLabel').value=''}
else toast('Failed','e');
}catch(e){toast('Error','e')}
document.getElementById('uploadProgress').style.display='none';input.value='';
}

async function deleteMedia(id){
if(!confirm('Delete?'))return;
await fetch('/api/media/'+id,{method:'DELETE'});
mediaLib=mediaLib.filter(m=>m.id!==id);renderMediaGrid();toast('Deleted','i');
}

async function openScheduler(){
try{const r=await fetch('/api/scheduled');const scheds=await r.json();
const mr=await fetch('/api/media');mediaLib=await mr.json();
const sel=document.getElementById('schedMedia');
sel.innerHTML='<option value="">No Media</option>'+mediaLib.map(m=>'<option value="'+m.id+'">'+esc(m.label)+' ('+m.type+')</option>').join('');
const tgt=document.getElementById('schedTarget');
tgt.innerHTML='<option value="all">All Customers ('+allChats.length+')</option>'+allChats.map(c=>'<option value="'+c.phone+'">'+esc(c.name)+'</option>').join('');
const list=document.getElementById('schedList');
if(!scheds.length){list.innerHTML='<p style="text-align:center;color:var(--dim);padding:20px">No scheduled messages</p>'}
else{list.innerHTML=scheds.map(s=>'<div class="sched-item"><div class="sched-info"><div class="sched-time">📅 '+new Date(s.scheduledTime).toLocaleString()+'</div>'
+'<div class="sched-target">To: '+(s.targetPhones==='all'?'All':s.targetPhones)+'</div>'
+'<div class="sched-caption">'+(s.caption?esc(s.caption):'[No caption]')+'</div></div>'
+'<div>'+(s.sent?'<span class="sched-sent">✅ Sent</span>':'<span class="sched-pending">⏳ Pending</span>')
+(!s.sent?' <button class="btn btn-r" style="padding:4px 8px;font-size:10px" onclick="deleteSched(\\''+s.id+'\\')">🗑️</button>':'')
+'</div></div>').join('')}
}catch(e){toast('Error','e')}
openModal('schedModal');
}

async function addSchedule(){
const time=document.getElementById('schedTime').value;
const caption=document.getElementById('schedCaption').value;
const target=document.getElementById('schedTarget').value;
const mediaId=document.getElementById('schedMedia').value;
if(!time){toast('Select time','e');return}
try{const r=await fetch('/api/scheduled',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scheduledTime:new Date(time).toISOString(),caption,targetPhones:target,mediaId:mediaId||null,type:mediaId?'media':'text'})});
const d=await r.json();if(d.success){toast('Scheduled!','s');openScheduler()}
}catch(e){toast('Error','e')}
}

async function deleteSched(id){
await fetch('/api/scheduled/'+id,{method:'DELETE'});toast('Removed','i');openScheduler();
}

function openBackup(){openModal('backupModal')}

function downloadBackup(){
window.location.href='/api/backup';
toast('Backup downloading...','s');
}

async function restoreBackup(){
const file=document.getElementById('restoreFile').files[0];
if(!file){toast('Select backup file','e');return}
if(!confirm('This will REPLACE all current data. Continue?'))return;
const fd=new FormData();fd.append('backup',file);
try{const r=await fetch('/api/restore',{method:'POST',body:fd});
const d=await r.json();if(d.success){toast('Restored! Reloading...','s');setTimeout(()=>location.reload(),1500)}
else toast('Failed: '+d.error,'e');
}catch(e){toast('Error','e')}
}

function switchTab(t,el){currentTab=t;document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');renderChatList()}
function filterChats(){renderChatList()}
function goBack(){document.getElementById('app').classList.remove('chat-open');currentPhone=null;if(chatPoll)clearInterval(chatPoll)}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendReply()}setTimeout(()=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'},0)}
function openModal(id){document.getElementById(id).classList.add('show')}
function closeModal(id){document.getElementById(id).classList.remove('show')}
function getIni(n){if(!n)return'?';const p=n.trim().split(' ');return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():n.substring(0,2).toUpperCase()}
function fmtTime(iso){if(!iso)return'';const d=new Date(iso),now=new Date(),diff=now-d;
if(diff<60000)return'Now';if(diff<3600000)return Math.floor(diff/60000)+'m';
if(diff<86400000)return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
if(diff<172800000)return'Yesterday';return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function formatSize(b){if(!b)return'';if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB'}
function toast(m,t='i'){const el=document.createElement('div');el.className='toast toast-'+t;el.textContent=m;document.body.appendChild(el);setTimeout(()=>el.remove(),3000)}
</script>
</body>
</html>`;
}
