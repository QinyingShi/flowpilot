let recordSequence = 0;

export function createRecordToken(length = 8): string {
  recordSequence = (recordSequence + 1) % 1_679_616;
  const timePart = Date.now().toString(36);
  const sequencePart = recordSequence.toString(36).padStart(4, '0');
  return `${timePart}${sequencePart}`.slice(-length);
}

export function createRecordId(prefix: string): string {
  return `${prefix}-${createRecordToken()}`;
}

export function futureIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
