import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const API_BASE = `${BASE_URL}/api`;
const VOTERS_FILE = __ENV.VOTERS_FILE || "./loadtest/voters.json";

const voters = new SharedArray("voters-vote", () => {
  const parsed = JSON.parse(open(VOTERS_FILE));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("VOTERS_FILE must contain a non-empty JSON array.");
  }
  return parsed;
});

export const options = {
  scenarios: {
    cast_vote: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 100),
      iterations: Number(__ENV.ITERATIONS || voters.length),
      maxDuration: __ENV.MAX_DURATION || "10m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1200"],
    checks: ["rate>0.98"],
  },
};

function voterForIteration() {
  return voters[__ITER % voters.length];
}

function decodeCookie(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

export default function () {
  const voter = voterForIteration();
  const jar = http.cookieJar();

  const csrfRes = http.get(`${BASE_URL}/sanctum/csrf-cookie`, {
    headers: { Accept: "application/json" },
    tags: { endpoint: "csrf_cookie" },
  });

  check(csrfRes, {
    "csrf cookie request ok": (r) => r.status >= 200 && r.status < 400,
  });

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
    { headers, tags: { endpoint: "login_voter" } }
  );

  const loginOk = check(loginRes, {
    "login status is 200": (r) => r.status === 200,
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
    { headers, tags: { endpoint: "cast_vote" } }
  );

  check(voteRes, {
    "vote status is 201/409": (r) => r.status === 201 || r.status === 409,
    "vote has no server error": (r) => r.status < 500,
  });
}
