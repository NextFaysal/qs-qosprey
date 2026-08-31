# Limited-Stock Product Auto-Purchase Automation System
### Full Technical Specification (Next.js + Prisma)

---

## 1. System Overview

একটা multi-user web platform যেখানে প্রতিটা user নির্দিষ্ট একটা limited-stock product-এর জন্য **"campaign"** তৈরি করতে পারবে। প্রতিটা campaign-এ থাকবে product খোঁজার শর্ত (bins, price range, base ID) এবং একটা publish time। Publish time-এর ঠিক আগ মুহূর্ত থেকে সিস্টেম automatically external API poll করবে, product স্টকে আসামাত্র সেটা কার্টে অ্যাড করে ফেলবে (buy সম্পন্ন করবে) — user manual intervention ছাড়াই।

**মূল চ্যালেঞ্জ:** এটা শুধু একটা CRUD app না — এটা একটা **precise-timing background job / polling engine**, যেটা Next.js API routes দিয়ে সরাসরি চালানো যাবে না (serverless/route handler-এর execution timeout limit থাকে)। তাই এই সিস্টেমে একটা **আলাদা persistent worker/queue layer** লাগবে।

---

## 2. Tech Stack

| Layer | Technology | কেন |
|---|---|---|
| Frontend + API | Next.js (App Router) | UI + REST/Server Actions |
| ORM | Prisma | Type-safe DB access |
| Database | PostgreSQL | Prisma-র সাথে সবচেয়ে ভালো ফিট, concurrent writes handle করতে পারবে |
| Background Jobs | **BullMQ + Redis** (চূড়ান্ত সিদ্ধান্ত) | Precise-time scheduled polling — এটা must, শুধু Next.js route দিয়ে সম্ভব না |
| Auth | NextAuth.js / Custom JWT + bcrypt | Session + role-based access |
| Realtime feedback (optional) | WebSocket / Server-Sent Events / Pusher | User-কে live campaign status দেখানোর জন্য (running, bought, failed) |

> **গুরুত্বপূর্ণ আর্কিটেকচার নোট:** Next.js নিজে থেকে "background-এ precise সময়ে polling" করতে পারে না (serverless function timeout, cold start ইত্যাদির কারণে)। তাই একটা **standalone Node.js worker process** (BullMQ worker, বা PM2 দিয়ে চালানো persistent script) থাকতে হবে যেটা database থেকে upcoming campaign গুলো পড়ে, নির্দিষ্ট সময়ে polling শুরু করে। Next.js শুধু UI + campaign data তৈরি/সম্পাদনার জন্য ব্যবহার হবে।

---

## 3. User Roles

- **User** — registration করবে, approval-এর পর dashboard access পাবে, campaign তৈরি/পরিচালনা করবে।
- **Admin** — user approve/reject করবে, default domain/API base URL সেট করবে, সব ইউজারের campaign monitor করতে পারবে (optional admin panel)।

---

## 4. Auth & Approval Flow

1. User `/register` — name, email, password → status: `PENDING`
2. Login attempt-এ `PENDING` status হলে "আপনার একাউন্ট এখনো approve হয়নি" মেসেজ দেখাবে, dashboard access ব্লক থাকবে।
3. Admin panel থেকে admin ইউজারকে `APPROVED` বা `REJECTED` করতে পারবে।
4. `APPROVED` হলেই dashboard-এ ঢুকতে পারবে এবং campaign তৈরি করতে পারবে।

---

## 5. Database Schema (Prisma)

```prisma
enum UserStatus {
  PENDING
  APPROVED
  REJECTED
}

enum UserRole {
  USER
  ADMIN
}

enum CampaignMode {
  CHECK_ONLY   // শুধু monitor করবে, বাই করবে না
  AUTO_BUY     // পেলেই সাথে সাথে কার্টে অ্যাড করবে
}

enum CampaignStatus {
  SCHEDULED   // publish time-এর অপেক্ষায়
  POLLING     // 1 মিনিট আগে থেকে active polling চলছে
  SUCCESS     // product পাওয়া গেছে + cart-এ add হয়েছে
  FAILED      // error / API fail
  EXPIRED     // অনেকক্ষণ চেষ্টার পরও product আসেনি (timeout window পার হয়েছে)
  CANCELLED   // user manually বন্ধ করেছে

}

model User {
  id            String     @id @default(cuid())
  name          String
  email         String     @unique
  password      String
  role          UserRole   @default(USER)
  status        UserStatus @default(PENDING)
  defaultDomain String?    // admin-সেট default API base URL
  apiCredential String?    // API/site auth token বা cookie (যদি লাগে) — encrypted রাখা উচিত
  campaigns     Campaign[]
  createdAt     DateTime   @default(now())
}

model Campaign {
  id            String         @id @default(cuid())
  user          User           @relation(fields: [userId], references: [id])
  userId        String

  domain        String?        // optional override, না দিলে User.defaultDomain ব্যবহার হবে
  bins          String         // e.g. "527515"
  minPrice      Float
  maxPrice      Float
  quantity      Int            // কতগুলো product কিনতে চায়
  baseId        String         // "base_id" param

  publishTime   DateTime       // যে সময়ে product আসার কথা
  mode          CampaignMode   @default(CHECK_ONLY)

  status        CampaignStatus @default(SCHEDULED)
  matchedIds    String[]       @default([]) // যেসব product id পাওয়া গেছে
  purchasedIds  String[]       @default([]) // যেসব id সফলভাবে cart-এ add হয়েছে
  lastCheckedAt DateTime?
  lastError     String?

  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}
```

---

## 6. UI Flow

### 6.1 Dashboard
- User-এর সব campaign-এর তালিকা (status badge সহ: Scheduled / Polling / Success / Failed / Expired)
- "+ Add Product Request" বাটন → popup ওপেন হবে

### 6.2 "Add Product Request" Popup — Fields

| Field | Type | Note |
|---|---|---|
| Domain / API Base URL | text (optional) | ফাঁকা রাখলে admin-এর default URL ব্যবহার হবে; user override করতে পারবে |
| Bins | text | e.g. `527515` |
| Price Range | দুইটা number input (Min, Max) | |
| Quantity | number | কতগুলো কিনতে চায় |
| Base ID | text/number | |
| Publish Time | datetime picker | |
| Mode Toggle | switch: "Check only" / "Auto Buy" | Off = শুধু চেক করবে, বাই করবে না; On = পেলেই অটো কিনে ফেলবে |

Submit করলে একটা নতুন `Campaign` row `SCHEDULED` status-এ তৈরি হবে।

---

## 7. Campaign Execution Engine (মূল লজিক)

এই অংশটা একটা **standalone worker** হিসেবে চলবে (Next.js এর বাইরে, কিন্তু একই Prisma DB শেয়ার করবে)।

### 7.1 Scheduling
- প্রতি কয়েক সেকেন্ড পরপর (বা BullMQ delayed job দিয়ে) worker চেক করবে: কোন কোন `SCHEDULED` campaign-এর `publishTime - 1 minute` এ পৌঁছে গেছে।
- সেই campaign-গুলোর status `POLLING`-এ আপডেট হবে এবং polling loop শুরু হবে।

### 7.2 Polling Loop
```
while (status === POLLING && not timed out) {
  POST {domain}/v1/goods/lists
  body: {
    page: 1,
    pageSize: 10,
    bins: campaign.bins,
    min_price: campaign.minPrice,
    max_price: campaign.maxPrice,
    base_id: campaign.baseId
  }

  if (response.data array is NOT empty) {
     matchedIds = extract product ids (up to campaign.quantity)
     -> break loop, proceed to Buy step (section 7.3)
  } else {
     wait short interval (e.g. 200ms–1s, configurable) and retry
  }
}
```
- **polling interval** টিউনেবল রাখা উচিত (খুব ঘন ঘন কল করলে API rate-limit/ban হতে পারে — এটা backend config-এ রাখুন)।
- প্রতিটা poll attempt-এর timestamp `lastCheckedAt`-এ আপডেট হবে (debugging-এর জন্য)।
- যদি নির্দিষ্ট সময় পার হয়ে যায় (যেমন publish time থেকে ৫-১০ মিনিট) এবং product না পাওয়া যায়, status `EXPIRED` করে দিন।

### 7.3 Buy Step (Add to Cart)
যদি `campaign.mode === AUTO_BUY` এবং product পাওয়া যায়:
```
ids = matchedIds.slice(0, campaign.quantity).join(",")

POST {domain}/v1/goods/addCart
body: { "id": ids }   // e.g. "11886815,11886816"
```
Response check করবে:
```json
{ "ResCode": 1, "MessageText": "Operation completed!", "TimeStamp": "1788108338", "ResData": null }
```
- `ResCode === 1` → status `SUCCESS`, `purchasedIds` সেভ করুন।
- অন্য কোনো `ResCode` বা error → status `FAILED`, `lastError` ফিল্ডে reason সেভ করুন, এবং (optionally) retry logic চালু করুন।

যদি `campaign.mode === CHECK_ONLY`:
- product পাওয়া গেলে শুধু `matchedIds` সেভ করবে এবং status `SUCCESS` (বা একটা আলাদা status যেমন `FOUND`) করে দেবে — কিন্তু `addCart` কল হবে না। User dashboard থেকে দেখতে পারবে এবং চাইলে manual trigger দিয়ে buy করতে পারবে (optional feature)।

---

## 8. Error Handling & Resilience

- API timeout/network error হলে retry (exponential backoff না — এখানে speed critical, তাই fixed short retry)।
- একই campaign-এর জন্য duplicate buy আটকাতে একটা lock/flag রাখুন (status `POLLING`→ transition আটকে ডাবল buy কল না হয়)।
- সব poll attempt এবং buy attempt একটা `CampaignLog` টেবিলে (optional) লগ করে রাখলে ভবিষ্যতে debugging সহজ হবে।

```prisma
model CampaignLog {
  id         String   @id @default(cuid())
  campaign   Campaign @relation(fields: [campaignId], references: [id])
  campaignId String
  event      String   // "POLL_ATTEMPT" | "MATCH_FOUND" | "BUY_SUCCESS" | "BUY_FAILED"
  detail     String?
  createdAt  DateTime @default(now())
}
```

---

## 9. Open Question (আপনার কাছ থেকে জানা দরকার)

`/v1/goods/lists` এবং `/v1/goods/addCart` কল করতে কি কোনো **authentication** লাগবে (API key header, cookie session, bearer token)? যদি লাগে:
- সেটা প্রতি user-ভিত্তিক নাকি admin-ভিত্তিক (সব ইউজারের জন্য একই credential)?
- এটার উপর ভিত্তি করে `User.apiCredential` field-টা design করতে হবে এবং এটা **অবশ্যই encrypted** রাখা দরকার DB-তে (plain text না)।

---

## 10. Scaling & Timing Architecture — Redis + BullMQ (চূড়ান্ত সিদ্ধান্ত)

**Scale target:** ~50 users × ~10 campaigns = সম্ভাব্য ৫০০টা concurrent polling task, যাদের অনেকগুলোর publish time কাছাকাছি সময়ে পড়তে পারে। যেহেতু polling মূলত I/O-bound কাজ (HTTP request পাঠিয়ে response-এর জন্য wait করা), Node.js-এর event loop এটা খুব efficient-ভাবে handle করতে পারে — সঠিক architecture থাকলে এটা কোনো bottleneck না।

### 10.1 তিন-স্তরের আর্কিটেকচার

```
[1] Scheduler (lightweight cron, প্রতি 5-10 সেকেন্ডে চলে)
      │
      ├─ DB থেকে দেখে কোন campaign-এর publishTime
      │  আগামী কয়েক মিনিটে আসছে, যেগুলো এখনো queue হয়নি
      │
      └─ BullMQ-তে delayed job add করে
         (fire at publishTime - 2 minutes)
                │
                ▼
[2] Redis Queue  ── job persist হয়ে থাকে, নির্দিষ্ট সময়ে fire হয়
                │
                ▼
[3] Worker Pool (PM2 cluster mode / Docker replicas — একাধিক instance)
      │
      └─ প্রতিটা worker একটা campaign-এর polling loop চালায়:
         POST /v1/goods/lists → খালি হলে retry
         → data পেলে → POST /v1/goods/addCart (auto-buy mode হলে)
```

### 10.2 কেন BullMQ

1. **Delayed Jobs** — campaign create হওয়ার সাথে সাথেই `publishTime - 2min` সময়ে fire হওয়ার job schedule করা যায়। Redis-এ persist থাকে বলে সার্ভার restart/crash হলেও job হারায় না।
2. **Horizontal scaling** — লোড বাড়লে শুধু আরেকটা worker process/container চালু করলেই Redis নিজে থেকে কাজ ভাগ করে দেয়। ৫০০ থেকে ৫০০০ campaign হলেও শুধু worker সংখ্যা বাড়ালেই scale হয়।
3. **Built-in per-queue rate limiter** — একই domain-এ কত রিকোয়েস্ট/সেকেন্ড যাবে সেটা কন্ট্রোল করা যায়, যাতে target site থেকে ব্লক না খায়।
4. **Retry policy** — buy call fail করলে নির্দিষ্ট সংখ্যক বার automatic retry করা যায়, সাথে backoff strategy কনফিগার করা যায়।
5. **Job status observability** — BullBoard/Bull Dashboard দিয়ে সব pending/active/failed job একটা UI-তে দেখা যায় — debugging-এর জন্য সুবিধাজনক।

### 10.3 প্রস্তাবিত Queue ডিজাইন

- **`campaign-scheduler` queue** — শুধু delayed job schedule করার জন্য (repeatable/cron-এর মাধ্যমে DB scan করে)।
- **`campaign-polling` queue** — actual polling+buy job গুলো এখানে চলবে; এখানে **concurrency limit** এবং **per-domain rate limiter** সেট করা থাকবে।

```js
// উদাহরণ: worker concurrency ও domain rate limit
const worker = new Worker('campaign-polling', processCampaignJob, {
  connection: redisConnection,
  concurrency: 50, // একসাথে কতগুলো polling job worker-এ চলবে
});

// per-domain rate limiting আলাদা queue হিসেবে করাই ভালো, 
// অথবা BullMQ Pro-র group rate limit ফিচার ব্যবহার করা যায়
```

### 10.4 টাইমিং নির্ভুলতার জন্য বাড়তি ব্যবস্থা

| বিষয় | সমাধান |
|---|---|
| setTimeout/BullMQ delay-এ সামান্য drift | নির্ধারিত `publishTime - 2min`-এর চেয়ে ৫-১০ সেকেন্ড আগেই polling শুরু করুন (বাফার রাখুন) |
| HTTP connection বার বার নতুন খুলতে সময় লাগা | Keep-Alive HTTP agent ব্যবহার করুন (undici অথবা `axios` + `http.Agent({ keepAlive: true })`) — connection reuse হবে, প্রতি poll দ্রুত হবে |
| Target সাইট থেকে rate-limit/ban | প্রতি domain-এ max concurrent request কনফিগার করে রাখুন (BullMQ rate limiter) |
| Worker crash হলে campaign miss হওয়া | Job Redis-এ persist থাকে বলে worker restart হলেও job হারাবে না; retry policy সেট রাখুন |
| DB scan slow হওয়া (অনেক campaign থাকলে) | `publishTime` কলামে index দিন, শুধু "আগামী কয়েক মিনিটে যেগুলো এখনো queue হয়নি" এই query-ই রাখুন |

### 10.5 Deployment নোট

- Next.js app এবং BullMQ worker **আলাদা প্রসেস** হিসেবে ডিপ্লয় হবে (worker Vercel-এর মতো serverless platform-এ persistent থাকবে না — worker-এর জন্য VPS/Docker/Railway/Render-এর মতো persistent hosting লাগবে)।
- Redis একটা managed service (Upstash, Redis Cloud) অথবা self-hosted VPS-এ রাখা যায়।
- PM2 cluster mode দিয়ে worker-এর ২-৩টা instance চালিয়ে রাখলে polling load ভাগ হয়ে যাবে এবং একটা instance ক্র্যাশ করলেও বাকিগুলো কাজ চালিয়ে যাবে।

---

## 11. Non-Functional Requirements

- **Concurrency:** একসাথে অনেক ইউজারের অনেক campaign polling চলবে — worker-কে queue-based (BullMQ) বানানো ভালো, যাতে horizontal scale করা যায়।
- **Timing precision:** সিস্টেম ক্লক এবং target API সার্ভারের সময়ের মধ্যে drift থাকতে পারে — polling শুরু কিছুটা আগে (যেমন publish time - 65 sec) করলে নিরাপদ।
- **Rate limiting awareness:** টার্গেট সাইট থেকে ব্লক এড়াতে polling interval এবং concurrent request সংখ্যা কনফিগারযোগ্য রাখুন।
- **Notification (optional):** campaign SUCCESS/FAILED হলে email/Telegram/push notification পাঠানো যেতে পারে।