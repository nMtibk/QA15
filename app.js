'use strict';

/* =========================================================
   IT用語一問一答 — アプリ本体
   - パスワード入力 → Web Crypto (PBKDF2+AES-GCM) で復号
   - 章選択 → 順番出題 → 前へ/問題再表示/次へ
   - 検索・学習履歴の保存は行わない（仕様通り）
   ========================================================= */

const ENC_DATA_URL = 'questions.json';

// ---- DOM参照 ----
const lockScreen = document.getElementById('lock-screen');
const chapterScreen = document.getElementById('chapter-screen');
const quizScreen = document.getElementById('quiz-screen');

const lockForm = document.getElementById('lock-form');
const passwordInput = document.getElementById('password-input');
const unlockBtn = document.getElementById('unlock-btn');
const lockError = document.getElementById('lock-error');

const chapterListEl = document.getElementById('chapter-list');
const totalCountEl = document.getElementById('total-count');

const backToChaptersBtn = document.getElementById('back-to-chapters');
const quizChapterNameEl = document.getElementById('quiz-chapter-name');
const quizProgressEl = document.getElementById('quiz-progress');
const progressFillEl = document.getElementById('progress-fill');
const quizCard = document.getElementById('quiz-card');
const quizStateLabel = document.getElementById('quiz-state-label');
const quizTextEl = document.getElementById('quiz-text');
const btnPrev = document.getElementById('btn-prev');
const btnRedisplay = document.getElementById('btn-redisplay');
const btnNext = document.getElementById('btn-next');

// ---- アプリ状態 ----
/** @type {{id:number, chapter:number, chapterName:string, question:string, answer:string}[]} */
let ALL_QUESTIONS = [];
let chapters = []; // [{chapter, chapterName, count}]
let currentChapterQuestions = [];
let currentIndex = 0;
let revealed = false;

// =========================================================
// Base64 <-> ArrayBuffer ヘルパー
// =========================================================
function base64ToBytes(base64) {
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

// =========================================================
// 復号処理
// =========================================================
async function decryptQuestions(password) {
  const res = await fetch(ENC_DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('データファイルを取得できませんでした');
  const enc = await res.json();

  const salt = base64ToBytes(enc.salt);
  const iv = base64ToBytes(enc.iv);
  const ciphertext = base64ToBytes(enc.ciphertext);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: enc.iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // パスワードが間違っていればここで例外が発生する（正誤判定を兼ねる）
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const json = new TextDecoder().decode(plainBuf);
  return JSON.parse(json);
}

// =========================================================
// ロック画面
// =========================================================
lockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = passwordInput.value;
  if (!password) return;

  lockError.hidden = true;
  unlockBtn.disabled = true;
  unlockBtn.querySelector('.btn-label').textContent = '確認中…';

  try {
    const questions = await decryptQuestions(password);
    ALL_QUESTIONS = questions;
    buildChapterIndex();
    renderChapterList();
    showScreen('chapters');
    passwordInput.value = '';
  } catch (err) {
    console.error(err);
    lockError.hidden = false;
    passwordInput.select();
  } finally {
    unlockBtn.disabled = false;
    unlockBtn.querySelector('.btn-label').textContent = '開く';
  }
});

// =========================================================
// 画面切り替え
// =========================================================
function showScreen(name) {
  lockScreen.hidden = name !== 'lock';
  chapterScreen.hidden = name !== 'chapters';
  quizScreen.hidden = name !== 'quiz';
}

// =========================================================
// 章一覧の構築・表示
// =========================================================
function buildChapterIndex() {
  const map = new Map();
  for (const q of ALL_QUESTIONS) {
    if (!map.has(q.chapter)) {
      map.set(q.chapter, { chapter: q.chapter, chapterName: q.chapterName, count: 0 });
    }
    map.get(q.chapter).count++;
  }
  chapters = Array.from(map.values()).sort((a, b) => a.chapter - b.chapter);
  totalCountEl.textContent = `全${ALL_QUESTIONS.length}問 / 全${chapters.length}章`;
}

function renderChapterList() {
  chapterListEl.innerHTML = '';
  for (const ch of chapters) {
    const btn = document.createElement('button');
    btn.className = 'chapter-row';
    btn.innerHTML = `
      <span class="chapter-num">${ch.chapter}</span>
      <span class="chapter-info">
        <p class="chapter-name">${escapeHtml(ch.chapterName)}</p>
        <p class="chapter-count">全${ch.count}問</p>
      </span>
      <span class="chapter-arrow">›</span>
    `;
    btn.addEventListener('click', () => openChapter(ch.chapter));
    chapterListEl.appendChild(btn);
  }
}

function openChapter(chapterNum) {
  currentChapterQuestions = ALL_QUESTIONS.filter((q) => q.chapter === chapterNum).sort(
    (a, b) => a.id - b.id
  );
  currentIndex = 0;
  revealed = false;
  quizChapterNameEl.textContent =
    currentChapterQuestions[0]?.chapterName || `第${chapterNum}章`;
  showScreen('quiz');
  renderQuestion();
}

backToChaptersBtn.addEventListener('click', () => showScreen('chapters'));

// =========================================================
// 出題ロジック
// =========================================================
function renderQuestion() {
  const q = currentChapterQuestions[currentIndex];
  if (!q) return;

  quizProgressEl.textContent = `${currentIndex + 1} / ${currentChapterQuestions.length}`;
  progressFillEl.style.width = `${((currentIndex + 1) / currentChapterQuestions.length) * 100}%`;

  btnPrev.disabled = currentIndex === 0;
  btnNext.disabled = currentIndex === currentChapterQuestions.length - 1;

  revealed = false;
  paintCard(q);
}

function paintCard(q) {
  if (!revealed) {
    quizStateLabel.textContent = 'タップして解答を表示';
    quizStateLabel.classList.remove('is-answer');
    quizTextEl.innerHTML = renderQuestionHtml(q.question);
  } else {
    quizStateLabel.textContent = '解答';
    quizStateLabel.classList.add('is-answer');
    quizTextEl.innerHTML = renderAnswerHtml(q.answer);
  }
}

// ❓の連続をタップ可能な「めくり」表示に変換
function renderQuestionHtml(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/❓+/g, (match) => `<span class="blank">${match}</span>`);
}

function renderAnswerHtml(text) {
  return `<span class="answer-fill">${escapeHtml(text)}</span>`;
}

function toggleReveal() {
  revealed = !revealed;
  const q = currentChapterQuestions[currentIndex];
  paintCard(q);
}

quizCard.addEventListener('click', toggleReveal);

btnPrev.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
  }
});

btnNext.addEventListener('click', () => {
  if (currentIndex < currentChapterQuestions.length - 1) {
    currentIndex++;
    renderQuestion();
  }
});

// 「問題再表示」: 解答を隠してもう一度問題文を見る（前後には移動しない）
btnRedisplay.addEventListener('click', () => {
  revealed = false;
  paintCard(currentChapterQuestions[currentIndex]);
});

// =========================================================
// ユーティリティ
// =========================================================
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =========================================================
// Service Worker 登録（オフライン対応）
// =========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// 初期表示
showScreen('lock');
passwordInput.focus();
