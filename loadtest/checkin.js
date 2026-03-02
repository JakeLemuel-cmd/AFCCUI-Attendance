import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const API_BASE = `${BASE_URL}/api`;
const VOTERS_FILE = __ENV.VOTERS_FILE || "./loadtest/voters.json";

const voters = new SharedArray("voters-checkin", () => {
  const parsed = JSON.parse(open(VOTERS_FILE));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("VOTERS_FILE must contain a non-empty JSON array.");
  }
  return parsed;
});

export const options = {
  scenarios: {
    qr_checkin: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 50),
      timeUnit: "1s",
      duration: __ENV.DURATION || "2m",
      preAllocatedVUs: Number(__ENV.PRE_VUS || 100),
      maxVUs: Number(__ENV.MAX_VUS || 600),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    checks: ["rate>0.99"],
  },
};

function pickVoter() {
  return voters[Math.floor(Math.random() * voters.length)];
}

export default function () {
  const voter = pickVoter();
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
    tags: { endpoint: "attendance_checkin" },
  });

  check(res, {
    "check-in status is 200/201/409": (r) => r.status === 200 || r.status === 201 || r.status === 409,
    "check-in has no server error": (r) => r.status < 500,
  });
}
