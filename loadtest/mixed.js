import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const API_BASE = `${BASE_URL}/api`;
const VOTERS_FILE = __ENV.VOTERS_FILE || "./loadtest/voters.json";

const voters = new SharedArray("voters-mixed", () => {
  const parsed = JSON.parse(open(VOTERS_FILE));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("VOTERS_FILE must contain a non-empty JSON array.");
  }
  return parsed;
});

export const options = {
  scenarios: {
    checkin_flow: {
      executor: "constant-arrival-rate",
      exec: "checkinFlow",
      rate: Number(__ENV.CHECKIN_RATE || 40),
      timeUnit: "1s",
      duration: __ENV.CHECKIN_DURATION || "3m",
      preAllocatedVUs: Number(__ENV.CHECKIN_PRE_VUS || 100),
      maxVUs: Number(__ENV.CHECKIN_MAX_VUS || 700),
    },
    vote_flow: {
      executor: "shared-iterations",
      exec: "voteFlow",
      vus: Number(__ENV.VOTE_VUS || 100),
      iterations: Number(__ENV.VOTE_ITERATIONS || voters.length),
      maxDuration: __ENV.VOTE_MAX_DURATION || "10m",
      startTime: __ENV.VOTE_START || "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1300"],
    checks: ["rate>0.98"],
  },
};

function randomVoter() {
  return voters[Math.floor(Math.random() * voters.length)];
}

function iterVoter() {
  return voters[__ITER % voters.length];
}

function decodeCookie(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

export function checkinFlow() {
  const voter = randomVoter();
  const payload = JSON.stringify({
    election_id: Number(voter.election_id),
    voter_id: String(voter.voter_id),
    voter_key: String(voter.voter_key),
  });

  const res = http.post(`${API_BASE}/attendance-access/check-in`, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    tags: { flow: "checkin", endpoint: "attendance_checkin" },
  });

  check(res, {
    "check-in 200/201/409": (r) => r.status === 200 || r.status === 201 || r.status === 409,
    "check-in no 5xx": (r) => r.status < 500,
  });
}

export function voteFlow() {
  const voter = iterVoter();
  const jar = http.cookieJar();

  const csrfRes = http.get(`${BASE_URL}/sanctum/csrf-cookie`, {
    headers: { Accept: "application/json" },
    tags: { flow: "vote", endpoint: "csrf_cookie" },
  });

  const csrfOk = check(csrfRes, {
    "csrf ok": (r) => r.status >= 200 && r.status < 400,
  });

  if (!csrfOk) {
    return;
  }

  const xsrfCookie = jar.cookiesForURL(BASE_URL)["XSRF-TOKEN"];
  const xsrfToken = xsrfCookie && xsrfCookie.length > 0 ? decodeCookie(xsrfCookie[0]) : "";

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-XSRF-TOKEN": xsrfToken,
  };

  const loginRes = http.post(
    `${API_BASE}/login`,
    JSON.stringify({
      login_type: "voter",
      voter_id: String(voter.voter_id),
      voter_key: String(voter.voter_key),
      election_id: Number(voter.election_id),
      remember: false,
    }),
    { headers, tags: { flow: "vote", endpoint: "login_voter" } }
  );

  const loginOk = check(loginRes, {
    "login 200": (r) => r.status === 200,
  });

  if (!loginOk) {
    return;
  }

  const voteRes = http.post(
    `${API_BASE}/vote`,
    JSON.stringify({
      election_id: Number(voter.election_id),
      votes: Array.isArray(voter.votes) ? voter.votes : [],
    }),
    { headers, tags: { flow: "vote", endpoint: "cast_vote" } }
  );

  check(voteRes, {
    "vote 201/409": (r) => r.status === 201 || r.status === 409,
    "vote no 5xx": (r) => r.status < 500,
  });
}
