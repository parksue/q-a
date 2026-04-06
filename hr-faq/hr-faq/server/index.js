
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || 'HR2025';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;

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

// 노션에서 자료 전체 불러오기
app.get('/api/docs', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  }
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100 }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });

    const docs = data.results.map(page => ({
      id: page.id,
      name: page.properties['제목']?.title?.[0]?.plain_text || '제목 없음',
      content: page.properties['내용']?.rich_text?.[0]?.plain_text || '',
      type: page.properties['파일타입']?.rich_text?.[0]?.plain_text || 'txt',
      date: page.properties['등록일']?.date?.start || '',
    }));
    res.json({ docs });
  } catch (err) {
    console.error('노션 불러오기 오류:', err);
    res.status(500).json({ error: '노션에서 자료를 불러오지 못했어요.' });
  }
});

// 노션에 자료 저장
app.post('/api/docs', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  }
  const { name, content, type } = req.body;
  if (!name || !content) return res.status(400).json({ error: '제목과 내용이 필요해요.' });

  // 노션 rich_text는 2000자 제한 → 초과 시 자름
  const truncated = content.length > 2000 ? content.slice(0, 2000) : content;

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: {
          '제목': { title: [{ text: { content: name } }] },
          '내용': { rich_text: [{ text: { content: truncated } }] },
          '파일타입': { rich_text: [{ text: { content: type || 'txt' } }] },
          '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('노션 저장 오류:', err);
    res.status(500).json({ error: '노션에 저장하지 못했어요.' });
  }
});

// 노션에서 자료 삭제 (아카이브)
app.delete('/api/docs/:id', async (req, res) => {
  if (!NOTION_TOKEN) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${req.params.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archived: true }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ ok: true });
  } catch (err) {
    console.error('노션 삭제 오류:', err);
    res.status(500).json({ error: '노션에서 삭제하지 못했어요.' });
  }
});

// AI 답변 (Groq)
app.post('/api/chat', async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY가 설정되지 않았어요.' });
  }
  const { messages, systemPrompt } = req.body;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || '오류가 발생했어요.' });
    res.json({ reply: data.choices?.[0]?.message?.content || '답변을 가져올 수 없어요.' });
  } catch (err) {
    console.error('Groq API 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`HR FAQ 서버 실행 중: http://localhost:${PORT}`);
});
