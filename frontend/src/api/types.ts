export type UserRole = "super_admin" | "election_admin" | "voter";
export type ElectionStatus = "draft" | "open" | "closed";
export type AttendanceStatus = "present" | "absent";

export interface User {
  id: number;
  name: string;
  branch: string | null;
  email: string | null;
  voter_id: string | null;
  voter_key: string | null;
  attendance_id?: number | null;
  role: UserRole;
  is_active: boolean;
  attendance_status: AttendanceStatus;
  already_voted: boolean;
  has_voted?: boolean;
  voted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Candidate {
  id: number;
  election_id: number;
  position_id: number;
  name: string;
  photo_path: string | null;
  bio: string | null;
  votes_count?: number;
}

export interface Position {
  id: number;
  election_id: number;
  title: string;
  min_votes_allowed: number;
  max_votes_allowed: number;
  sort_order: number;
  candidates: Candidate[];
  votes_count?: number;
}

export interface Election {
  id: number;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string;
  status: ElectionStatus;
  created_by: number;
  creator?: Pick<User, "id" | "name" | "email">;
  positions: Position[];
  votes_count?: number;
}

export interface Attendance {
  id: number;
  attendance_id?: number | null;
  election_id: number;
  user_id: number;
  status: AttendanceStatus;
  checked_in_at: string | null;
  source: string;
  election?: {
    id: number;
    title: string;
  };
  user?: {
    id: number;
    name: string;
    branch: string | null;
    voter_id: string | null;
    attendance_status?: AttendanceStatus;
    already_voted?: boolean;
  };
  created_at: string;
  updated_at: string;
}

export interface VoteSelection {
  position_id: number;
  candidate_id: number;
}

export interface VotePayload {
  election_id: number;
  votes: VoteSelection[];
}

export interface VoteReceipt {
  election_id: number;
  positions_voted: number;
  submitted_at: string;
  message: string;
}

export interface CandidateResult {
  id: number;
  name: string;
  photo_path: string | null;
  votes: number;
  percentage: number;
}

export interface PositionResult {
  id: number;
  title: string;
  total_votes: number;
  candidates: CandidateResult[];
}

export interface ElectionResult {
  id: number;
  title: string;
  status: ElectionStatus;
  start_datetime: string;
  end_datetime: string;
  total_votes: number;
  voters_participated: number;
  total_voters: number;
  voter_turnout_percentage: number;
  positions: PositionResult[];
}

export interface HourlyVotesPoint {
  hour: string;
  votes: number;
}

export interface DashboardOverview {
  time_range: {
    date: string;
    start: string;
    end: string;
  };
  total_votes_today: number;
  total_voters_voted_today?: number;
  total_voters: number;
  voters_participated_today: number;
  participation_percentage_today: number;
  total_positions: number;
  total_candidates: number;
  votes_per_hour: HourlyVotesPoint[];
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user?: {
    id: number;
    name: string;
    email: string;
  };
  action: string;
  description: string;
  ip_address: string | null;
  created_at: string;
}

export interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}
