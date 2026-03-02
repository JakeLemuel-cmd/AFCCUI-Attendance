# Load Testing Guide (k6)

This folder contains k6 scripts to stress:
- QR attendance check-in (`/api/attendance-access/check-in`)
- voter login + vote submission (`/api/login` + `/api/vote`)
- mixed traffic (both at the same time)

## 1) Install k6

Windows (winget):

```powershell
winget install k6.k6
```

Or use the official k6 installer for your OS.

## 2) Prepare test data

Create `loadtest/voters.json`:

```json
[
  {
    "voter_id": "voter-0001",
    "voter_key": "1234",
    "election_id": 3,
    "votes": [
      { "position_id": 1, "candidate_id": 10 },
      { "position_id": 2, "candidate_id": 21 }
    ]
  }
]
```

Notes:
- Use many unique voters (hundreds/thousands) for realistic concurrency.
- `votes` must match valid candidates for the selected `election_id`.
- Voters must be `present` in attendance for vote tests.

## 3) Run tests

From repo root.

QR check-in load:

```powershell
k6 run -e BASE_URL=http://localhost:8000 -e VOTERS_FILE=./loadtest/voters.json -e RATE=80 -e DURATION=2m -e PRE_VUS=120 -e MAX_VUS=800 ./loadtest/checkin.js
```

Vote load (login + submit vote):

```powershell
k6 run -e BASE_URL=http://localhost:8000 -e VOTERS_FILE=./loadtest/voters.json -e VUS=150 -e ITERATIONS=1500 -e MAX_DURATION=10m ./loadtest/vote.js
```

Mixed traffic (check-in + vote together):

```powershell
k6 run -e BASE_URL=http://localhost:8000 -e VOTERS_FILE=./loadtest/voters.json -e CHECKIN_RATE=60 -e CHECKIN_DURATION=3m -e CHECKIN_PRE_VUS=120 -e CHECKIN_MAX_VUS=800 -e VOTE_VUS=120 -e VOTE_ITERATIONS=1200 -e VOTE_MAX_DURATION=10m ./loadtest/mixed.js
```

## 4) Pass criteria (suggested starting point)

- `http_req_failed` < 1%
- `p(95) http_req_duration`:
  - check-in: < 800ms
  - vote: < 1200ms
- low/no 5xx responses

## 5) Important cautions

- Run on staging first, not production.
- Current `throttle:login` settings can return `429` when identifiers repeat too often.
- For clean vote success rates, keep `ITERATIONS` <= unique voters who have not yet voted.
