export const POSITION_STATUSES = [
  'PENDING_ENTRY',
  'OPEN',
  'PENDING_EXIT',
  'CLOSED',
  'EMERGENCY_EXITED',
  'CANCELLED',
] as const;

export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const POSITION_ACTIONS = [
  'WAIT',
  'ENTER',
  'HOLD',
  'REVIEW_7D',
  'REVIEW_14D',
  'EXIT',
  'EMERGENCY_EXIT',
] as const;

export type PositionAction = (typeof POSITION_ACTIONS)[number];
export type PositionMode = 'PAPER' | 'LIVE';

const ALLOWED_TRANSITIONS: Record<PositionStatus, readonly PositionStatus[]> = {
  PENDING_ENTRY: ['OPEN', 'CANCELLED'],
  OPEN: ['PENDING_EXIT', 'CANCELLED'],
  PENDING_EXIT: ['OPEN', 'CLOSED', 'EMERGENCY_EXITED', 'CANCELLED'],
  CLOSED: [],
  EMERGENCY_EXITED: [],
  CANCELLED: [],
};

export function canTransitionPosition(from: PositionStatus, to: PositionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertPositionTransition(from: PositionStatus, to: PositionStatus): void {
  if (!canTransitionPosition(from, to)) {
    throw new Error(`Invalid position transition: ${from} -> ${to}`);
  }
}

export function isTerminalPositionStatus(status: PositionStatus): boolean {
  return status === 'CLOSED' || status === 'EMERGENCY_EXITED' || status === 'CANCELLED';
}

export function positionAgeHours(openedAt: string | null, now = new Date()): number | null {
  if (!openedAt) return null;
  const opened = new Date(openedAt).getTime();
  if (!Number.isFinite(opened)) throw new Error('Position openedAt is invalid');
  return Math.max(0, (now.getTime() - opened) / (60 * 60 * 1_000));
}

export function scheduledPositionReview(
  openedAt: string | null,
  hasReview7d: boolean,
  hasReview14d: boolean,
  now = new Date()
): 'REVIEW_7D' | 'REVIEW_14D' | null {
  const age = positionAgeHours(openedAt, now);
  if (age === null) return null;
  if (age >= 14 * 24 && !hasReview14d) return 'REVIEW_14D';
  if (age >= 7 * 24 && !hasReview7d) return 'REVIEW_7D';
  return null;
}
