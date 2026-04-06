# HR 도우미 - Render 배포 가이드

## 📁 폴더 구조
```
hr-faq/
├── public/
│   └── index.html        ← 프론트엔드
├── server/
│   └── index.js          ← 백엔드 (Express)
├── package.json
├── .gitignore
└── README.md
```

---

## 🚀 배포 방법 (Render 기준)

### 1단계 — GitHub에 올리기
1. https://github.com 접속 → 새 저장소(Repository) 만들기
2. 이 폴더 전체를 GitHub에 업로드

```bash
git init
git add .
git commit -m "HR FAQ 초기 배포"
git remote add origin https://github.com/내계정/hr-faq.git
git push -u origin main
```

### 2단계 — Render에 배포하기
1. https://render.com 접속 → 회원가입 (GitHub 계정으로 로그인)
2. **New +** → **Web Service** 클릭
3. GitHub 저장소 연결
4. 설정값 입력:
   - **Name**: hr-faq (원하는 이름)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. **Environment Variables** (환경변수) 추가:
   - `ANTHROPIC_API_KEY` = (Anthropic API 키 입력)
   - `ADMIN_CODE` = (원하는 관리자 코드 입력, 기본값: HR2025)
6. **Create Web Service** 클릭

### 3단계 — 완료!
- 배포 완료되면 `https://hr-faq-xxxx.onrender.com` 형태의 URL이 생겨요
- 이 URL을 직원들에게 공유하면 바로 사용 가능

---

## 🔑 Anthropic API 키 발급
1. https://console.anthropic.com 접속
2. **API Keys** → **Create Key**
3. 발급된 키를 Render 환경변수에 입력

---

## ⚙️ 환경변수 정리
| 변수명 | 설명 | 예시 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 (필수) | sk-ant-... |
| `ADMIN_CODE` | 관리자 코드 (선택, 기본: HR2025) | MyCompany2025 |
| `PORT` | 서버 포트 (Render 자동 설정) | 3000 |

---

## 📌 참고사항
- Render 무료 플랜은 15분 비활성 시 서버가 잠들어요 (첫 요청이 30초 정도 느릴 수 있음)
- 항상 켜두려면 Render Starter 플랜 ($7/월) 사용
- 등록된 자료는 서버 재시작 시 초기화돼요 (영구 저장하려면 DB 연동 필요)
