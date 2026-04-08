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
const DOORAY_PROJECT_ID = process.env.DOORAY_PROJECT_ID || '3371819751780048783';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.post('/api/verify-admin', (req, res) => {
  const { code } = req.body;
  if (code === ADMIN_CODE) res.json({ ok: true });
  else res.status(401).json({ ok: false, message: '관리자 코드가 올바르지 않아요.' });
});

app.get('/api/docs', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    const response = await fetch('https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
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
      link: page.properties['링크']?.url || '',
      category: page.properties['카테고리']?.rich_text?.[0]?.plain_text || '기타',
      comments: page.properties['댓글']?.rich_text?.[0]?.plain_text || '',
      hasAttachment: page.properties['첨부파일여부']?.rich_text?.[0]?.plain_text === 'true',
    }));
    res.json({ docs });
  } catch (err) {
    console.error('노션 불러오기 오류:', err);
    res.status(500).json({ error: '노션에서 자료를 불러오지 못했어요.' });
  }
});

app.post('/api/docs', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  const { name, content, type, doorayId, link, category, comments, hasAttachment } = req.body;
  if (!name || !content) return res.status(400).json({ error: '제목과 내용이 필요해요.' });
  const truncated = content.length > 2000 ? content.slice(0, 2000) : content;
  const commentsTruncated = comments && comments.length > 1000 ? comments.slice(0, 1000) : (comments || '');
  try {
    const props = {
      '제목': { title: [{ text: { content: name } }] },
      '내용': { rich_text: [{ text: { content: truncated } }] },
      '파일타입': { rich_text: [{ text: { content: type || 'txt' } }] },
      '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
      '카테고리': { rich_text: [{ text: { content: category || '기타' } }] },
    };
    if (doorayId) props['두레이ID'] = { rich_text: [{ text: { content: String(doorayId) } }] };
    if (link) props['링크'] = { url: link };
    if (commentsTruncated) props['댓글'] = { rich_text: [{ text: { content: commentsTruncated } }] };
    if (hasAttachment !== undefined) props['첨부파일여부'] = { rich_text: [{ text: { content: String(hasAttachment) } }] };
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
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

app.delete('/api/docs/:id', async (req, res) => {
  if (!NOTION_TOKEN) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    const response = await fetch('https://api.notion.com/v1/pages/' + req.params.id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '노션에서 삭제하지 못했어요.' });
  }
});

async function getComments(type, projectId, pageId, token) {
  try {
    const url = type === 'wiki'
      ? 'https://api.dooray.com/wiki/v1/wikis/' + projectId + '/pages/' + pageId + '/comments?page=0&size=20'
      : 'https://api.dooray.com/project/v1/projects/' + projectId + '/posts/' + pageId + '/logs?page=0&size=20';
    const r = await fetch(url, { headers: { 'Authorization': 'dooray-api ' + token } });
    const data = await r.json();
    return (data.result || []).map(function(c) { return c.body && c.body.content ? c.body.content : ''; }).filter(Boolean).join('\n');
  } catch (e) {
    return '';
  }
}

async function saveToNotion(props, token, dbId) {
  return fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
  });
}

app.post('/api/sync-dooray', async (req, res) => {
  if (!DOORAY_TOKEN || !DOORAY_WIKI_ID) return res.status(500).json({ error: '두레이 위키 환경변수가 설정되지 않았어요.' });
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    async function fetchAllPages(parentId) {
      const url = parentId
        ? 'https://api.dooray.com/wiki/v1/wikis/' + DOORAY_WIKI_ID + '/pages?parentPageId=' + parentId + '&page=0&size=100'
        : 'https://api.dooray.com/wiki/v1/wikis/' + DOORAY_WIKI_ID + '/pages?page=0&size=100';
      const r = await fetch(url, { headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN } });
      const data = await r.json();
      const pages = data.result || [];
      let all = pages.slice();
      for (let i = 0; i < pages.length; i++) {
        const children = await fetchAllPages(pages[i].id);
        all = all.concat(children);
      }
      return all;
    }
    const wikiPages = await fetchAllPages(null);
    const notionRes = await fetch('https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 }),
    });
    const notionData = await notionRes.json();
    const existingIds = new Set(notionData.results.map(function(p) { return p.properties['두레이ID'] && p.properties['두레이ID'].rich_text[0] ? p.properties['두레이ID'].rich_text[0].plain_text : ''; }).filter(Boolean));
    const newPages = wikiPages.filter(function(p) { return !existingIds.has(String(p.id)); });
    if (newPages.length === 0) return res.json({ ok: true, added: 0, message: '새로 추가할 위키 페이지가 없어요.' });
    let added = 0;
    for (let i = 0; i < newPages.length; i++) {
      const page = newPages[i];
      try {
        const detailRes = await fetch('https://api.dooray.com/wiki/v1/wikis/' + DOORAY_WIKI_ID + '/pages/' + page.id, { headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN } });
        const detail = await detailRes.json();
        const r = detail.result || {};
        const title = r.subject || page.subject || '제목 없음';
        // 두레이 위키 내용 필드 - 여러 경로 시도
        var rawContent = '';
        if (r.content && r.content.content) rawContent = r.content.content;
        else if (r.body && r.body.content) rawContent = r.body.content;
        else if (r.contents && r.contents.content) rawContent = r.contents.content;
        else if (r.content && typeof r.content === 'string') rawContent = r.content;
        // 마크다운 이미지/태그 제거해서 텍스트만 추출
        var content = rawContent
          .replace(/!\[.*?\]\(.*?\)/g, '[이미지]')
          .replace(/<[^>]+>/g, '')
          .replace(/\*\*/g, '')
          .replace(/#{1,6}\s/g, '')
          .trim() || title;
        const comments = await getComments('wiki', DOORAY_WIKI_ID, page.id, DOORAY_TOKEN);
        const wikiLink = 'https://' + DOORAY_DOMAIN + '.dooray.com/wiki/' + '3484734520773902115' + '/' + page.id;
        const props = {
          '제목': { title: [{ text: { content: title } }] },
          '내용': { rich_text: [{ text: { content: content.length > 2000 ? content.slice(0, 2000) : content } }] },
          '파일타입': { rich_text: [{ text: { content: 'dooray' } }] },
          '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
          '두레이ID': { rich_text: [{ text: { content: String(page.id) } }] },
          '링크': { url: wikiLink },
          '카테고리': { rich_text: [{ text: { content: '프로그램' } }] },
        };
        if (comments) props['댓글'] = { rich_text: [{ text: { content: comments.length > 1000 ? comments.slice(0, 1000) : comments } }] };
        if (comments) props['첨부파일여부'] = { rich_text: [{ text: { content: 'true' } }] };
        await saveToNotion(props, NOTION_TOKEN, NOTION_DB_ID);
        added++;
      } catch (e) {
        console.error('위키 페이지 저장 실패:', page.id, e.message);
      }
    }
    res.json({ ok: true, added: added, total: wikiPages.length, message: added + '개 새로 등록됐어요! (전체 ' + wikiPages.length + '개 중)' });
  } catch (err) {
    console.error('두레이 동기화 오류:', err);
    res.status(500).json({ error: '동기화 중 오류가 발생했어요: ' + err.message });
  }
});

app.post('/api/sync-dooray-project', async (req, res) => {
  if (!DOORAY_TOKEN || !DOORAY_PROJECT_ID) return res.status(500).json({ error: '두레이 프로젝트 환경변수가 설정되지 않았어요.' });
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  try {
    const postsRes = await fetch('https://api.dooray.com/project/v1/projects/' + DOORAY_PROJECT_ID + '/posts?page=0&size=100&order=-createdAt', {
      headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN },
    });
    const postsData = await postsRes.json();
    if (!postsRes.ok || !postsData.result) return res.status(500).json({ error: '프로젝트 게시글을 불러오지 못했어요: ' + JSON.stringify(postsData) });
    const posts = postsData.result || [];
    const notionRes = await fetch('https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 }),
    });
    const notionData = await notionRes.json();
    const existingIds = new Set(notionData.results.map(function(p) { return p.properties['두레이ID'] && p.properties['두레이ID'].rich_text[0] ? p.properties['두레이ID'].rich_text[0].plain_text : ''; }).filter(Boolean));
    const newPosts = posts.filter(function(p) { return !existingIds.has(String(p.id)); });
    if (newPosts.length === 0) return res.json({ ok: true, added: 0, message: '새로 추가할 게시글이 없어요.' });
    let added = 0;
    for (let i = 0; i < newPosts.length; i++) {
      const post = newPosts[i];
      try {
        const title = post.subject || '제목 없음';
        const content = (post.body && post.body.content) ? post.body.content : (post.subject || '(내용 없음)');
        const comments = await getComments('project', DOORAY_PROJECT_ID, post.id, DOORAY_TOKEN);
        const postLink = 'https://' + DOORAY_DOMAIN + '.dooray.com/task/' + DOORAY_PROJECT_ID + '/' + post.id;
        const props = {
          '제목': { title: [{ text: { content: title } }] },
          '내용': { rich_text: [{ text: { content: content.length > 2000 ? content.slice(0, 2000) : content } }] },
          '파일타입': { rich_text: [{ text: { content: 'dooray' } }] },
          '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
          '두레이ID': { rich_text: [{ text: { content: String(post.id) } }] },
          '링크': { url: postLink },
          '카테고리': { rich_text: [{ text: { content: '프로그램' } }] },
        };
        if (comments) props['댓글'] = { rich_text: [{ text: { content: comments.length > 1000 ? comments.slice(0, 1000) : comments } }] };
        if (comments) props['첨부파일여부'] = { rich_text: [{ text: { content: 'true' } }] };
        await saveToNotion(props, NOTION_TOKEN, NOTION_DB_ID);
        added++;
      } catch (e) {
        console.error('게시글 저장 실패:', post.id, e.message);
      }
    }
    res.json({ ok: true, added: added, total: posts.length, message: added + '개 새로 등록됐어요! (전체 ' + posts.length + '개 중)' });
  } catch (err) {
    console.error('프로젝트 동기화 오류:', err);
    res.status(500).json({ error: '동기화 중 오류가 발생했어요: ' + err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY가 설정되지 않았어요.' });
  const { messages, docs, question } = req.body;

  // 서버에서 관련 자료 필터링 + 토큰 제한
  let docContext = '';
  if (docs && docs.length > 0 && question) {
    const qWords = question.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 1; });
    let related = docs.filter(function(d) {
      const txt = ((d.name || '') + ' ' + (d.content || '') + ' ' + (d.category || '')).toLowerCase();
      return qWords.some(function(w) { return txt.includes(w); });
    });
    if (related.length === 0) related = docs.slice(0, 2);
    else related = related.slice(0, 3);

    docContext = related.map(function(d) {
      var line = '[ ' + (d.name || '') + ' / ' + (d.category || '') + ' ]';
      var body = (d.content || '').slice(0, 150);
      var link = d.link ? ' 링크:' + d.link : '';
      return line + ' ' + body + link;
    }).join(' | ');
  }

  // 키워드 매칭으로 유사 자료 찾기 (AI 아님)
  var similarDoc = null;
  if (docs && docs.length > 0 && question) {
    var qWords = question.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 1; });
    var scored = docs.map(function(d) {
      var txt = ((d.name || '') + ' ' + (d.content || '') + ' ' + (d.comments || '')).toLowerCase();
      var score = qWords.reduce(function(acc, w) { return acc + (txt.indexOf(w) !== -1 ? 1 : 0); }, 0);
      return { doc: d, score: score };
    }).filter(function(x) { return x.score > 0; })
      .sort(function(a, b) { return b.score - a.score; });
    if (scored.length > 0 && scored[0].score >= 1) similarDoc = scored[0].doc;
  }

  var sysBase = docContext
    ? '당신은 회사 내부 HR 도우미입니다.' +
      '규칙1: 반드시 순수한 한국어로만 답변하세요. 한자, 일본어, 중국어, 영어 단어를 절대 사용하지 마세요.' +
      '규칙2: 아래 참고자료에 있는 내용만 답변하세요. 참고자료에 질문과 관련된 내용이 없으면 반드시 "등록되지 않은 내용입니다. 추가가 필요한 경우 클라우드관리팀에 문의하세요." 이 문장만 답변하고 절대 다른 말을 추가하지 마세요. 절대 링크나 URL을 답변에 포함하지 마세요.' +
      '규칙3: 답변은 3문장 이내로 간결하게 작성하세요.' +
      ' 참고자료: ' + docContext
    : '모든 질문에 "등록되지 않은 내용입니다. 추가가 필요한 경우 클라우드관리팀에 문의하세요." 이 문장만 답변하세요. 절대 다른 말 추가하지 마세요.';
  var systemPrompt = sysBase;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        messages: [{ role: 'system', content: systemPrompt }].concat(messages.slice(-4)),
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: (data.error && data.error.message) || '오류가 발생했어요.' });
    var reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '답변을 가져올 수 없어요.';
    // 등록되지 않은 내용일 때 유사 자료 키워드 매칭으로 추천
    if (reply.indexOf('등록되지 않은') !== -1 && similarDoc) {
      reply = reply + ' 혹시 이런 내용을 찾으시나요? [' + similarDoc.name + ']';
    }
    res.json({ reply: reply, similarDoc: similarDoc ? { name: similarDoc.name, link: similarDoc.link } : null });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 두레이 단일 링크 가져오기
app.post('/api/import-dooray-url', async (req, res) => {
  if (!DOORAY_TOKEN) return res.status(500).json({ error: '두레이 환경변수가 설정되지 않았어요.' });
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });

  var url = req.body.url || '';
  var category = req.body.category || '기타';

  var wikiMatch = url.match(/\/wiki\/(\d+)\/(\d+)/);
  var taskMatch = url.match(/\/task\/(\d+)\/(\d+)/);

  if (!wikiMatch && !taskMatch) {
    return res.status(400).json({ error: '올바른 두레이 링크가 아니에요. 위키 또는 프로젝트 링크를 입력해주세요.' });
  }

  try {
    var title, pageContent, comments, doorayId;

    // 노션 기존 ID 목록
    var notionRes = await fetch('https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 }),
    });
    var notionData = await notionRes.json();

    if (wikiMatch) {
      var pageId = wikiMatch[2];
      doorayId = pageId;
      var exists = notionData.results.some(function(p) {
        return p.properties['두레이ID'] && p.properties['두레이ID'].rich_text[0] && p.properties['두레이ID'].rich_text[0].plain_text === pageId;
      });
      if (exists) return res.json({ ok: false, message: '이미 등록된 자료예요.' });

      var detailRes = await fetch('https://api.dooray.com/wiki/v1/wikis/' + DOORAY_WIKI_ID + '/pages/' + pageId, {
        headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN }
      });
      var detail = await detailRes.json();
      var r = detail.result || {};
      title = r.subject || '제목 없음';
      var raw = (r.content && r.content.content) ? r.content.content : ((r.body && r.body.content) ? r.body.content : title);
      pageContent = raw.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim() || title;

      var commentRes = await fetch('https://api.dooray.com/wiki/v1/wikis/' + DOORAY_WIKI_ID + '/pages/' + pageId + '/comments?page=0&size=20', {
        headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN }
      });
      var commentData = await commentRes.json();
      comments = (commentData.result || []).map(function(c) { return c.body && c.body.content ? c.body.content : ''; }).filter(Boolean).join(' ');

    } else {
      var projId = taskMatch[1];
      var postId = taskMatch[2];
      doorayId = postId;
      var exists2 = notionData.results.some(function(p) {
        return p.properties['두레이ID'] && p.properties['두레이ID'].rich_text[0] && p.properties['두레이ID'].rich_text[0].plain_text === postId;
      });
      if (exists2) return res.json({ ok: false, message: '이미 등록된 자료예요.' });

      var postRes = await fetch('https://api.dooray.com/project/v1/projects/' + projId + '/posts/' + postId, {
        headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN }
      });
      var postData = await postRes.json();
      var post = postData.result || {};
      title = post.subject || '제목 없음';
      pageContent = (post.body && post.body.content) ? post.body.content : title;

      var logRes = await fetch('https://api.dooray.com/project/v1/projects/' + projId + '/posts/' + postId + '/logs?page=0&size=20', {
        headers: { 'Authorization': 'dooray-api ' + DOORAY_TOKEN }
      });
      var logData = await logRes.json();
      comments = (logData.result || []).map(function(c) { return c.body && c.body.content ? c.body.content : ''; }).filter(Boolean).join(' ');
    }

    var truncContent = pageContent.length > 2000 ? pageContent.slice(0, 2000) : pageContent;
    var truncComments = comments && comments.length > 1000 ? comments.slice(0, 1000) : (comments || '');

    var props = {
      '제목': { title: [{ text: { content: title } }] },
      '내용': { rich_text: [{ text: { content: truncContent } }] },
      '파일타입': { rich_text: [{ text: { content: 'dooray' } }] },
      '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
      '두레이ID': { rich_text: [{ text: { content: String(doorayId) } }] },
      '링크': { url: url },
      '카테고리': { rich_text: [{ text: { content: category } }] },
    };
    if (truncComments) props['댓글'] = { rich_text: [{ text: { content: truncComments } }] };
    if (truncComments) props['첨부파일여부'] = { rich_text: [{ text: { content: 'true' } }] };

    await saveToNotion(props, NOTION_TOKEN, NOTION_DB_ID);
    res.json({ ok: true, message: '"' + title + '" 등록됐어요!' });
  } catch (err) {
    console.error('두레이 URL 가져오기 오류:', err);
    res.status(500).json({ error: '가져오기 실패: ' + err.message });
  }
});


// PDF/이미지 분석 후 노션 저장
app.post('/api/analyze-file', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 없어요. Render 환경변수에 추가해주세요.' });

  var { base64, mimeType, fileName, category } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: '파일 데이터가 없어요.' });

  try {
    var isImage = mimeType.startsWith('image/');
    var isPdf = mimeType === 'application/pdf';

    if (!isImage && !isPdf) return res.status(400).json({ error: 'PDF 또는 이미지 파일만 지원해요.' });

    // Claude API로 내용 분석
    var msgContent = isImage
      ? [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }, { type: 'text', text: '이 이미지의 내용을 분석해서 한국어로 제목과 내용을 정리해주세요. 응답 형식: {"title": "제목", "content": "내용 요약"}' }]
      : [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }, { type: 'text', text: '이 PDF 문서의 내용을 분석해서 한국어로 제목과 내용을 정리해주세요. 응답 형식: {"title": "제목", "content": "내용 요약 (최대 1500자)"}' }];

    var claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: msgContent }] })
    });
    var claudeData = await claudeRes.json();
    var text = claudeData.content && claudeData.content[0] ? claudeData.content[0].text : '';

    // JSON 파싱
    var parsed = { title: fileName || '분석 자료', content: text };
    try {
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) { var j = JSON.parse(jsonMatch[0]); parsed.title = j.title || parsed.title; parsed.content = j.content || text; }
    } catch(e) { parsed.content = text; }

    // 노션에 저장
    var truncContent = parsed.content.length > 2000 ? parsed.content.slice(0, 2000) : parsed.content;
    var props = {
      '제목': { title: [{ text: { content: parsed.title } }] },
      '내용': { rich_text: [{ text: { content: truncContent } }] },
      '파일타입': { rich_text: [{ text: { content: isImage ? 'image' : 'pdf' } }] },
      '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
      '카테고리': { rich_text: [{ text: { content: category || '기타' } }] },
    };
    await saveToNotion(props, NOTION_TOKEN, NOTION_DB_ID);
    res.json({ ok: true, title: parsed.title, content: parsed.content, message: '"' + parsed.title + '" 등록됐어요!' });
  } catch (err) {
    console.error('파일 분석 오류:', err);
    res.status(500).json({ error: '파일 분석 실패: ' + err.message });
  }
});

app.listen(PORT, function() { console.log('HR FAQ 서버 실행 중: http://localhost:' + PORT); });

// PDF/이미지 → AI로 내용 추출 후 노션 저장
app.post('/api/extract-and-save', async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(500).json({ error: '노션 환경변수가 설정되지 않았어요.' });

  var fileData = req.body.fileData; // base64
  var fileName = req.body.fileName || '파일';
  var fileType = req.body.fileType || 'application/pdf'; // MIME type
  var category = req.body.category || '기타';

  if (!fileData) return res.status(400).json({ error: '파일 데이터가 없어요.' });

  try {
    // Anthropic API로 PDF/이미지 내용 추출
    var messages;
    if (fileType === 'application/pdf') {
      messages = [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } },
          { type: 'text', text: '이 PDF 문서의 내용을 읽고 다음 형식으로 답변해주세요:\n제목: (문서의 핵심 제목 1줄)\n내용: (핵심 내용 요약, 500자 이내)\n반드시 한국어로만 답변하세요.' }
        ]
      }];
    } else {
      messages = [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } },
          { type: 'text', text: '이 이미지의 내용을 읽고 다음 형식으로 답변해주세요:\n제목: (이미지의 핵심 제목 1줄)\n내용: (핵심 내용 요약, 500자 이내)\n반드시 한국어로만 답변하세요.' }
        ]
      }];
    }

    var aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: messages })
    });
    var aiData = await aiRes.json();
    if (!aiRes.ok) return res.status(500).json({ error: 'AI 추출 실패: ' + (aiData.error && aiData.error.message) });

    var text = (aiData.content && aiData.content[0] && aiData.content[0].text) || '';

    // 제목/내용 파싱
    var titleMatch = text.match(/제목:\s*(.+)/);
    var contentMatch = text.match(/내용:\s*([\s\S]+)/);
    var title = titleMatch ? titleMatch[1].trim() : fileName;
    var extractedContent = contentMatch ? contentMatch[1].trim() : text;

    var truncContent = extractedContent.length > 2000 ? extractedContent.slice(0, 2000) : extractedContent;

    var props = {
      '제목': { title: [{ text: { content: title } }] },
      '내용': { rich_text: [{ text: { content: truncContent } }] },
      '파일타입': { rich_text: [{ text: { content: fileType.includes('pdf') ? 'pdf' : 'image' } }] },
      '등록일': { date: { start: new Date().toISOString().slice(0, 10) } },
      '카테고리': { rich_text: [{ text: { content: category } }] },
    };

    // dryRun이면 노션 저장 안 하고 미리보기만 반환
    if (req.body.dryRun) {
      return res.json({ ok: true, title: title, fullContent: extractedContent, message: '분석 완료!' });
    }
    await saveToNotion(props, NOTION_TOKEN, NOTION_DB_ID);
    res.json({ ok: true, title: title, fullContent: extractedContent, message: '"' + title + '" 등록됐어요!' });
  } catch (err) {
    console.error('파일 추출 오류:', err);
    res.status(500).json({ error: '추출 실패: ' + err.message });
  }
});
