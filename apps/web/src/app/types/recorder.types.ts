export type RecorderOperation =
  | 'state'
  | 'refresh'
  | 'prepareModels'
  | 'start'
  | 'stop'
  | 'process'
  | 'summarize'
  | 'clean'
  | 'runPrompt'
  | 'ask'
  | 'edit'
  | 'delete'
  | 'play'
  | 'pause'
  | 'seek'
  | 'rate'
  | 'export'
  | 'screenshot'
  | 'savePrompt'
  | 'deletePrompt'
  | 'deleteResult'
  | 'settings'
  | 'calendarAccess'
  | 'dismissError'
  | 'liveNotes'
  | 'liveAssist'
  | 'autoAssist';
export type RecorderProvider = 'none' | 'apple_foundation_models' | 'claude' | 'openai';
export interface RecorderRequest {
  requestId: string;
  operation: RecorderOperation;
  recordingId?: string;
  includeSystemAudio?: boolean;
  flag?: boolean;
  field?: 'title' | 'summary' | 'notes' | 'userNotes' | 'tags' | 'speaker' | 'segment';
  value?: string;
  number?: number;
  speakerId?: string;
  segmentIndex?: number;
  promptId?: string;
  name?: string;
  body?: string;
  context?: string;
  provider?: RecorderProvider;
  tags?: string[];
  settings?: Partial<RecorderSettings> & { claudeKey?: string; openAIKey?: string };
}
export interface RecorderSettings {
  provider: RecorderProvider;
  chunkMinutes: number;
  calendarEnabled: boolean;
  calendarTitleMode: 'off' | 'hint' | 'exactName';
  calendarIds: string[];
  assistPrompt: string;
  shareScreenshots: boolean;
  hasClaudeKey: boolean;
  hasOpenAIKey: boolean;
}
export interface RecorderSummary {
  id: string;
  title: string;
  duration: number;
  createdAt: string;
  tags: string[];
  hasTranscript: boolean;
  hasSystemAudio: boolean;
}
export interface RecorderSegment {
  speaker_id: string;
  start: number;
  end: number;
  text: string;
  words: { word: string; start: number; end: number }[];
}
export interface RecorderPrompt {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
}
export interface RecorderDetail {
  id: string;
  title: string;
  summary: string;
  notes: string;
  user_notes: string;
  duration: number;
  created_at: string;
  modified_at: string;
  audio: string[];
  system_audio: string[];
  speakers: { id: string; display_name: string; color: string }[];
  transcript: RecorderSegment[];
  tags: string[];
  prompt_results: {
    id: string;
    prompt_name: string;
    prompt_body: string;
    result: string;
    llm_provider: string;
    created_at: string;
  }[];
  screenshots: { id: string; file_name: string; timestamp: number }[];
}
export interface RecorderState {
  recordings: RecorderSummary[];
  selected: RecorderDetail | null;
  assist?: {
    notes: string;
    busy: boolean;
    response: string;
    error: string | null;
    automatic: boolean;
  };
  isRecording: boolean;
  elapsed: number;
  audioLevel: number;
  warning: string | null;
  busy: boolean;
  jobId: string | null;
  status: string;
  error: string | null;
  modelsReady: boolean;
  modelProgress: number;
  systemAudioSupported: boolean;
  playback: {
    recordingId: string | null;
    playing: boolean;
    time: number;
    duration: number;
    rate: number;
  };
  settings: RecorderSettings;
  prompts: RecorderPrompt[];
  providers: { id: RecorderProvider; name: string; available: boolean }[];
  calendars: { id: string; title: string; source: string }[];
}
export interface RecorderResponse {
  requestId: string;
  state?: RecorderState;
  error?: string;
  exported?: string;
  exportHandled?: boolean;
  image?: string;
}
