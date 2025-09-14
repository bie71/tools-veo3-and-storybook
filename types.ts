export interface Character {
  id: string;
  name: string;
  characterStyle: string;
  race: string;
  customRace: string;
  gender: string;
  age: string;
  outfit: string;
  hairstyle: string;
  voice: string;
  description: string;
}

export interface Dialogue {
  id:string;
  characterId: string;
  text: string;
}

export interface Environment {
  description: string;
  lighting: string;
  cameraAngle: string;
  shootingStyle: string;
  otherOptions: string;
}

export interface PromptData {
  characters: Character[];
  dialogues: Dialogue[];
  environment: Environment;
}

export interface StoryPage {
  text: string;
  imagePrompt: string;
  imageUrl?: string;
}

export interface StoryPlotPoint {
  id: string;
  text: string;
}

export interface StoryCharacter {
  name: string;
  species: string;
  customSpecies: string;
  appearance: string;
  personality: string;
  customPersonality: string;
  goal: string;
}

export interface StoryPromptData {
  idea: string;
  ageGroup: string;
  artStyle: string;
  moral: string;
  character: StoryCharacter;
  setting: {
    location: string;
    atmosphere: string;
  };
  plotPoints: StoryPlotPoint[];
}