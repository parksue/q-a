const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || 'HR2025';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// 관리자 코드 검증
app.post('/api/verify-admin', (req, res) => {
  const { code } = req.body;
  if (code === ADMIN_CODE) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, message: '관리자 코드가 올바르지 않아요.' });
  }
});

// AI 답변 프록시
app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았어요. Render 환경변수를 확인해 주세요.' });
  }

  const { messages, systemPrompt } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || '오류가 발생했어요.' });
    }

    res.json({ reply: data.content?.[0]?.text || '답변을 가져올 수 없어요.' });
  } catch (err) {
    console.error('Anthropic API 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
});

// 모든 경로는 index.html로
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`HR FAQ 서버 실행 중: http://localhost:${PORT}`);
});
