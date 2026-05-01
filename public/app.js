// ── State ──────────────────────────────────────────────────────
const state = {
  model: localStorage.getItem('mubot_model') || 'llama-3.3-70b-versatile',
  messages: [],          // current chat
  sessions: JSON.parse(localStorage.getItem('mubot_sessions') || '[]'),
  currentSession: null,
  isStreaming: false,
  theme: localStorage.getItem('mubot_theme') || 'dark',
};

// ── DOM Refs ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const modelSelect     = $('model-select');
const modelBadge      = $('model-badge');
const chatInput       = $('chat-input');
const sendBtn         = $('send-btn');
const charCount       = $('char-count');
const messagesList    = $('messages-list');
const messagesContainer = $('messages-container');
const welcomeScreen   = $('welcome-screen');
const historyList     = $('history-list');
const chatTitle       = $('chat-title');
const toast           = $('toast');
const newChatBtn      = $('new-chat-btn');
const clearBtn        = $('clear-btn');
const exportBtn       = $('export-btn');
const hamburgerBtn    = $('hamburger-btn');
const sidebar         = $('sidebar');
const themeBtn        = $('theme-btn');
const themeIcon       = $('theme-icon');

// ── Init ───────────────────────────────────────────────────────
function init() {
  applyTheme(state.theme);
  modelSelect.value = state.model;
  updateModelBadge();
  renderHistory();
  startParticles();
  startNewSession();
}

// ── Theme ──────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  localStorage.setItem('mubot_theme', theme);
  themeIcon.innerHTML = theme === 'dark'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
}

themeBtn.addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
});

// ── Sidebar Toggle ─────────────────────────────────────────────
hamburgerBtn.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// ── Model ──────────────────────────────────────────────────────
function updateModelBadge() {
  const labels = {
    'llama-3.3-70b-versatile': 'Llama 3.3 70B',
    'llama-3.1-8b-instant': 'Llama 3.1 8B',
    'mixtral-8x7b-32768': 'Mixtral 8x7B',
    'gemma2-9b-it': 'Gemma 2 9B',
    'llama3-70b-8192': 'Llama 3 70B',
  };
  modelBadge.textContent = labels[state.model] || state.model;
}

modelSelect.addEventListener('change', () => {
  state.model = modelSelect.value;
  localStorage.setItem('mubot_model', state.model);
  updateModelBadge();
  showToast('Model updated!', 'success');
});

// ── Textarea Auto-resize ───────────────────────────────────────
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
  charCount.textContent = chatInput.value.length;
  sendBtn.disabled = chatInput.value.trim() === '' || state.isStreaming;
});

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

// ── Send ───────────────────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || state.isStreaming) return;

  // Hide welcome screen
  welcomeScreen.style.display = 'none';

  // Add user message
  state.messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  // Reset input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  charCount.textContent = '0';
  sendBtn.disabled = true;
  state.isStreaming = true;

  // Update session title
  if (state.messages.length === 1) {
    state.currentSession.title = text.length > 40 ? text.slice(0, 40) + '…' : text;
    chatTitle.textContent = state.currentSession.title;
    renderHistory();
  }

  // Show typing indicator
  const typingEl = appendTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: state.model,
        messages: state.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.75
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    typingEl.remove();
    const botBubble = appendMessage('bot', '');
    const bubbleText = botBubble.querySelector('.msg-bubble');
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    bubbleText.appendChild(cursor);

    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const json = line.slice(6);
        if (json === '[DONE]') break;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          fullText += delta;
          bubbleText.innerHTML = formatMessage(fullText);
          bubbleText.appendChild(cursor);
          scrollToBottom();
        } catch (_) {}
      }
    }

    cursor.remove();
    state.messages.push({ role: 'assistant', content: fullText });
    saveSession();

  } catch (err) {
    typingEl?.remove?.();
    appendError(err.message);
    showToast(err.message, 'error');
  } finally {
    state.isStreaming = false;
    sendBtn.disabled = chatInput.value.trim() === '';
    scrollToBottom();
  }
}

// ── Render helpers ─────────────────────────────────────────────
function formatMessage(text) {
  // Code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${escapeHtml(code.trim())}</code></pre>`
  );
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Newlines
  text = text.replace(/\n/g, '<br>');
  return text;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appendMessage(role, content) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  const avatarText = role === 'bot' ? 'μ' : 'U';
  row.innerHTML = `
    <div class="msg-avatar ${role}">${avatarText}</div>
    <div class="msg-content">
      <div class="msg-bubble">${role === 'bot' ? formatMessage(content) : escapeHtml(content)}</div>
      <div class="msg-time">${getTime()}</div>
      <div class="msg-actions">
        <button class="msg-action-btn" title="Copy" onclick="copyMsg(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      </div>
    </div>`;
  messagesList.appendChild(row);
  scrollToBottom();
  return row;
}

function appendTyping() {
  const row = document.createElement('div');
  row.className = 'message-row bot';
  row.innerHTML = `
    <div class="msg-avatar bot">μ</div>
    <div class="msg-content">
      <div class="msg-bubble" style="padding:10px 16px">
        <div class="typing-indicator"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  messagesList.appendChild(row);
  scrollToBottom();
  return row;
}

function appendError(msg) {
  const el = document.createElement('div');
  el.className = 'error-msg';
  el.innerHTML = `⚠️ ${escapeHtml(msg)}`;
  messagesList.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ── Copy message ───────────────────────────────────────────────
window.copyMsg = function(btn) {
  const bubble = btn.closest('.msg-content').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText).then(() => showToast('Copied!', 'success'));
};

// ── Sessions / History ─────────────────────────────────────────
function startNewSession() {
  state.currentSession = { id: Date.now(), title: 'New Conversation', messages: [] };
  state.messages = [];
  messagesList.innerHTML = '';
  welcomeScreen.style.display = 'flex';
  chatTitle.textContent = 'New Conversation';
  state.sessions.unshift(state.currentSession);
  saveSession();
  renderHistory();
}

function saveSession() {
  state.currentSession.messages = [...state.messages];
  state.sessions[0] = state.currentSession;
  // Keep max 20 sessions
  if (state.sessions.length > 20) state.sessions.splice(20);
  localStorage.setItem('mubot_sessions', JSON.stringify(state.sessions));
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  state.sessions.slice(0, 15).forEach((session, i) => {
    const li = document.createElement('li');
    li.className = 'history-item' + (session.id === state.currentSession?.id ? ' active' : '');
    li.textContent = session.title || 'New Conversation';
    li.title = session.title;
    li.addEventListener('click', () => loadSession(session));
    historyList.appendChild(li);
  });
}

function loadSession(session) {
  state.currentSession = session;
  state.messages = [...session.messages];
  messagesList.innerHTML = '';
  chatTitle.textContent = session.title || 'New Conversation';

  if (state.messages.length === 0) {
    welcomeScreen.style.display = 'flex';
  } else {
    welcomeScreen.style.display = 'none';
    state.messages.forEach(m => appendMessage(m.role === 'assistant' ? 'bot' : m.role, m.content));
  }
  renderHistory();
  scrollToBottom();
}

newChatBtn.addEventListener('click', startNewSession);

clearBtn.addEventListener('click', () => {
  if (!confirm('Clear this conversation?')) return;
  state.messages = [];
  messagesList.innerHTML = '';
  welcomeScreen.style.display = 'flex';
  chatTitle.textContent = 'New Conversation';
  state.currentSession.title = 'New Conversation';
  state.currentSession.messages = [];
  saveSession();
});

// ── Export ─────────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  if (state.messages.length === 0) { showToast('Nothing to export', ''); return; }
  const lines = state.messages.map(m =>
    `[${m.role.toUpperCase()}]\n${m.content}\n`
  ).join('\n---\n\n');
  const blob = new Blob([lines], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `muBOT-chat-${Date.now()}.txt`;
  a.click();
  showToast('Exported!', 'success');
});

// ── Suggestion Cards ───────────────────────────────────────────
document.querySelectorAll('.suggestion-card').forEach(card => {
  card.addEventListener('click', () => {
    chatInput.value = card.dataset.prompt;
    chatInput.dispatchEvent(new Event('input'));
    sendMessage();
  });
});

// ── Toast ──────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2800);
}

// ── Particle Canvas ────────────────────────────────────────────
function startParticles() {
  const canvas = $('particle-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = ['#7c3aed', '#06b6d4', '#ec4899', '#a78bfa', '#22d3ee'];

  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * 0.6 + 0.2,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    });
    // Draw lines between close particles
    ctx.globalAlpha = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = particles[i].color;
          ctx.globalAlpha = (1 - dist / 100) * 0.12;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Bootstrap ──────────────────────────────────────────────────
init();
