// sw.js — 모닝 날씨 알리미 Service Worker

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── 알림 클릭 시 앱 열기 ───────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/weather-app/');
    })
  );
});

// ── 메인 페이지로부터 설정 저장 ───────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SAVE_CONFIG') {
    // config를 SW 내부 변수에 저장
    swConfig = e.data.config;
    // 즉시 체크 루프 시작
    startLoop();
  }
});

// ── SW 내부 상태 ──────────────────────────────────────
let swConfig = null;  // { apiKey, city, schedules: ["07:30", ...] }
let loopTimer = null;
let firedToday = {};  // { "07:30": "2026-03-16" }  오늘 이미 보낸 알람 기록

function startLoop() {
  if (loopTimer) clearInterval(loopTimer);
  // 매 30초마다 시간 체크
  loopTimer = setInterval(checkAlarms, 30 * 1000);
  checkAlarms(); // 즉시 1회 실행
}

async function checkAlarms() {
  if (!swConfig) return;
  const { apiKey, city, schedules } = swConfig;
  if (!schedules || schedules.length === 0) return;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const today = now.toISOString().slice(0, 10);

  for (const t of schedules) {
    // 설정 시간과 현재 시간이 일치하고, 오늘 아직 안 보냈으면 발송
    if (t === hhmm && firedToday[t] !== today) {
      firedToday[t] = today;
      await fireWeatherNotification(apiKey, city);
    }
  }
}

// ── 날씨 fetch & 알림 발송 ────────────────────────────
async function fireWeatherNotification(apiKey, city) {
  try {
    const wRes = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=kr`
    );
    if (!wRes.ok) throw new Error('날씨 API 오류');
    const w = await wRes.json();

    const { lat, lon } = w.coord;
    const aRes = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`
    );
    const a = aRes.ok ? await aRes.json() : null;
    const pm25 = a?.list?.[0]?.components?.pm2_5 ?? null;

    const temp  = Math.round(w.main.temp);
    const feels = Math.round(w.main.feels_like);
    const desc  = w.weather[0].description;
    const outfit = getOutfit(temp, pm25);
    const pmText = pm25 !== null ? `PM2.5 ${pm25.toFixed(1)}µg/m³ ${pmGrade(pm25)}` : '미세먼지 정보 없음';

    await self.registration.showNotification(`☀️ ${w.name} 오늘의 날씨`, {
      body: `🌡 ${temp}°C (체감 ${feels}°C) · ${desc}\n💨 ${pmText}\n👗 ${outfit}`,
      icon: `https://openweathermap.org/img/wn/${w.weather[0].icon}@2x.png`,
      badge: 'https://openweathermap.org/img/wn/01d.png',
      tag: 'morning-weather',
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200]
    });
  } catch (err) {
    await self.registration.showNotification('모닝 날씨 알리미', {
      body: '날씨 정보를 불러오지 못했어요. 앱을 확인해주세요.',
      icon: 'https://openweathermap.org/img/wn/01d@2x.png',
      tag: 'morning-weather-error'
    });
  }
}

function getOutfit(temp, pm25) {
  let c = '';
  if      (temp >= 28) c = '반팔·반바지';
  else if (temp >= 23) c = '반팔 티셔츠';
  else if (temp >= 17) c = '긴팔·가디건';
  else if (temp >= 12) c = '자켓·후드티';
  else if (temp >= 6)  c = '코트·니트·머플러';
  else                 c = '패딩·방한용품';
  if (pm25 !== null && pm25 >= 35) c += ' + 마스크 필수';
  return c;
}

function pmGrade(pm25) {
  if (pm25 < 15) return '😊좋음';
  if (pm25 < 35) return '🙂보통';
  if (pm25 < 75) return '😟나쁨';
  return '😷매우나쁨';
}
