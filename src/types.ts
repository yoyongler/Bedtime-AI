export type Screen = 'home' | 'mind-dump' | 'exercise' | 'complete';

export type ExerciseType = '4-7-8' | 'physiological-sigh' | 'mind-dump';

export interface ExercisePhase {
  name: string;
  label: string;
  instruction: string;
  durationSeconds: number;
  action: 'expand' | 'hold' | 'contract';
  scale: number;
  opacity: number;
}

export interface ExerciseConfig {
  id: ExerciseType;
  title: string;
  durationLabel: string;
  defaultDurationSeconds: number;
  focus: string;
  techniqueOrigin: string;
  phases: ExercisePhase[];
}
