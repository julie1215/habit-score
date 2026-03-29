import React, { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const STORAGE_KEY = "daily-point-webapp-v2";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA1wF3bM_1n7sDGOZ7JLfM4IHAkBH8yyVA",
  authDomain: "habit-score-b5c77.firebaseapp.com",
  projectId: "habit-score-b5c77",
  storageBucket: "habit-score-b5c77.firebasestorage.app",
  messagingSenderId: "49697984642",
  appId: "1:49697984642:web:c71f4ac2483ddcec5ae49b",
  measurementId: "G-W1QBNYQFY7"
};

const DEFAULT_ROOM_CODE = "JAEWON";
const CHILD_NAME = "재원";
const PARENT_PASSWORD = "1023";

let firebaseApp = initializeApp(FIREBASE_CONFIG);
let firestore = getFirestore(firebaseApp);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

function timeToMinutes(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function getDayKey(dateString) {
  const d = new Date(`${dateString}T12:00:00`);
  const day = d.getDay();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day];
}

function startOfWeek(dateString) {
  const d = new Date(`${dateString}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return todayString(d);
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayString(d);
}

function formatDateKorean(dateString) {
  const d = new Date(`${dateString}T12:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_LABELS[getDayKey(dateString)]})`;
}

function getScheduleLabel(days) {
  const sorted = [...days].sort((a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b));
  if (sorted.length === 5 && ["mon", "tue", "wed", "thu", "fri"].every((d) => sorted.includes(d))) {
    return "평일";
  }
  if (sorted.length === 7) return "매일";
  return sorted.map((d) => DAY_LABELS[d]).join("/");
}

function createDefaultRules() {
  return [
    {
      id: crypto.randomUUID(),
      title: "등교 출발",
      category: "학교",
      type: "threshold",
      days: ["mon", "tue", "wed", "thu", "fri"],
      scheduleLabel: "평일",
      thresholds: [
        { id: crypto.randomUUID(), time: "08:30", score: 2, label: "8시 30분 전" },
        { id: crypto.randomUUID(), time: "08:40", score: 1, label: "8시 40분 전" },
      ],
      fallbackScore: -1,
      fallbackLabel: "8시 40분 이후",
      targetScore: 1,
    },
    {
      id: crypto.randomUUID(),
      title: "수학 과외",
      category: "학원",
      type: "lateness",
      days: ["mon", "wed", "fri"],
      scheduleLabel: "월/수/금",
      dueTime: "16:00",
      onTimeScore: 1,
      latePenaltyPerMinute: -1,
      targetScore: 0,
    },
    {
      id: crypto.randomUUID(),
      title: "영어 학원",
      category: "학원",
      type: "lateness",
      days: ["tue", "thu"],
      scheduleLabel: "화/목",
      dueTime: "18:00",
      onTimeScore: 1,
      latePenaltyPerMinute: -1,
      targetScore: 0,
    },
  ];
}

function createDefaultAppState() {
  return {
    rules: createDefaultRules(),
    records: {},
    weeklyGoal: 70,
  };
}

function normalizeLoadedState(parsed) {
  const rules = (parsed?.rules || []).map((rule) => ({
    ...rule,
    scheduleLabel: rule.scheduleLabel || getScheduleLabel(rule.days || []),
  }));
  return {
    rules: rules.length > 0 ? rules : createDefaultRules(),
    records: parsed?.records || {},
    weeklyGoal: typeof parsed?.weeklyGoal === "number" ? parsed.weeklyGoal : 70,
  };
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultAppState();
    return normalizeLoadedState(JSON.parse(raw));
  } catch {
    return createDefaultAppState();
  }
}

function getRuleMaxScore(rule) {
  if (rule.type === "threshold") {
    return Math.max(rule.fallbackScore ?? 0, ...rule.thresholds.map((t) => t.score));
  }
  if (rule.type === "lateness") {
    return rule.onTimeScore ?? 0;
  }
  return 0;
}

function scoreRule(rule, actualTime) {
  if (!actualTime) return { score: 0, maxScore: getRuleMaxScore(rule), detail: "미입력" };
  const actual = timeToMinutes(actualTime);
  if (actual == null) return { score: 0, maxScore: getRuleMaxScore(rule), detail: "시간 형식 오류" };

  if (rule.type === "threshold") {
    const sorted = [...rule.thresholds].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    for (const t of sorted) {
      const thresholdMin = timeToMinutes(t.time);
      if (actual <= thresholdMin) {
        return { score: t.score, maxScore: getRuleMaxScore(rule), detail: `${t.label} 달성` };
      }
    }
    return { score: rule.fallbackScore ?? 0, maxScore: getRuleMaxScore(rule), detail: rule.fallbackLabel || "기준 미달" };
  }

  if (rule.type === "lateness") {
    const due = timeToMinutes(rule.dueTime);
    const diff = actual - due;
    if (diff <= 0) {
      return { score: rule.onTimeScore, maxScore: getRuleMaxScore(rule), detail: "지각 없음" };
    }
    const score = (rule.latePenaltyPerMinute || -1) * diff;
    return { score, maxScore: getRuleMaxScore(rule), detail: `${diff}분 지각` };
  }

  return { score: 0, maxScore: 0, detail: "미지원" };
}

function getRulesForDate(rules, dateString) {
  const dayKey = getDayKey(dateString);
  return rules.filter((rule) => rule.days.includes(dayKey));
}

function calcDailySummary(rules, records, dateString) {
  const todaysRules = getRulesForDate(rules, dateString);
  const dayRecord = records[dateString] || {};

  const items = todaysRules.map((rule) => {
    const actualTime = dayRecord[rule.id]?.actualTime || "";
    const checked = !!dayRecord[rule.id]?.checked;
    if (!checked) {
      return {
        rule,
        actualTime,
        checked,
        score: 0,
        maxScore: getRuleMaxScore(rule),
        detail: "미체크",
      };
    }
    const result = scoreRule(rule, actualTime);
    return { rule, actualTime, checked, ...result };
  });

  const total = items.reduce((sum, item) => sum + item.score, 0);
  const maxTotal = items.reduce((sum, item) => sum + item.maxScore, 0);
  const normalized = maxTotal > 0 ? Math.max(0, Math.round((total / maxTotal) * 100)) : 0;
  return { items, total, maxTotal, normalized };
}

function calcWeeklySummary(rules, records, baseDateString) {
  const weekStart = startOfWeek(baseDateString);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const daily = days.map((date) => ({ date, ...calcDailySummary(rules, records, date) }));
  const total = daily.reduce((sum, d) => sum + d.total, 0);
  const maxTotal = daily.reduce((sum, d) => sum + d.maxTotal, 0);
  const normalized = maxTotal > 0 ? Math.max(0, Math.round((total / maxTotal) * 100)) : 0;
  return { weekStart, days, daily, total, maxTotal, normalized };
}

function sectionStyle() {
  return {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  };
}

function inputStyle() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    fontSize: 14,
    boxSizing: "border-box",
  };
}

function buttonStyle(primary = false) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 10px",
    borderRadius: 999,
    border: primary ? "1px solid #111827" : "1px solid #d1d5db",
    background: primary ? "#111827" : "#fff",
    color: primary ? "#fff" : "#111827",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
    lineHeight: 1,
  };
}

function badgeStyle(kind = "default") {
  const styles = {
    default: { background: "#eef2ff", color: "#3730a3" },
    gray: { background: "#f3f4f6", color: "#374151" },
    success: { background: "#ecfdf5", color: "#065f46" },
  };
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    ...styles[kind],
  };
}

function SummaryBox({ label, value, sub }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 14, padding: 14, border: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 13, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function DaySelector({ selectedDate, onChange, isMobile }) {
  const weekStart = startOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(7, minmax(90px, 1fr))",
        gap: 8,
      }}
    >
      {days.map((date) => {
        const isActive = date === selectedDate;
        return (
          <button
            key={date}
            onClick={() => onChange(date)}
            style={{
              ...buttonStyle(isActive),
              minHeight: isMobile ? 72 : 64,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              width: "100%",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: isActive ? "#ffffff" : "#6b7280",
              }}
            >
              {DAY_LABELS[getDayKey(date)]}
            </div>

            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: isActive ? "#ffffff" : "#111111",
              }}
            >
              {date.slice(5)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RuleEditor({ initialRule, onSubmit, onCancel, submitLabel = "저장" }) {
  const [title, setTitle] = useState(initialRule?.title || "");
  const [category, setCategory] = useState(initialRule?.category || "생활");
  const [type, setType] = useState(initialRule?.type || "threshold");
  const [days, setDays] = useState(initialRule?.days || ["mon", "tue", "wed", "thu", "fri"]);
  const [time1, setTime1] = useState(initialRule?.thresholds?.[0]?.time || "08:30");
  const [score1, setScore1] = useState(initialRule?.thresholds?.[0]?.score ?? 2);
  const [time2, setTime2] = useState(initialRule?.thresholds?.[1]?.time || "08:40");
  const [score2, setScore2] = useState(initialRule?.thresholds?.[1]?.score ?? 1);
  const [fallbackScore, setFallbackScore] = useState(initialRule?.fallbackScore ?? -1);
  const [dueTime, setDueTime] = useState(initialRule?.dueTime || "16:00");
  const [onTimeScore, setOnTimeScore] = useState(initialRule?.onTimeScore ?? 1);
  const [latePenaltyPerMinute, setLatePenaltyPerMinute] = useState(initialRule?.latePenaltyPerMinute ?? -1);

  useEffect(() => {
    setTitle(initialRule?.title || "");
    setCategory(initialRule?.category || "생활");
    setType(initialRule?.type || "threshold");
    setDays(initialRule?.days || ["mon", "tue", "wed", "thu", "fri"]);
    setTime1(initialRule?.thresholds?.[0]?.time || "08:30");
    setScore1(initialRule?.thresholds?.[0]?.score ?? 2);
    setTime2(initialRule?.thresholds?.[1]?.time || "08:40");
    setScore2(initialRule?.thresholds?.[1]?.score ?? 1);
    setFallbackScore(initialRule?.fallbackScore ?? -1);
    setDueTime(initialRule?.dueTime || "16:00");
    setOnTimeScore(initialRule?.onTimeScore ?? 1);
    setLatePenaltyPerMinute(initialRule?.latePenaltyPerMinute ?? -1);
  }, [initialRule]);

  const toggleDay = (day) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const submit = () => {
    if (!title.trim() || days.length === 0) return;
    const common = {
      id: initialRule?.id || crypto.randomUUID(),
      title: title.trim(),
      category,
      type,
      days,
      scheduleLabel: getScheduleLabel(days),
      targetScore: initialRule?.targetScore ?? 0,
    };

    const rule =
      type === "threshold"
        ? {
          ...common,
          thresholds: [
            { id: initialRule?.thresholds?.[0]?.id || crypto.randomUUID(), time: time1, score: Number(score1), label: `${time1} 전` },
            { id: initialRule?.thresholds?.[1]?.id || crypto.randomUUID(), time: time2, score: Number(score2), label: `${time2} 전` },
          ],
          fallbackScore: Number(fallbackScore),
          fallbackLabel: `${time2} 이후`,
        }
        : {
          ...common,
          dueTime,
          onTimeScore: Number(onTimeScore),
          latePenaltyPerMinute: Number(latePenaltyPerMinute),
        };

    onSubmit(rule);
  };

  return (
    <div style={sectionStyle()}>
      <h3 style={{ marginTop: 0 }}>{initialRule ? "항목 수정" : "항목 추가"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <div style={{ marginBottom: 6, fontSize: 14 }}>항목명</div>
          <input style={inputStyle()} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 피아노 학원" />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontSize: 14 }}>분류</div>
          <input style={inputStyle()} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 학교, 학원, 생활" />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ marginBottom: 6, fontSize: 14 }}>적용 요일</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 8,
            width: "100%",
          }}
        >
          {DAY_KEYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              style={{
                ...buttonStyle(days.includes(day)),
                width: "100%",
                justifyContent: "center",
                padding: "8px 0",
              }}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ marginBottom: 6, fontSize: 14 }}>평가 방식</div>
        <select style={inputStyle()} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="threshold">시간 구간 점수형</option>
          <option value="lateness">지각 분당 감점형</option>
        </select>
      </div>

      {type === "threshold" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>1차 기준 시간</div><input style={inputStyle()} type="time" value={time1} onChange={(e) => setTime1(e.target.value)} /></div>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>1차 점수</div><input style={inputStyle()} type="number" value={score1} onChange={(e) => setScore1(e.target.value)} /></div>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>2차 기준 시간</div><input style={inputStyle()} type="time" value={time2} onChange={(e) => setTime2(e.target.value)} /></div>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>2차 점수</div><input style={inputStyle()} type="number" value={score2} onChange={(e) => setScore2(e.target.value)} /></div>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>기준 미달 점수</div><input style={inputStyle()} type="number" value={fallbackScore} onChange={(e) => setFallbackScore(e.target.value)} /></div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>정시 기준 시간</div><input style={inputStyle()} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} /></div>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>지각 없으면 점수</div><input style={inputStyle()} type="number" value={onTimeScore} onChange={(e) => setOnTimeScore(e.target.value)} /></div>
          <div><div style={{ marginBottom: 6, fontSize: 14 }}>분당 감점</div><input style={inputStyle()} type="number" value={latePenaltyPerMinute} onChange={(e) => setLatePenaltyPerMinute(e.target.value)} /></div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={buttonStyle(true)} onClick={submit}>{submitLabel}</button>
        {initialRule && <button style={buttonStyle(false)} onClick={onCancel}>취소</button>}
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(loadLocalState);
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [currentRoomCode, setCurrentRoomCode] = useState(DEFAULT_ROOM_CODE);
  const [isParentMode, setIsParentMode] = useState(false);
  const [tab, setTab] = useState("daily");
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const isMobile = viewportWidth < 768;
  const [isRoomReady, setIsRoomReady] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!firestore || !currentRoomCode) return;

    const ref = doc(firestore, "families", currentRoomCode);
    const unsub = onSnapshot(ref, (snapshot) => {
      if (!snapshot.exists()) return;
      const remoteData = snapshot.data()?.appState;
      if (remoteData) {
        setState(normalizeLoadedState(remoteData));
      }
      setIsRoomReady(true);
    });

    return () => unsub();
  }, [currentRoomCode]);

  useEffect(() => {
    ensureDefaultRoom();
  }, []);

  const daily = useMemo(() => calcDailySummary(state.rules, state.records, selectedDate), [state, selectedDate]);
  const weekly = useMemo(() => calcWeeklySummary(state.rules, state.records, selectedDate), [state, selectedDate]);
  const editingRule = useMemo(() => state.rules.find((rule) => rule.id === editingRuleId) || null, [state.rules, editingRuleId]);

  const persistState = async (nextState) => {
    setState(nextState);
    if (!firestore || !currentRoomCode || !isRoomReady) return;

    const ref = doc(firestore, "families", currentRoomCode);
    await setDoc(
      ref,
      {
        appState: nextState,
        meta: { roomCode: currentRoomCode, updatedAt: serverTimestamp() },
      },
      { merge: true }
    );
  };

  const setRecord = async (date, ruleId, patch) => {
    const nextState = {
      ...state,
      records: {
        ...state.records,
        [date]: {
          ...(state.records[date] || {}),
          [ruleId]: {
            ...(state.records[date]?.[ruleId] || {}),
            ...patch,
          },
        },
      },
    };
    await persistState(nextState);
  };

  const addRule = async (rule) => persistState({ ...state, rules: [...state.rules, rule] });
  const updateRule = async (updatedRule) => {
    await persistState({ ...state, rules: state.rules.map((rule) => (rule.id === updatedRule.id ? updatedRule : rule)) });
    setEditingRuleId(null);
  };
  const deleteRule = async (id) => {
    await persistState({ ...state, rules: state.rules.filter((r) => r.id !== id) });
    if (editingRuleId === id) setEditingRuleId(null);
  };

  const handleParentModeClick = () => {
    const input = window.prompt("부모 모드 비밀번호를 입력하세요");

    // 취소 누른 경우
    if (input === null) return;

    if (input === PARENT_PASSWORD) {
      setIsParentMode(true);
    } else {
      window.alert("비밀번호가 틀렸어요");
    }
  };

  const exitParentMode = () => {
    setIsParentMode(false);
  };

  const ensureDefaultRoom = async () => {
    if (!firestore || !DEFAULT_ROOM_CODE) return;

    const code = DEFAULT_ROOM_CODE.trim().toUpperCase();
    const ref = doc(firestore, "families", code);
    const snapshot = await getDoc(ref);

    if (snapshot.exists()) {
      setCurrentRoomCode(code);
      return;
    }

    await setDoc(ref, {
      appState: createDefaultAppState(),
      meta: {
        roomCode: code,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        autoCreated: true,
      },
    });

    setCurrentRoomCode(code);
  };

  const dailyPass = daily.normalized >= state.weeklyGoal;
  const weeklyPass = weekly.normalized >= state.weeklyGoal;

  if (!isRoomReady) {
    return (
      <>
        <style>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

        <div
          style={{
            minHeight: "100vh",
            background: "#f8fafc",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              padding: "28px 24px",
              minWidth: 220,
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              animation: "fadeInUp 0.25s ease-out",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "4px solid #e5e7eb",
                borderTop: "4px solid #111827",
                animation: "spin 0.9s linear infinite",
              }}
            />
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#111827",
              }}
            >
              불러오는 중...
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#6b7280",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              데이터를 안전하게 불러오고 있어요
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: isMobile ? 12 : 20,
        color: "#111827",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        textRendering: "optimizeLegibility",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          <div style={{ ...sectionStyle(), gridColumn: isMobile ? "span 1" : "span 2" }}>
            <h1
              style={{
                margin: "8px 0",
                fontSize: 24,
                fontWeight: 700,
                color: "#111111",
                lineHeight: 1.3,
                letterSpacing: "-0.3px",
              }}
            >
              {CHILD_NAME}의 데일리 / 위클리 점수판
            </h1>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 30,
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <span style={badgeStyle("default")}>
                {isParentMode ? "부모 모드" : "아이 모드"}
              </span>

              {isParentMode ? (
                <>
                  <button style={buttonStyle(false)} onClick={exitParentMode}>아이 모드</button>
                </>
              ) : (
                <>
                  <button style={buttonStyle(false)} onClick={handleParentModeClick}>부모 모드</button>
                </>
              )}
            </div>
          </div>

          <div style={sectionStyle()}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>기본 설정</div>

            {!isParentMode ? (
              <div>
                <div style={{ fontSize: 14, marginBottom: 6 }}>목표 점수 (100점 기준)</div>
                <div
                  style={{
                    ...inputStyle(),
                    background: "#f8fafc",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {state.weeklyGoal}점
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 14, marginBottom: 6 }}>목표 점수 (100점 기준)</div>
                <input
                  style={inputStyle()}
                  type="number"
                  value={state.weeklyGoal}
                  onChange={(e) => persistState({ ...state, weeklyGoal: Number(e.target.value || 0) })}
                />
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <DaySelector selectedDate={selectedDate} onChange={setSelectedDate} isMobile={isMobile} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.4fr) minmax(280px, 0.9fr)",
            gap: 16,
            marginTop: 16,
            alignItems: "start",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 8,
                marginBottom: 16,
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <button style={buttonStyle(tab === "daily")} onClick={() => setTab("daily")}>
                데일리
              </button>
              <button style={buttonStyle(tab === "weekly")} onClick={() => setTab("weekly")}>
                위클리
              </button>
            </div>

            {tab === "daily" ? (
              <div style={sectionStyle()}>
                <h2
                  style={{
                    margin: "0 0 10px",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#111111",
                    lineHeight: 1.3,
                    letterSpacing: "-0.2px",
                  }}
                >
                  {formatDateKorean(selectedDate)}
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                  }}
                >
                  <SummaryBox label="획득 점수" value={`${daily.total}점`} sub={`${daily.maxTotal}점 만점`} />
                  <SummaryBox label="환산 점수" value={`${daily.normalized}점`} sub="100점 기준" />
                  <SummaryBox label="판정" value={dailyPass ? "통과" : "미달"} sub={`기준 ${state.weeklyGoal}점`} />
                </div>
                <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, marginTop: 14, overflow: "hidden" }}>
                  <div style={{ width: `${daily.normalized}%`, height: "100%", background: "#111827" }} />
                </div>

                <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                  {daily.items.length === 0 ? (
                    <div style={{ color: "#6b7280" }}>이 날짜에는 등록된 항목이 없어요.</div>
                  ) : null}

                  {daily.items.map((item) => {
                    const rec = state.records[selectedDate]?.[item.rule.id] || {};

                    return (
                      <div
                        key={item.rule.id}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 14,
                          padding: 14,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "stretch",
                            gap: 12,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 6,
                              textAlign: "left",
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 18,
                                lineHeight: 1.3,
                                width: "100%",
                                textAlign: "left",
                              }}
                            >
                              {item.rule.title}
                            </div>

                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                                justifyContent: "flex-start",
                              }}
                            >
                              <span style={badgeStyle("gray")}>{item.rule.category}</span>
                              <span style={badgeStyle("default")}>{item.rule.scheduleLabel}</span>
                            </div>

                            <div
                              style={{
                                fontSize: 14,
                                color: "#4b5563",
                                lineHeight: 1.5,
                                textAlign: "left",
                              }}
                            >
                              {item.rule.type === "threshold"
                                ? "시간 구간 점수형"
                                : `정시 ${item.rule.dueTime} / 지각 분당 감점`}
                            </div>

                            <div
                              style={{
                                fontSize: 14,
                                lineHeight: 1.5,
                                textAlign: "left",
                              }}
                            >
                              결과: <strong>{item.detail}</strong> · {item.score}점
                            </div>
                          </div>

                          <div
                            style={{
                              width: "100%",
                              display: "flex",
                              flexDirection: "column",
                              gap: 10,
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                textAlign: "left",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!!rec.checked}
                                onChange={(e) =>
                                  setRecord(selectedDate, item.rule.id, {
                                    checked: e.target.checked,
                                  })
                                }
                              />
                              <span>달성 체크</span>
                            </label>

                            <input
                              style={inputStyle()}
                              type="time"
                              value={rec.actualTime || ""}
                              onChange={(e) =>
                                setRecord(selectedDate, item.rule.id, {
                                  actualTime: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={sectionStyle()}>
                <h2
                  style={{
                    margin: "0 0 10px",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#111111",
                    lineHeight: 1.3,
                    letterSpacing: "-0.2px",
                  }}
                >
                  주간 요약
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                  }}
                >
                  <SummaryBox label="주간 총점" value={`${weekly.total}점`} sub={`${weekly.maxTotal}점 만점`} />
                  <SummaryBox label="환산 점수" value={`${weekly.normalized}점`} sub="100점 기준" />
                  <SummaryBox label="판정" value={weeklyPass ? "통과" : "미달"} sub={`기준 ${state.weeklyGoal}점`} />
                </div>
                <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, marginTop: 14, overflow: "hidden" }}>
                  <div style={{ width: `${weekly.normalized}%`, height: "100%", background: "#111827" }} />
                </div>
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  {weekly.daily.map((d) => (
                    <div
                      key={d.date}
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "1fr auto auto",
                        gap: 10,
                        alignItems: "center",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{formatDateKorean(d.date)}</div>
                        <div style={{ color: "#6b7280", fontSize: 13 }}>{d.items.length}개 항목</div>
                      </div>
                      <div style={{ fontWeight: 700 }}>{d.total} / {d.maxTotal}</div>
                      <span style={badgeStyle(d.normalized >= state.weeklyGoal ? "success" : "gray")}>{d.normalized}점</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isParentMode ? (
              <div style={{ marginTop: 16 }}>
                <RuleEditor onSubmit={addRule} submitLabel="항목 추가하기" />
              </div>
            ) : null}
          </div>

          <div>
            {isParentMode && editingRule ? (
              <div style={{ marginBottom: 16 }}>
                <RuleEditor
                  initialRule={editingRule}
                  onSubmit={updateRule}
                  onCancel={() => setEditingRuleId(null)}
                  submitLabel="수정 저장"
                />
              </div>
            ) : null}

            <div style={sectionStyle()}>
              <h3 style={{ marginTop: 0 }}>등록된 항목</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {state.rules.map((rule) => (
                  <div key={rule.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontWeight: 700 }}>{rule.title}</div>
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span style={badgeStyle("gray")}>{rule.category}</span>
                      <span style={badgeStyle("default")}>{rule.scheduleLabel}</span>
                    </div>
                    <div style={{ fontSize: 14, color: "#4b5563", marginTop: 8 }}>
                      {rule.type === "threshold"
                        ? `${rule.thresholds.map((t) => `${t.time} 전 ${t.score}점`).join(" / ")} / 이후 ${rule.fallbackScore}점`
                        : `${rule.dueTime}까지 ${rule.onTimeScore}점 / 지각 분당 ${rule.latePenaltyPerMinute}점`}
                    </div>
                    {isParentMode ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <button style={buttonStyle(false)} onClick={() => setEditingRuleId(rule.id)}>수정</button>
                        <button style={buttonStyle(false)} onClick={() => deleteRule(rule.id)}>삭제</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
