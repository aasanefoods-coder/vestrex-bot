// Vestrex Bot v4.0 — Premium Dashboard + Chat Fix + Persistent Storage
const express = require('express');
const { OpenAI } = require('openai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ========== STORAGE ==========
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
[DATA_DIR, UPLOADS_DIR].forEach(d => { try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch(e){} });

const F = {
  chats: path.join(DATA_DIR, 'chats.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  prompt: path.join(DATA_DIR, 'prompt.json'),
  paused: path.join(DATA_DIR, 'paused.json')
};

function load(file, def) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { console.error('load', file, e.message); }
  return def;
}
function save(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; } catch(e) { console.error('save', file, e.message); return false; }
}

const chatStore = new Map(load(F.chats, []));
const aiPaused = new Set(load(F.paused, []));
console.log('💾 Loaded chats:', chatStore.size);

let settings = load(F.settings, {
  botName: 'Vestrex Bot',
  welcomeMessage: 'Assalam o Alaikum! 👕 Vestrex Clothing mein khush aamdeed! Kaise madad kar sakta hoon?',
  awayMessage: 'Shukriya! Team jaldi reply karegi. 🙏',
  isAway: false,
  aiModel: 'gpt-4o-mini',
  aiTemperature: 0.7,
  maxTokens: 300
});

let systemPrompt = load(F.prompt, {
  prompt: `Tu Vestrex Clothing ka official WhatsApp sales assistant hai. Naam: Vestrex Bot.
Roman Urdu + English mix, friendly shopkeeper style.

BRAND: Vestrex
Products: T-Shirts, Polo, Dress Shirts
Sizes: S M L XL
Delivery: Karachi 150 | Other cities 250 | COD
Prices: Basic Tee 899 | Premium 1299 | Polo 1499 | Dress Shirt 1799

Rules:
- Short 2-3 line replies
- Order pe lo: Name, City, Full Address, Phone, Product, Size
- Upsell politely
- No competitor names`
}).prompt;

function saveChats() { save(F.chats, Array.from(chatStore.entries())); }
function savePaused() { save(F.paused, Array.from(aiPaused)); }
function saveSettings() { save(F.settings, settings); }
function savePrompt() { save(F.prompt, { prompt: systemPrompt }); }

setInterval(() => { saveChats(); savePaused(); }, 10000);
process.on('SIGTERM', () => { saveChats(); savePaused(); saveSettings(); savePrompt(); process.exit(0); });

// ========== UPLOADS ==========
app.use('/uploads', express.static(UPLOADS_DIR));
const upload = multer({
  storage: multer.diskStorage({
    destination: (r,f,cb) => cb(null, UPLOADS_DIR),
    filename: (r,f,cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(f.originalname))
  }),
  limits: { fileSize: 16*1024*1024 }
});

// ========== ENV ==========
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1411969538659249';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'vestrex123secret';
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ========== WA HELPERS ==========
async function waUpload(filePath, mime) {
  try {
    const fd = new FormData();
    fd.append('file', fs.createReadStream(filePath));
    fd.append('type', mime);
    fd.append('messaging_product', 'whatsapp');
    const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...fd.getHeaders() }, body: fd
    });
    const d = await r.json();
    return d.id || null;
  } catch(e) { console.error('waUpload', e.message); return null; }
}

async function waSend(to, payload) {
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload })
    });
    const d = await r.json();
    if (d.error) return { ok: false, error: d.error.message };
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
}

async function aiReply(phone) {
  const chat = chatStore.get(phone);
  if (!chat) return settings.welcomeMessage;
  const msgs = [
    { role: 'system', content: systemPrompt },
    ...chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-16).map(m => ({ role: m.role, content: m.content || '[media]' }))
  ];
  try {
    const r = await openai.chat.completions.create({
      model: settings.aiModel || 'gpt-4o-mini',
      messages: msgs,
      max_tokens: settings.maxTokens || 300,
      temperature: settings.aiTemperature || 0.7
    });
    return r.choices[0].message.content.trim();
  } catch(e) {
    console.error('AI', e.message);
    return 'Sorry, thodi technical issue hai. Thori der baad try karein.';
  }
}

function ensureChat(phone, name) {
  if (!chatStore.has(phone)) {
    chatStore.set(phone, {
      messages: [],
      name: name || ('+' + phone),
      lastSeen: new Date().toISOString(),
      aiPaused: false,
      unread: 0
    });
  }
  const c = chatStore.get(phone);
  if (name && name.trim()) c.name = name.trim();
  return c;
}

// ========== WEBHOOK ==========
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const value = change.value;
        if (!value?.messages) continue;
        const contactName = value.contacts?.[0]?.profile?.name || '';
        for (const msg of value.messages) {
          const phone = String(msg.from || '');
          if (!phone) continue;

          const chat = ensureChat(phone, contactName);
          chat.lastSeen = new Date().toISOString();
          chat.unread = (chat.unread || 0) + 1;

          let content = '[' + (msg.type || 'msg') + ']';
          let type = msg.type || 'text';
          if (msg.type === 'text') content = msg.text?.body || '';
          else if (msg.type === 'image') content = msg.image?.caption || '📷 Photo';
          else if (msg.type === 'audio' || msg.type === 'voice') content = '🎤 Voice';
          else if (msg.type === 'video') content = msg.video?.caption || '🎥 Video';
          else if (msg.type === 'document') content = '📄 Document';

          chat.messages.push({ role: 'user', content, type, timestamp: new Date().toISOString() });
          saveChats();
          console.log('📩', phone, content.slice(0, 40));

          if (aiPaused.has(phone) || chat.aiPaused || settings.isAway) continue;

          if (msg.type === 'text') {
            const reply = await aiReply(phone);
            const sent = await waSend(phone, { type: 'text', text: { body: reply } });
            if (sent.ok) {
              chat.messages.push({ role: 'assistant', content: reply, sender: 'ai', type: 'text', timestamp: new Date().toISOString() });
              saveChats();
            }
          } else {
            const ack = 'Shukriya! Message receive ho gaya. Koi madad chahiye to batayein 🙂';
            await waSend(phone, { type: 'text', text: { body: ack } });
            chat.messages.push({ role: 'assistant', content: ack, sender: 'ai', type: 'text', timestamp: new Date().toISOString() });
            saveChats();
          }
        }
      }
    }
  } catch (e) { console.error('webhook', e.message); }
});

// ========== API ==========
app.get('/', (req, res) => {
  res.json({
    status: 'Vestrex Bot v4 LIVE ✅',
    chats: chatStore.size,
    paused: aiPaused.size,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// DEBUG — open this if chats missing
app.get('/api/debug', (req, res) => {
  res.json({
    chatCount: chatStore.size,
    chats: Array.from(chatStore.entries()).map(([p, c]) => ({
      phone: p, name: c.name, msgs: (c.messages||[]).length, lastSeen: c.lastSeen
    })),
    paused: Array.from(aiPaused),
    dataDir: DATA_DIR,
    filesExist: {
      chats: fs.existsSync(F.chats),
      settings: fs.existsSync(F.settings)
    }
  });
});

app.get('/api/chats', (req, res) => {
  try {
    const list = Array.from(chatStore.entries()).map(([phone, chat]) => {
      const msgs = chat.messages || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return {
        phone: String(phone),
        name: String(chat.name || phone),
        lastMessage: String(last?.content || '').slice(0, 60),
        lastSeen: chat.lastSeen || new Date().toISOString(),
        aiPaused: aiPaused.has(phone) || !!chat.aiPaused,
        unread: Number(chat.unread || 0),
        count: msgs.length
      };
    }).sort((a,b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    res.json(list);
  } catch (e) {
    console.error('api/chats', e);
    res.json([]);
  }
});

app.get('/api/chats/:phone', (req, res) => {
  const phone = String(req.params.phone);
  const chat = chatStore.get(phone);
  if (!chat) return res.status(404).json({ error: 'not found' });
  chat.unread = 0;
  saveChats();
  res.json({
    phone,
    name: String(chat.name || phone),
    aiPaused: aiPaused.has(phone) || !!chat.aiPaused,
    messages: chat.messages || []
  });
});

app.post('/api/reply', async (req, res) => {
  const phone = String(req.body.phone || '');
  const message = String(req.body.message || '').trim();
  if (!phone || !message) return res.status(400).json({ error: 'phone/message required' });

  aiPaused.add(phone);
  const chat = ensureChat(phone);
  chat.aiPaused = true;
  savePaused();

  const sent = await waSend(phone, { type: 'text', text: { body: message } });
  if (!sent.ok) return res.status(500).json({ error: sent.error });

  chat.messages.push({ role: 'assistant', content: message, sender: 'admin', type: 'text', timestamp: new Date().toISOString() });
  chat.lastSeen = new Date().toISOString();
  saveChats();
  res.json({ success: true });
});

app.post('/api/reply-media', upload.single('media'), async (req, res) => {
  const phone = String(req.body.phone || '');
  const caption = String(req.body.caption || '');
  if (!phone || !req.file) return res.status(400).json({ error: 'file/phone required' });

  aiPaused.add(phone);
  const chat = ensureChat(phone);
  chat.aiPaused = true;
  savePaused();

  const id = await waUpload(req.file.path, req.file.mimetype);
  if (!id) return res.status(500).json({ error: 'WhatsApp media upload failed' });

  let type = 'document', payload = {};
  if (req.file.mimetype.startsWith('image/')) {
    type = 'image'; payload = { type: 'image', image: { id, caption } };
  } else if (req.file.mimetype.startsWith('video/')) {
    type = 'video'; payload = { type: 'video', video: { id, caption } };
  } else {
    payload = { type: 'document', document: { id, filename: req.file.originalname, caption } };
  }

  const sent = await waSend(phone, payload);
  if (!sent.ok) return res.status(500).json({ error: sent.error });

  chat.messages.push({
    role: 'assistant', content: caption || ('[' + type + ']'), sender: 'admin', type,
    mediaUrl: '/uploads/' + req.file.filename, timestamp: new Date().toISOString()
  });
  chat.lastSeen = new Date().toISOString();
  saveChats();
  res.json({ success: true });
});

app.post('/api/send-voice', upload.single('voice'), async (req, res) => {
  const phone = String(req.body.phone || '');
  if (!phone || !req.file) return res.status(400).json({ error: 'voice/phone required' });

  aiPaused.add(phone);
  const chat = ensureChat(phone);
  chat.aiPaused = true;
  savePaused();

  const id = await waUpload(req.file.path, 'audio/ogg; codecs=opus');
  if (!id) return res.status(500).json({ error: 'voice upload failed' });

  const sent = await waSend(phone, { type: 'audio', audio: { id } });
  if (!sent.ok) return res.status(500).json({ error: sent.error });

  chat.messages.push({
    role: 'assistant', content: '🎤 Voice note', sender: 'admin', type: 'audio',
    mediaUrl: '/uploads/' + req.file.filename, timestamp: new Date().toISOString()
  });
  chat.lastSeen = new Date().toISOString();
  saveChats();
  res.json({ success: true });
});

app.post('/api/pause/:phone', (req, res) => {
  const phone = String(req.params.phone);
  aiPaused.add(phone);
  const c = chatStore.get(phone); if (c) c.aiPaused = true;
  savePaused(); saveChats();
  res.json({ success: true });
});

app.post('/api/resume/:phone', (req, res) => {
  const phone = String(req.params.phone);
  aiPaused.delete(phone);
  const c = chatStore.get(phone); if (c) c.aiPaused = false;
  savePaused(); saveChats();
  res.json({ success: true });
});

app.get('/api/prompt', (req, res) => res.json({ prompt: systemPrompt }));
app.post('/api/prompt', (req, res) => {
  if (!req.body.prompt || req.body.prompt.length < 10) return res.status(400).json({ error: 'too short' });
  systemPrompt = req.body.prompt;
  savePrompt();
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => res.json(settings));
app.post('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body };
  saveSettings();
  res.json({ success: true });
});

app.delete('/api/chats/:phone', (req, res) => {
  chatStore.delete(String(req.params.phone));
  aiPaused.delete(String(req.params.phone));
  saveChats(); savePaused();
  res.json({ success: true });
});

app.get('/api/backup', (req, res) => {
  const backup = {
    version: 4,
    at: new Date().toISOString(),
    chats: Array.from(chatStore.entries()),
    paused: Array.from(aiPaused),
    settings,
    prompt: systemPrompt
  };
  res.setHeader('Content-Disposition', 'attachment; filename=vestrex-backup.json');
  res.json(backup);
});

// ========== DASHBOARD ==========
app.get('/admin', (req, res) => res.send(getHTML()));

app.listen(PORT, () => {
  console.log('🚀 Vestrex v4 on', PORT);
  console.log('📊 Admin: /admin');
  console.log('🔎 Debug: /api/debug');
});

// ========== PREMIUM HTML ==========
function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>Vestrex Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#07080d; --bg2:#0c0e16; --panel:rgba(18,20,32,.85); --card:rgba(28,31,48,.7);
  --line:rgba(255,255,255,.06); --text:#eef0f6; --muted:#8b93a7;
  --p:#7c5cff; --p2:#a78bfa; --g:#22c55e; --r:#ef4444; --o:#f59e0b; --b:#38bdf8;
  --glow:0 0 40px rgba(124,92,255,.25);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;overflow:hidden}
body:before{content:'';position:fixed;inset:0;background:
  radial-gradient(1200px 600px at 10% -10%, rgba(124,92,255,.18), transparent 60%),
  radial-gradient(900px 500px at 100% 0%, rgba(56,189,248,.10), transparent 50%),
  radial-gradient(800px 400px at 50% 120%, rgba(34,197,94,.08), transparent 50%);
  pointer-events:none;z-index:0}

.app{position:relative;z-index:1;display:flex;height:100dvh;width:100vw}

/* SIDEBAR */
.side{width:360px;min-width:300px;display:flex;flex-direction:column;background:var(--panel);backdrop-filter:blur(20px);border-right:1px solid var(--line)}
.side-top{padding:18px 16px 12px;border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.logo-mark{width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,var(--p),#4f46e5);display:grid;place-items:center;font-weight:800;box-shadow:var(--glow)}
.logo h1{font-size:16px;font-weight:800;letter-spacing:.3px}
.logo p{font-size:11px;color:var(--muted)}
.live{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--g);background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);padding:4px 8px;border-radius:999px;margin-top:6px}
.live i{width:6px;height:6px;border-radius:50%;background:var(--g);box-shadow:0 0 8px var(--g);animation:pulse 1.5s infinite}
@keyframes pulse{50%{opacity:.4}}
.stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:12px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;text-align:center}
.stat b{display:block;font-size:16px;font-weight:700}
.stat span{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.btn{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:12px;padding:10px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:.2s;display:flex;align-items:center;justify-content:center;gap:6px}
.btn:hover{border-color:rgba(124,92,255,.5);background:rgba(124,92,255,.12);transform:translateY(-1px)}
.btn.primary{background:linear-gradient(135deg,var(--p),#4f46e5);border:none;box-shadow:var(--glow)}
.btn.danger{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.25);color:#fca5a5}
.search{padding:10px 16px;border-bottom:1px solid var(--line)}
.search input{width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);border-radius:12px;padding:11px 14px;outline:none;font-size:13px}
.search input:focus{border-color:var(--p);box-shadow:0 0 0 3px rgba(124,92,255,.15)}
.list{flex:1;overflow:auto;padding:8px}
.list::-webkit-scrollbar{width:4px}.list::-webkit-scrollbar-thumb{background:#2a2d3a;border-radius:4px}
.item{display:flex;gap:12px;align-items:center;padding:12px;border-radius:14px;cursor:pointer;border:1px solid transparent;margin-bottom:4px;transition:.15s}
.item:hover{background:rgba(255,255,255,.03)}
.item.on{background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.35)}
.av{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:grid;place-items:center;font-weight:800;flex-shrink:0}
.meta{flex:1;min-width:0}
.row{display:flex;justify-content:space-between;gap:8px;align-items:center}
.name{font-size:13.5px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.time{font-size:10px;color:var(--muted);flex-shrink:0}
.prev{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
.badges{display:flex;gap:6px;align-items:center}
.dot{width:8px;height:8px;border-radius:50%;background:var(--o);box-shadow:0 0 8px var(--o)}
.un{min-width:18px;height:18px;padding:0 6px;border-radius:999px;background:var(--p);color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;min-width:0;background:transparent}
.empty{flex:1;display:grid;place-items:center;text-align:center;padding:40px}
.empty .card{background:var(--panel);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:24px;padding:40px 32px;max-width:420px;box-shadow:var(--glow)}
.empty h2{font-size:22px;margin:12px 0 8px}
.empty p{color:var(--muted);font-size:13px;line-height:1.6}

.chat{display:none;flex-direction:column;height:100%}
.head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel);backdrop-filter:blur(16px)}
.hleft{display:flex;align-items:center;gap:12px;min-width:0}
.back{display:none;background:var(--card);border:1px solid var(--line);color:var(--text);width:36px;height:36px;border-radius:10px;cursor:pointer}
.hname{font-weight:700;font-size:15px}
.hsub{font-size:11px;color:var(--muted)}
.hright{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pill{font-size:11px;font-weight:650;padding:6px 10px;border-radius:999px;border:1px solid var(--line)}
.pill.on{color:var(--g);background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.25)}
.pill.off{color:var(--o);background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.25)}

.msgs{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.msgs::-webkit-scrollbar{width:5px}.msgs::-webkit-scrollbar-thumb{background:#2a2d3a;border-radius:4px}
.bubble{max-width:min(72%, 520px);padding:12px 14px;border-radius:16px;font-size:14px;line-height:1.5;position:relative;word-break:break-word}
.b-user{align-self:flex-start;background:rgba(255,255,255,.05);border:1px solid var(--line);border-bottom-left-radius:4px}
.b-ai{align-self:flex-end;background:rgba(45,55,72,.9);border:1px solid var(--line);border-bottom-right-radius:4px}
.b-admin{align-self:flex-end;background:linear-gradient(135deg,rgba(124,92,255,.95),rgba(79,70,229,.95));border-bottom-right-radius:4px;box-shadow:var(--glow)}
.bubble img,.bubble video{max-width:100%;border-radius:10px;margin-top:8px}
.bubble audio{width:100%;margin-top:8px}
.bmeta{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:10px;color:rgba(255,255,255,.45)}

.composer{padding:14px 16px;border-top:1px solid var(--line);background:var(--panel);backdrop-filter:blur(16px)}
.preview,.voicebar{display:none;align-items:center;justify-content:space-between;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.voicebar{border-color:rgba(239,68,68,.35)}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.tool{background:var(--card);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:8px 12px;font-size:12px;cursor:pointer}
.tool:hover{border-color:var(--p)}
.sendrow{display:flex;gap:10px;align-items:flex-end}
textarea{flex:1;min-height:46px;max-height:120px;resize:none;border-radius:14px;border:1px solid var(--line);background:var(--bg2);color:var(--text);padding:12px 14px;outline:none;font:inherit}
textarea:focus{border-color:var(--p);box-shadow:0 0 0 3px rgba(124,92,255,.15)}
.send{height:46px;padding:0 18px;border:none;border-radius:14px;background:linear-gradient(135deg,var(--p),#4f46e5);color:#fff;font-weight:700;cursor:pointer;box-shadow:var(--glow)}
.send:disabled{opacity:.5;cursor:not-allowed}

/* MODAL */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);z-index:50;align-items:center;justify-content:center;padding:16px}
.overlay.show{display:flex}
.modal{width:min(560px,100%);max-height:88dvh;background:var(--bg2);border:1px solid var(--line);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.mhd{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}
.mbd{padding:18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.mft{padding:14px 18px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:8px}
.modal label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.modal input,.modal textarea{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:12px;padding:12px;outline:none;font:inherit}
.modal textarea{min-height:220px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55}
.x{background:transparent;border:none;color:var(--muted);font-size:20px;cursor:pointer}

.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--p);color:#fff;padding:12px 18px;border-radius:999px;font-size:13px;font-weight:650;z-index:99;display:none;box-shadow:var(--glow)}

@media(max-width:860px){
  .side{width:100%;position:absolute;inset:0;z-index:5}
  .main{position:absolute;inset:0;transform:translateX(100%);transition:.28s ease;z-index:6;background:var(--bg)}
  .app.open .main{transform:none}
  .app.open .side{opacity:.35;pointer-events:none}
  .back{display:grid;place-items:center}
  .bubble{max-width:88%}
}
</style>
</head>
<body>
<div class="app" id="app">
  <aside class="side">
    <div class="side-top">
      <div class="logo">
        <div class="logo-mark">V</div>
        <div>
          <h1>VESTREX</h1>
          <p>Command Center v4</p>
        </div>
      </div>
      <div class="live"><i></i> Live System</div>
      <div class="stats">
        <div class="stat"><b id="sChats">0</b><span>Chats</span></div>
        <div class="stat"><b id="sPaused">0</b><span>Paused</span></div>
        <div class="stat"><b id="sMsgs">0</b><span>Msgs</span></div>
      </div>
      <div class="actions">
        <button class="btn" onclick="openModal('promptModal')">✨ Prompt</button>
        <button class="btn" onclick="openModal('settingsModal')">⚙️ Settings</button>
        <button class="btn" onclick="refreshAll()">🔄 Refresh</button>
        <button class="btn" onclick="downloadBackup()">💾 Backup</button>
      </div>
    </div>
    <div class="search"><input id="q" placeholder="Search name or number..." oninput="renderList()"/></div>
    <div class="list" id="list"><div style="text-align:center;color:var(--muted);padding:28px 12px;font-size:13px">Loading conversations...</div></div>
  </aside>

  <main class="main">
    <div class="empty" id="empty">
      <div class="card">
        <div style="font-size:40px">💬</div>
        <h2>Vestrex Inbox</h2>
        <p>Left se koi chat select karo. AI auto-reply karega. Jab aap reply doge AI pause ho jayegi.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:18px;flex-wrap:wrap">
          <button class="btn primary" onclick="openModal('promptModal')">Edit AI Prompt</button>
          <button class="btn" onclick="window.open('/api/debug','_blank')">Debug Data</button>
        </div>
      </div>
    </div>

    <div class="chat" id="chat">
      <div class="head">
        <div class="hleft">
          <button class="back" onclick="closeChat()">←</button>
          <div class="av" id="av">V</div>
          <div style="min-width:0">
            <div class="hname" id="nm">Customer</div>
            <div class="hsub" id="ph">+92...</div>
          </div>
        </div>
        <div class="hright">
          <span class="pill on" id="pill">AI Active</span>
          <button class="btn" id="aiBtn" onclick="toggleAI()">Pause AI</button>
          <button class="btn danger" onclick="deleteChat()">Delete</button>
        </div>
      </div>
      <div class="msgs" id="msgs"></div>
      <div class="composer">
        <div class="preview" id="preview">
          <span id="pname" style="font-size:12px;color:var(--muted)">file</span>
          <button class="btn danger" onclick="clearFile()">Remove</button>
        </div>
        <div class="voicebar" id="voicebar">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--r);animation:pulse 1s infinite"></div>
            <b id="vtime">00:00</b>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn" onclick="stopVoice()">Stop</button>
            <button class="btn primary" id="vsend" style="display:none" onclick="sendVoice()">Send Voice</button>
            <button class="btn" onclick="cancelVoice()">Cancel</button>
          </div>
        </div>
        <div class="tools">
          <button class="tool" onclick="document.getElementById('file').click()">📎 Photo / File</button>
          <button class="tool" onclick="startVoice()">🎤 Voice Note</button>
        </div>
        <div class="sendrow">
          <textarea id="input" placeholder="Write a reply... Enter to send"></textarea>
          <button class="send" id="send" onclick="sendMsg()">Send</button>
        </div>
      </div>
    </div>
  </main>
</div>

<input type="file" id="file" hidden accept="image/*,video/*,audio/*,.pdf" onchange="onFile(event)"/>

<div class="overlay" id="promptModal">
  <div class="modal">
    <div class="mhd"><b>✨ AI System Prompt</b><button class="x" onclick="closeModal('promptModal')">×</button></div>
    <div class="mbd">
      <label>Prompt / Prices / Rules</label>
      <textarea id="promptBox"></textarea>
    </div>
    <div class="mft"><button class="btn" onclick="closeModal('promptModal')">Cancel</button><button class="btn primary" onclick="savePrompt()">Save Prompt</button></div>
  </div>
</div>

<div class="overlay" id="settingsModal">
  <div class="modal">
    <div class="mhd"><b>⚙️ Bot Settings</b><button class="x" onclick="closeModal('settingsModal')">×</button></div>
    <div class="mbd">
      <label>Welcome Message</label>
      <input id="setWelcome"/>
      <label>Away Message</label>
      <input id="setAway"/>
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;color:var(--text)">
        <input type="checkbox" id="setAwayOn" style="width:auto"/> Away Mode ON
      </label>
    </div>
    <div class="mft"><button class="btn" onclick="closeModal('settingsModal')">Cancel</button><button class="btn primary" onclick="saveSettings()">Save</button></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
var chats=[], phone=null, fileObj=null, rec=null, chunks=[], tmr=null, secs=0, blob=null;

function toast(m, err){var t=document.getElementById('toast');t.textContent=m;t.style.background=err?'var(--r)':'var(--p)';t.style.display='block';setTimeout(function(){t.style.display='none'},2800)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function initial(n){n=String(n||'C').trim();return (n.charAt(0)||'C').toUpperCase()}
function time(iso){try{return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}}

function refreshAll(){loadChats();toast('Refreshed')}
function downloadBackup(){window.location.href='/api/backup'}

function loadChats(silent){
  fetch('/api/chats').then(function(r){return r.json()}).then(function(data){
    chats = Array.isArray(data)?data:[];
    var totalMsgs=0, paused=0;
    chats.forEach(function(c){ totalMsgs += (c.count||0); if(c.aiPaused) paused++; });
    document.getElementById('sChats').textContent = chats.length;
    document.getElementById('sPaused').textContent = paused;
    document.getElementById('sMsgs').textContent = totalMsgs;
    renderList();
    if(phone) loadMessages(phone, silent);
  }).catch(function(){ document.getElementById('list').innerHTML='<div style="padding:20px;color:#f87171;text-align:center">API error. <button class="btn" onclick="loadChats()">Retry</button></div>' });
}

function renderList(){
  var q=(document.getElementById('q').value||'').toLowerCase();
  var el=document.getElementById('list');
  var rows=chats.filter(function(c){
    return String(c.name||'').toLowerCase().indexOf(q)>-1 || String(c.phone||'').indexOf(q)>-1;
  });
  if(!rows.length){ el.innerHTML='<div style="text-align:center;color:var(--muted);padding:30px 12px;font-size:13px">No chats yet.<br/>WhatsApp pe message bhejo.</div>'; return; }
  el.innerHTML = rows.map(function(c){
    var on = c.phone===phone ? ' on' : '';
    var badge = (c.unread>0 && c.phone!==phone) ? '<div class="un">'+c.unread+'</div>' : '';
    var pauseDot = c.aiPaused ? '<div class="dot" title="AI Paused"></div>' : '';
    return '<div class="item'+on+'" onclick="openChat(\\''+c.phone+'\\')">'+
      '<div class="av">'+esc(initial(c.name))+'</div>'+
      '<div class="meta"><div class="row"><div class="name">'+esc(c.name||c.phone)+'</div><div class="time">'+time(c.lastSeen)+'</div></div>'+
      '<div class="row"><div class="prev">'+(c.aiPaused?'⏸ ':'')+esc(c.lastMessage||'')+'</div><div class="badges">'+pauseDot+badge+'</div></div></div></div>';
  }).join('');
}

function openChat(p){
  phone=String(p);
  document.getElementById('app').classList.add('open');
  document.getElementById('empty').style.display='none';
  document.getElementById('chat').style.display='flex';
  loadMessages(phone);
  renderList();
  document.getElementById('input').focus();
}
function closeChat(){
  phone=null;
  document.getElementById('app').classList.remove('open');
  document.getElementById('chat').style.display='none';
  document.getElementById('empty').style.display='grid';
  renderList();
}

function loadMessages(p, silent){
  if(p!==phone) return;
  fetch('/api/chats/'+encodeURIComponent(p)).then(function(r){return r.json()}).then(function(d){
    document.getElementById('nm').textContent=d.name||d.phone;
    document.getElementById('ph').textContent='+'+d.phone;
    document.getElementById('av').textContent=initial(d.name||d.phone);
    var pill=document.getElementById('pill'), btn=document.getElementById('aiBtn');
    if(d.aiPaused){ pill.className='pill off'; pill.textContent='AI Paused'; btn.textContent='Resume AI'; }
    else { pill.className='pill on'; pill.textContent='AI Active'; btn.textContent='Pause AI'; }

    var box=document.getElementById('msgs');
    var stick = box.scrollHeight - box.scrollTop < box.clientHeight + 80;
    var html='';
    (d.messages||[]).forEach(function(m){
      var cls='b-user', who='Customer';
      if(m.sender==='admin'){ cls='b-admin'; who='Admin'; }
      else if(m.sender==='ai' || m.role==='assistant'){ cls='b-ai'; who='AI'; }
      var media='';
      if(m.mediaUrl){
        if(m.type==='image') media='<img src="'+m.mediaUrl+'" onclick="window.open(this.src)"/>' ;
        else if(m.type==='video') media='<video src="'+m.mediaUrl+'" controls></video>';
        else if(m.type==='audio') media='<audio src="'+m.mediaUrl+'" controls></audio>';
        else media='<div style="margin-top:6px"><a style="color:#c4b5fd" href="'+m.mediaUrl+'" target="_blank">Open file</a></div>';
      }
      html += '<div class="bubble '+cls+'">'+esc(m.content||'')+media+'<div class="bmeta"><span>'+who+'</span><span>'+time(m.timestamp)+'</span></div></div>';
    });
    box.innerHTML=html;
    if(stick || !silent) box.scrollTop=box.scrollHeight;
  });
}

function sendMsg(){
  if(!phone) return;
  var text=document.getElementById('input').value.trim();
  var btn=document.getElementById('send');
  if(fileObj){ return sendFile(text); }
  if(!text) return;
  btn.disabled=true; btn.textContent='...';
  fetch('/api/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone,message:text})})
  .then(function(r){return r.json()}).then(function(d){
    if(d.success){ document.getElementById('input').value=''; loadMessages(phone); loadChats(true); toast('Sent'); }
    else toast(d.error||'Failed', true);
  }).catch(function(){toast('Network error',true)}).finally(function(){btn.disabled=false;btn.textContent='Send'});
}

function onFile(e){ if(!e.target.files[0])return; fileObj=e.target.files[0]; document.getElementById('pname').textContent=fileObj.name; document.getElementById('preview').style.display='flex'; }
function clearFile(){ fileObj=null; document.getElementById('file').value=''; document.getElementById('preview').style.display='none'; }
function sendFile(caption){
  var btn=document.getElementById('send'); btn.disabled=true; btn.textContent='Upload...';
  var fd=new FormData(); fd.append('phone',phone); fd.append('media',fileObj); fd.append('caption',caption||'');
  fetch('/api/reply-media',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(d){
    if(d.success){ document.getElementById('input').value=''; clearFile(); loadMessages(phone); loadChats(true); toast('Media sent'); }
    else toast(d.error||'Upload failed', true);
  }).catch(function(){toast('Upload error',true)}).finally(function(){btn.disabled=false;btn.textContent='Send'});
}

function startVoice(){
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    rec=new MediaRecorder(stream); chunks=[]; secs=0; blob=null;
    rec.ondataavailable=function(e){ if(e.data.size) chunks.push(e.data); };
    rec.onstop=function(){ blob=new Blob(chunks,{type:'audio/webm'}); stream.getTracks().forEach(function(t){t.stop()}); document.getElementById('vsend').style.display='inline-flex'; clearInterval(tmr); };
    rec.start(); document.getElementById('voicebar').style.display='flex'; document.getElementById('vsend').style.display='none';
    tmr=setInterval(function(){ secs++; document.getElementById('vtime').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0'); },1000);
  }).catch(function(){ toast('Mic permission denied', true); });
}
function stopVoice(){ if(rec && rec.state==='recording') rec.stop(); }
function cancelVoice(){ if(rec && rec.state==='recording') rec.stop(); blob=null; document.getElementById('voicebar').style.display='none'; clearInterval(tmr); }
function sendVoice(){
  if(!blob||!phone) return;
  document.getElementById('vsend').textContent='...';
  var fd=new FormData(); fd.append('phone',phone); fd.append('voice', blob, 'voice.webm');
  fetch('/api/send-voice',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(d){
    if(d.success){ toast('Voice sent'); loadMessages(phone); loadChats(true); cancelVoice(); }
    else { toast(d.error||'Voice failed', true); document.getElementById('vsend').textContent='Send Voice'; }
  }).catch(function(){ toast('Voice error', true); document.getElementById('vsend').textContent='Send Voice'; });
}

function toggleAI(){
  if(!phone) return;
  var c=chats.find(function(x){return x.phone===phone});
  var path=(c && c.aiPaused)?'resume':'pause';
  fetch('/api/'+path+'/'+encodeURIComponent(phone),{method:'POST'}).then(function(){ loadChats(true); toast(path==='pause'?'AI Paused':'AI Resumed'); });
}
function deleteChat(){
  if(!phone || !confirm('Delete this chat?')) return;
  fetch('/api/chats/'+encodeURIComponent(phone),{method:'DELETE'}).then(function(){ toast('Deleted'); closeChat(); loadChats(); });
}

function openModal(id){
  document.getElementById(id).classList.add('show');
  if(id==='promptModal') fetch('/api/prompt').then(r=>r.json()).then(d=>document.getElementById('promptBox').value=d.prompt||'');
  if(id==='settingsModal') fetch('/api/settings').then(r=>r.json()).then(d=>{
    document.getElementById('setWelcome').value=d.welcomeMessage||'';
    document.getElementById('setAway').value=d.awayMessage||'';
    document.getElementById('setAwayOn').checked=!!d.isAway;
  });
}
function closeModal(id){ document.getElementById(id).classList.remove('show'); }
function savePrompt(){
  fetch('/api/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:document.getElementById('promptBox').value})})
  .then(function(){ toast('Prompt saved'); closeModal('promptModal'); });
}
function saveSettings(){
  var body={ welcomeMessage:document.getElementById('setWelcome').value, awayMessage:document.getElementById('setAway').value, isAway:document.getElementById('setAwayOn').checked };
  fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(function(){ toast('Settings saved'); closeModal('settingsModal'); });
}

document.getElementById('input').addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMsg(); }});
loadChats();
setInterval(function(){ if(!fileObj && !blob) loadChats(true); }, 2500);
</script>
</body>
</html>`;
}
