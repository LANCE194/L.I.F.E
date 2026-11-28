/**
 * L.I.F.E. TypeScript Types
 * Shared types between client and server
 */

// User & Auth
export interface User {
  user_id: number;
  username: string;
  role: 'admin' | 'trainer' | 'trainee';
  /** Linked trainee profile (trainee accounts only). */
  trainee_id?: number | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ChangePasswordResponse {
  message: string;
  token: string;
  user: User;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// Trainee
export interface Trainee {
  trainee_id: number;
  full_name: string;
  organization: string | null;
  notes: string | null;
  consent_given: boolean;
  is_active: boolean;
  date_registered: string;
  /** Sign-in account for the trainee, if one was created. */
  account?: TraineeAccount | null;
}

export interface TraineeAccount {
  username: string;
  is_active: boolean;
  must_change_password: boolean;
}

/** Returned once when an account is created or its password is reset. */
export interface TraineeCredentials {
  username: string;
  temporary_password: string;
}

export interface TraineeCreateRequest {
  full_name: string;
  organization?: string;
  notes?: string;
  consent_given?: boolean;
  /** Admin only: also create the trainee's sign-in account. */
  create_account?: boolean;
  username?: string;
}

export interface MyProgressResponse {
  trainee: { trainee_id: number; full_name: string; organization: string | null; date_registered: string; consent_given: boolean; is_active: boolean };
  stats: TraineeStats;
  progress: TraineeProgressPoint[];
  sessions: Session[];
  pass_mark_pct: number;
  /** Place on the overall leaderboard (all sessions), or null before the first session. */
  ranking: { rank: number; total_ranked: number; avg_accuracy: number } | null;
}

export interface TraineeUpdateRequest {
  full_name?: string;
  organization?: string | null;
  notes?: string | null;
  consent_given?: boolean;
  is_active?: boolean;
}

export interface TraineeListResponse {
  trainees: Trainee[];
}

export interface TraineeWithSessions extends Trainee {
  sessions?: Session[];
}

// Session
export interface SessionCounts {
  correct: number;
  incorrect: number;
  total: number;
  /** Compressions where the elbow could not be seen (not scored as locked or unlocked). */
  unscorable?: number;
  /** Average processed frames per second during the session. */
  fps?: number;
  /** Average pose-inference time per frame in milliseconds. */
  latency_ms?: number;
  /** 1 when the session used hands-only CPR, 0 for cycles with breaths. */
  hands_only?: number;
  /** 30 (30:2) or 15 (15:2: child or infant with two rescuers). */
  compressions_per_cycle?: number;
  /** Number of rescuers selected (1 or 2). */
  rescuers?: number;
  /** 0 adult, 1 child, 2 infant. */
  victim_type?: number;
  /** 30:2 cycles completed with a breath pause. */
  breath_cycles?: number;
  /** Cycles where compressions continued past 30 without the breath pause. */
  skipped_breaths?: number;
  /** AED shocks recorded during the session. */
  aed_shocks?: number;
  /** Interruptions longer than 10 seconds before compressions resumed. */
  long_pauses?: number;
  /** Share of applicable CPR procedure items followed (0-100). */
  procedure_pct?: number;
  /** 1 when the trainee recorded the session on their own account (set by the server). */
  self_practice?: number;
  /** Share of compressions (with a hand reading) where the hands were stacked. */
  hands_stacked_pct?: number;
}

export interface ProcedureSteps {
  scene_safe: boolean;
  response_checked: boolean;
  emergency_services_called: boolean;
  breathing_checked: boolean;
  cpr_started: boolean;
  cpr_continued: boolean;
  aed_used: boolean;
}

export interface Session {
  session_id: number;
  trainee_id: number;
  date_time: string;
  duration_sec: number;
  total_compressions: number;
  avg_bpm: number;
  elbow_lock_pct: number;
  accuracy_pct: number;
  counts: SessionCounts;
  procedure_steps?: ProcedureSteps;
  result: 'Pass' | 'Needs Improvement';
  trainee_name?: string;
  organization?: string;
}

export interface SessionDetail {
  detail_id: number;
  session_id: number;
  ts: number;
  bpm: number | null;
  elbow_angle: number | null;
  elbow_locked: boolean;
}

export interface SessionCreateRequest {
  client_session_id?: string;
  trainee_id: number;
  duration_sec: number;
  total_compressions: number;
  avg_bpm: number;
  elbow_lock_pct: number;
  accuracy_pct: number;
  counts: SessionCounts;
  procedure_steps?: ProcedureSteps;
  details?: SessionDetailCreateRequest[];
}

export interface SessionDetailCreateRequest {
  ts: number;
  bpm?: number | null;
  elbow_angle?: number | null;
  elbow_locked?: boolean;
}

export interface SessionListResponse {
  sessions: Session[];
  total?: number;
}

export interface SessionCreateResponse {
  session: Session;
  duplicate?: boolean;
}

export interface SessionWithDetails extends Session {
  details: (SessionDetail | SessionDetailCreateRequest)[];
}

export interface SessionFilters {
  trainee_id?: number;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

// Live Status
export type LiveStatusValue = 'Waiting' | 'Ready' | 'In Progress' | 'Completed';

export interface LiveStatus {
  id: number;
  trainee_id: number | null;
  status: LiveStatusValue;
  accuracy_pct: number;
  bpm: number;
  elbow_lock_pct: number;
  compressions: number;
  elapsed_sec: number;
  updated_at: string;
  trainee_name?: string | null;
}

export interface LiveStatusUpdateRequest {
  trainee_id?: number | null;
  status?: LiveStatusValue;
  accuracy_pct?: number;
  bpm?: number;
  elbow_lock_pct?: number;
  compressions?: number;
  elapsed_sec?: number;
}

// Leaderboard
/** Which sessions rankings and statistics count: every session, trainer-supervised, or self-practice. */
export type SessionScope = 'all' | 'supervised' | 'self';

export interface LeaderboardEntry {
  trainee_id: number;
  full_name: string;
  organization: string | null;
  total_sessions: number;
  self_practice_sessions: number;
  passed_sessions: number;
  pass_rate: number;
  total_compressions: number;
  avg_accuracy: number;
  best_accuracy: number;
  avg_bpm: number;
  last_session: string;
  rank: number;
  /** True on the signed-in trainee's own row. */
  is_me?: boolean;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  top3: LeaderboardEntry[];
  total_ranked: number;
  scope: SessionScope;
  /** Trainee accounts: their own entry, even when outside the list shown. */
  me: LeaderboardEntry | null;
}

export interface ServerBackup {
  name: string;
  bytes: number;
  modified_at: string;
  kind: 'automatic' | 'manual' | 'safety copy';
}

export interface OrganizationStats {
  organization: string;
  trainee_count: number;
  session_count: number;
  avg_accuracy: number;
}

// Stats
export interface DashboardStats {
  trainee_count: number;
  sessions_today: number;
  avg_accuracy: number;
  avg_bpm: number;
  total_sessions: number;
  self_practice_sessions: number;
  total_compressions: number;
  pass_rate: number;
}

export interface TopTrainee {
  trainee_id: number;
  full_name: string;
  organization: string | null;
  avg_accuracy: number;
  best_accuracy: number;
  session_count: number;
  self_practice_sessions?: number;
  rank?: number;
}

export interface AccuracyTrendPoint {
  date: string;
  avg_accuracy: number;
  session_count: number;
}

export interface DashboardResponse {
  scope: SessionScope;
  stats: DashboardStats;
  top5: TopTrainee[];
  recent_sessions: Session[];
  accuracy_trend: AccuracyTrendPoint[];
}

export interface TraineeStats {
  total_sessions: number;
  total_compressions: number;
  avg_accuracy: number;
  best_accuracy: number;
  avg_bpm: number;
  avg_duration: number;
  pass_rate: number;
}

export interface TraineeProgressPoint {
  session_number: number;
  date: string;
  accuracy: number;
  bpm: number;
  compressions: number;
  result: 'Pass' | 'Needs Improvement';
}

export interface TraineeStatsResponse {
  trainee: Trainee;
  stats: TraineeStats;
  progress: TraineeProgressPoint[];
}

// Settings
export interface Settings {
  angle_threshold: number;
  smoothing_window: number;
  min_peak_distance_ms: number;
  peak_prominence: number;
  bpm_min: number;
  bpm_max: number;
  session_duration_sec: number;
  pass_mark_pct: number;
  camera_width: number;
  camera_height: number;
  camera_framerate: number;
  visibility_threshold: number;
  bpm_window_intervals: number;
  metronome_bpm: number;
}

export interface SettingsUpdateRequest {
  angle_threshold?: number;
  smoothing_window?: number;
  min_peak_distance_ms?: number;
  peak_prominence?: number;
  bpm_min?: number;
  bpm_max?: number;
  session_duration_sec?: number;
  pass_mark_pct?: number;
  camera_width?: number;
  camera_height?: number;
  camera_framerate?: number;
  visibility_threshold?: number;
  bpm_window_intervals?: number;
  metronome_bpm?: number;
}

// Health
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  service: string;
  version: string;
  database: 'connected' | 'disconnected';
  error?: string;
}

// API Error
export interface ApiError {
  error: string;
}

// Vision Types
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseLandmarks {
  landmarks: Landmark[];
  timestamp: number;
}

export interface TrackedPose {
  personId: number;
  landmarks: Landmark[];
  centerX: number;
  centerY: number;
  visibility: number;
}

export interface ElbowAngleResult {
  angle: number | null;
  locked: boolean;
  smoothedAngle: number | null;
}

export interface CadenceResult {
  bpm: number | null;
  classification: 'Slow' | 'In Range' | 'Fast';
  peakTimestamps: number[];
}

export interface ScoringResult {
  isCorrect: boolean;
  elbowLocked: boolean;
  bpm: number | null;
  classification: 'Slow' | 'In Range' | 'Fast';
}

export interface SessionMetrics {
  totalCompressions: number;
  correctCompressions: number;
  unscorableCompressions: number;
  accuracyPct: number;
  avgBpm: number | null;
  /** Cadence from the most recent compressions (what the trainee is doing right now). */
  currentBpm: number | null;
  elbowLockPct: number;
  elapsedSec: number;
}

// Camera
export interface CameraDevice {
  deviceId: string;
  label: string;
  kind: 'videoinput';
}

export interface CameraConfig {
  width: number;
  height: number;
  frameRate: number;
  facingMode?: 'user' | 'environment';
}

