const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || 'HR2025';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const DOORAY_TOKEN = process.env.DOORAY_TOKEN;
const DOORAY_WIKI_ID = process.env.DOORAY_WIKI_ID;
const DOORAY_DOMAIN = process.env.DOORAY_DOMAIN || 'joinshr';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// 관리자 코드 검증
app.post('/api/verify-admin', (req, res) => {
  const { code } = req.body;
  if (code === ADMIN_CODE) res.json({ ok: true });
  else res.status(401).json({ ok: false, message: '관리자 코드가 올바르지 않아요.' });
});

// 노션 자료 불러오기
app.get('/api/docs', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
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
      doorayId: page.properties['두레이ID']?.rich_text?.[0]?.plain_text || '',
    }));
    res.json({ docs });
  } catch (err) {
    console.error('노션 불러오기 오류:', err);
    res.status(500).json({ error: '노션에서 자료를 불러오지 못했어요.' });
  }
});

// 노션에 자료 저장
app.post('/api/docs', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  const { name, content, type, doorayId } = req.body;
  if (!name || !content) return res.status(400).json({ error: '제목과 내용이 필요해요.' });
  const truncated = content.length > 2000 ? content.slice(0, 2000) : content;
  try {
    const props = {
      '제목': { title: [{ text: { content: name } }] },
      '내용': { rich_text: [{ text: { content: truncated } }] },
      '파일타입': { rich_text: [{ text: { content: type || 'txt' } }] },
      '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
    };
    if (doorayId) props['두레이ID'] = { rich_text: [{ text: { content: String(doorayId) } }] };

    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: { database_id: NOTION_DB_ID }, properties: props }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('노션 저장 오류:', err);
    res.status(500).json({ error: '노션에 저장하지 못했어요.' });
  }
});

// 노션 자료 삭제
app.delete('/api/docs/:id', async (req, res) => {
  if (!NOTION_TOKEN) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${req.params.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '노션에서 삭제하지 못했어요.' });
  }
});

// 두레이 위키 동기화
app.post('/api/sync-dooray', async (req, res) => {
  if (!DOORAY_TOKEN || !DOORAY_WIKI_ID) return res.status(500).json({ error: '두레이 환경변수가 설정되지 않았어요.' });
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });

  try {
    // 1. 두레이 위키 전체 페이지 목록 가져오기
    const wikiRes = await fetch(`https://api.dooray.com/wiki/v1/projects/${DOORAY_WIKI_ID}/pages?page=0&size=100`, {
      headers: { 'Authorization': `dooray-api ${DOORAY_TOKEN}` },
    });
    const wikiData = await wikiRes.json();
    if (!wikiRes.ok) return res.status(500).json({ error: '두레이 위키를 불러오지 못했어요: ' + JSON.stringify(wikiData) });

    const wikiPages = wikiData.result || [];

    // 2. 노션에 이미 등록된 두레이ID 목록 가져오기
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 }),
    });
    const notionData = await notionRes.json();
    const existingIds = new Set(
      notionData.results
        .map(p => p.properties['두레이ID']?.rich_text?.[0]?.plain_text)
        .filter(Boolean)
    );

    // 3. 노션에 없는 것만 필터링
    const newPages = wikiPages.filter(p => !existingIds.has(String(p.id)));

    if (newPages.length === 0) {
      return res.json({ ok: true, added: 0, message: '새로 추가할 위키 페이지가 없어요.' });
    }

    // 4. 새 페이지 내용 가져와서 노션에 저장
    let added = 0;
    for (const page of newPages) {
      try {
        // 위키 페이지 내용 상세 조회
        const detailRes = await fetch(`https://api.dooray.com/wiki/v1/projects/${DOORAY_WIKI_ID}/pages/${page.id}`, {
          headers: { 'Authorization': `dooray-api ${DOORAY_TOKEN}` },
        });
        const detail = await detailRes.json();
        const content = detail.result?.content?.content || detail.result?.subject || '(내용 없음)';
        const title = detail.result?.subject || page.subject || '제목 없음';
        const truncated = content.length > 2000 ? content.slice(0, 2000) : content;

        await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parent: { database_id: NOTION_DB_ID },
            properties: {
              '제목': { title: [{ text: { content: title } }] },
              '내용': { rich_text: [{ text: { content: truncated } }] },
              '파일타입': { rich_text: [{ text: { content: 'dooray' } }] },
              '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
              '두레이ID': { rich_text: [{ text: { content: String(page.id) } }] },
            },
          }),
        });
        added++;
      } catch (e) {
        console.error('페이지 저장 실패:', page.id, e);
      }
    }

    res.json({ ok: true, added, total: wikiPages.length, message: `${added}개 새로 등록됐어요! (전체 ${wikiPages.length}개 중)` });
  } catch (err) {
    console.error('두레이 동기화 오류:', err);
    res.status(500).json({ error: '동기화 중 오류가 발생했어요: ' + err.message });
  }
});

// AI 답변 (Groq)
app.post('/api/chat', async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY가 설정되지 않았어요.' });
  const { messages, systemPrompt } = req.body;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || '오류가 발생했어요.' });
    res.json({ reply: data.choices?.[0]?.message?.content || '답변을 가져올 수 없어요.' });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => console.log(`HR FAQ 서버 실행 중: http://localhost:${PORT}`));
