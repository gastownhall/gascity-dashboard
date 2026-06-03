import type {
  ListBodySessionResponse,
  OutputTurn,
  SessionResponse,
  SessionTranscriptGetResponse,
} from '../generated/gc-supervisor-client/types.gen';
import { getActiveCity } from '../api/cityBase';
import { supervisorApi } from './client';

export type SupervisorSession = SessionResponse;
export type SupervisorSessionList = ListBodySessionResponse;

export type SessionTranscriptView = SessionTranscriptGetResponse & {
  turns: OutputTurn[];
  total_chars: number;
  captured_at: string;
  truncated: boolean;
};

export async function listSupervisorSessions(): Promise<SupervisorSessionList> {
  return supervisorApi().listSessions(activeCityOrThrow('list supervisor sessions'));
}

export async function fetchSupervisorSessionTranscript(
  sessionId: string,
): Promise<SessionTranscriptView> {
  const transcript = await supervisorApi().sessionTranscript(
    activeCityOrThrow('fetch supervisor session transcript'),
    sessionId,
  );
  return sessionTranscriptView(transcript);
}

export function sessionTranscriptView(
  transcript: SessionTranscriptGetResponse,
  capturedAt: string = new Date().toISOString(),
): SessionTranscriptView {
  const turns = transcript.turns ?? [];
  return {
    ...transcript,
    turns,
    total_chars: turns.reduce((sum, turn) => sum + turn.text.length, 0),
    captured_at: capturedAt,
    truncated: false,
  };
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}
