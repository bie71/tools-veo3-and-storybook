import React, { useState, useEffect, useCallback } from 'react';
import { PromptData, Character, Dialogue, Environment } from './types';
import { RACES, GENDERS, VOICES, LIGHTING_STYLES, CAMERA_ANGLES, SHOOTING_STYLES, CHARACTER_STYLES } from './constants';
import InputGroup from './components/InputGroup';
import OutputBlock from './components/OutputBlock';
import { PlusIcon, TrashIcon, SunIcon, MoonIcon } from './components/icons';
import VideoGenerator from './components/VideoGenerator';
import ImageGenerator from './components/ImageGenerator';
import StorybookBuilder from './components/StorybookBuilder';
import StorybookPromptGenerator from './components/StorybookPromptGenerator';
import { trackEvent, trackPageView } from './analytics';

type Tab = 'prompt' | 'image' | 'video' | 'storybook' | 'storybook_prompt';
type Theme = 'light' | 'dark';

// Function to determine the initial theme to prevent flash of incorrect theme
const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'dark'; // Default for server-side or non-browser environments
  }
  const storedTheme = localStorage.getItem('theme') as Theme;
  if (storedTheme) {
    return storedTheme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; // follow system default
};

// Preset choices for Video Prompt Gen with Custom fallback via renderSelect
const OUTFITS = [
  'Casual (t-shirt and jeans)',
  'Formal suit',
  'Business casual',
  'Leather jacket and jeans',
  'Hoodie and sneakers',
  'Traditional attire',
  'Streetwear',
  'Athleisure',
  'Armor',
  'Sci-fi suit',
  'Fantasy robes',
] as const;

const HAIRSTYLES = [
  'Short',
  'Medium',
  'Long',
  'Curly',
  'Wavy',
  'Straight',
  'Ponytail',
  'Bun',
  'Braids',
  'Mohawk',
  'Undercut',
  'Bald',
] as const;

const AGES = [
  '8','12','16','18','20','22','25','28','30','35','40','45','50','60'
] as const;

const OTHER_VEO_OPTIONS = [
  'hyper-realistic',
  'cinematic',
  '8k',
  'HDR',
  'anamorphic',
  'slow motion',
  'shallow depth of field',
  'volumetric lighting',
  'handheld camera',
  'steadycam',
  'bokeh',
  'high contrast',
] as const;


const TabButton: React.FC<{ title: string; active: boolean; onClick: () => void; }> = ({ title, active, onClick }) => (
    <button
        onClick={onClick}
        aria-selected={active}
        role="tab"
        className={`px-4 py-2 text-sm font-medium transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-900 rounded-t-md
            ${active
                ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-300 bg-white/30 dark:bg-gray-800'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
            }`
        }
    >
        {title}
    </button>
);


const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Tab>('prompt');
    const [apiKey, setApiKey] = useState<string>('');
    const [apiKeyInput, setApiKeyInput] = useState<string>('');
    const [apiKeyFeedback, setApiKeyFeedback] = useState<string>('');
    const [theme, setTheme] = useState<Theme>(getInitialTheme);

    // This effect syncs the classList on the root <html> element and localStorage with the theme state.
    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prevTheme => {
            const newTheme = prevTheme === 'light' ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme); // Store the new theme
            return newTheme;
        });
    };

    // Optional: hint to install React DevTools when explicitly enabled
    useEffect(() => {
        if ((import.meta as any).env?.VITE_SHOW_DEVTOOLS === '1') {
            // eslint-disable-next-line no-console
            console.info('Download the React DevTools for a better development experience: https://react.dev/link/react-devtools');
        }
    }, []);

    useEffect(() => {
        const storedApiKey = localStorage.getItem('gemini_api_key');
        if (storedApiKey) {
            setApiKey(storedApiKey);
            setApiKeyInput(storedApiKey);
        }
    }, []);

    // CountAPI removed: GA-only analytics

    // Initialize Google Analytics (GA4) if Measurement ID is provided
    useEffect(() => {
        const GA_ID = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID as string | undefined;
        if (!GA_ID) return; // skip if not configured
        // Inject gtag script
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
        document.head.appendChild(script);
        const inline = document.createElement('script');
        inline.innerHTML = `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${GA_ID}', { send_page_view: false });`;
        document.head.appendChild(inline);
        return () => {
            // optional cleanup: keep GA loaded across SPA lifetime
        };
    }, []);

    // Send page_view to GA on tab changes
    useEffect(() => {
        const GA_ID = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID as string | undefined;
        if (!GA_ID) return;
        const titleMap: Record<Tab, string> = {
            prompt: 'Prompt',
            image: 'Image',
            video: 'Video',
            storybook: 'Storybook',
            storybook_prompt: 'Storybook Prompt',
        };
        const page_path = `/${activeTab}`;
        const page_title = `VEO App — ${titleMap[activeTab]}`;
        trackPageView(page_path, page_title, activeTab);
    }, [activeTab]);


    const handleSaveApiKey = () => {
        if (!apiKeyInput.trim()) {
            setApiKeyFeedback('API Key cannot be empty.');
            setTimeout(() => setApiKeyFeedback(''), 3000);
            return;
        }
        setApiKey(apiKeyInput);
        localStorage.setItem('gemini_api_key', apiKeyInput);
        setApiKeyFeedback('API Key saved successfully!');
        try { trackEvent('api_key_save'); } catch {}
        setTimeout(() => setApiKeyFeedback(''), 3000);
    };

    const handleClearApiKey = () => {
        setApiKey('');
        setApiKeyInput('');
        localStorage.removeItem('gemini_api_key');
        setApiKeyFeedback('API Key cleared.');
        try { trackEvent('api_key_clear'); } catch {}
        setTimeout(() => setApiKeyFeedback(''), 3000);
    };


    const [promptData, setPromptData] = useState<PromptData>({
        characters: [],
        dialogues: [],
        environment: {
            description: '',
            lighting: LIGHTING_STYLES[0],
            cameraAngle: CAMERA_ANGLES[0],
            shootingStyle: SHOOTING_STYLES[0],
            otherOptions: '',
        }
    });

    const [generatedPrompts, setGeneratedPrompts] = useState({
        indonesian: '',
        english: '',
        json: ''
    });
    
    // --- State Handlers ---

    const addCharacter = () => {
        const newCharacter: Character = {
            id: crypto.randomUUID(),
            name: '',
            characterStyle: CHARACTER_STYLES[0],
            race: RACES[0],
            customRace: '',
            gender: GENDERS[0],
            age: '25',
            outfit: '',
            hairstyle: '',
            voice: VOICES[0],
            description: ''
        };
        setPromptData(prev => ({ ...prev, characters: [...prev.characters, newCharacter] }));
    };

    const updateCharacter = (id: string, field: keyof Character, value: string) => {
        setPromptData(prev => ({
            ...prev,
            characters: prev.characters.map(char =>
                char.id === id ? { ...char, [field]: value } : char
            )
        }));
    };

    const deleteCharacter = (id: string) => {
        setPromptData(prev => ({
            ...prev,
            characters: prev.characters.filter(char => char.id !== id),
            dialogues: prev.dialogues.filter(dialogue => dialogue.characterId !== id)
        }));
    };

    const addDialogue = () => {
        if (promptData.characters.length === 0) {
            alert("Please add a character first.");
            return;
        }
        const newDialogue: Dialogue = {
            id: crypto.randomUUID(),
            characterId: promptData.characters[0].id,
            text: ''
        };
        setPromptData(prev => ({ ...prev, dialogues: [...prev.dialogues, newDialogue] }));
    };

    const updateDialogue = (id: string, field: keyof Dialogue, value: string) => {
        setPromptData(prev => ({
            ...prev,
            dialogues: prev.dialogues.map(d => d.id === id ? { ...d, [field]: value } : d)
        }));
    };

    const deleteDialogue = (id: string) => {
        setPromptData(prev => ({
            ...prev,
            dialogues: prev.dialogues.filter(d => d.id !== id)
        }));
    };

    const updateEnvironment = (field: keyof Environment, value: string) => {
        setPromptData(prev => ({
            ...prev,
            environment: { ...prev.environment, [field]: value }
        }));
    };

    // --- Prompt Generation ---
    const generatePrompts = useCallback((data: PromptData) => {
        const getCharIdentifier = (char: Character | undefined) => {
            if (!char) return 'Unknown Character';
            return char.name || `Character ${data.characters.findIndex(c => c.id === char.id) + 1}`;
        };
        const getCharIdentifierIndo = (char: Character | undefined) => {
             if (!char) return 'Karakter Tidak Dikenal';
             return char.name || `Karakter ${data.characters.findIndex(c => c.id === char.id) + 1}`;
        };

        // English Prompt
        let englishPrompt = `Scene: ${data.environment.description}.\n\n`;
        data.characters.forEach((char, index) => {
            const race = char.race === 'Other (Custom)' ? char.customRace : char.race;
            englishPrompt += `Character ${index + 1} (${char.name || 'Unnamed'}) is a ${char.age}-year-old ${race} ${char.gender}, rendered in a ${char.characterStyle} style. They are wearing ${char.outfit} with ${char.hairstyle} hair. Their voice is ${char.voice}. Action: ${char.description}.\n`;
        });
        if (data.dialogues.length > 0) {
            englishPrompt += "\nDialogue:\n";
            data.dialogues.forEach(d => {
                const speaker = data.characters.find(c => c.id === d.characterId);
                englishPrompt += `${getCharIdentifier(speaker)}: "${d.text}"\n`;
            });
        }
        englishPrompt += `\nShot details: Lighting is ${data.environment.lighting}. Camera angle is ${data.environment.cameraAngle}. Shooting style is ${data.environment.shootingStyle}.`;
        if (data.environment.otherOptions) englishPrompt += ` Additional notes: ${data.environment.otherOptions}.`;

        // Indonesian Prompt
        let indonesianPrompt = `Adegan: ${data.environment.description}.\n\n`;
        data.characters.forEach((char, index) => {
            let genderIndo = char.gender === 'Male' ? 'pria' : (char.gender === 'Female' ? 'wanita' : char.gender);
            const race = char.race === 'Other (Custom)' ? char.customRace : char.race;
            indonesianPrompt += `Karakter ${index + 1} (${char.name || 'Tanpa Nama'}) adalah seorang ${genderIndo} ras ${race} berusia ${char.age} tahun dengan gaya ${char.characterStyle}. Ia mengenakan ${char.outfit} dengan gaya rambut ${char.hairstyle}. Suaranya ${char.voice}. Aksi: ${char.description}.\n`;
        });
        if (data.dialogues.length > 0) {
            indonesianPrompt += "\nDialog:\n";
            data.dialogues.forEach(d => {
                const speaker = data.characters.find(c => c.id === d.characterId);
                indonesianPrompt += `${getCharIdentifierIndo(speaker)}: "${d.text}"\n`;
            });
        }
        indonesianPrompt += `\nDetail pengambilan gambar: Pencahayaan ${data.environment.lighting}. Sudut kamera ${data.environment.cameraAngle}. Gaya pengambilan gambar ${data.environment.shootingStyle}.`;
        if (data.environment.otherOptions) indonesianPrompt += ` Catatan tambahan: ${data.environment.otherOptions}.`;

        // JSON Prompt
        const jsonPrompt = JSON.stringify(data, null, 2);

        setGeneratedPrompts({
            indonesian: indonesianPrompt.trim(),
            english: englishPrompt.trim(),
            json: jsonPrompt
        });
    }, []);

    useEffect(() => {
        generatePrompts(promptData);
    }, [promptData, generatePrompts]);

    // Debounced analytics for prompt generation on the 'prompt' tab
    useEffect(() => {
        const t = window.setTimeout(() => {
            try {
                trackEvent('generate_video_prompt', {
                    characters: promptData.characters.length,
                    dialogues: promptData.dialogues.length,
                    has_other_options: !!promptData.environment.otherOptions,
                    lighting: promptData.environment.lighting,
                    camera_angle: promptData.environment.cameraAngle,
                    shooting_style: promptData.environment.shootingStyle,
                });
            } catch {}
        }, 800);
        return () => window.clearTimeout(t);
    }, [promptData.characters.length, promptData.dialogues.length, promptData.environment.otherOptions, promptData.environment.lighting, promptData.environment.cameraAngle, promptData.environment.shootingStyle]);

    const renderInput = (label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void, type = 'text', placeholder = '') => (
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
            {type === 'textarea' ?
                <textarea value={value} onChange={onChange} placeholder={placeholder} className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500" rows={2}/> :
                <input type={type} value={value} onChange={onChange} placeholder={placeholder} className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500" />
            }
        </div>
    );
    
    const renderSelect = <T extends string,>(label: string, value: T, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, options: readonly T[]) => {
        const isCustom = !options.includes(value);
        const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value as T | '__custom__';
            if (v === '__custom__') {
                // Switch to custom mode: clear current value to trigger input
                (onChange as any)({ target: { value: '' } });
                return;
            }
            onChange(e);
        };
        return (
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                <select
                    value={isCustom ? ('__custom__' as any) : value}
                    onChange={handleSelectChange}
                    className="appearance-none w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                    {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    <option value="__custom__">Custom…</option>
                </select>
                {isCustom && (
                    <input
                        type="text"
                        value={value as string}
                        onChange={(e) => (onChange as any)({ target: { value: e.target.value } })}
                        placeholder={`Custom ${label}`}
                        className="mt-2 w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-sans bg-gradient-to-br from-gray-100 to-indigo-100 dark:from-gray-900 dark:via-gray-900 dark:to-indigo-900/50 transition-colors duration-300">
            {/* Toast for API key feedback */}
            {apiKeyFeedback && (
              <div className="fixed top-4 right-4 z-50" role="status" aria-live="polite">
                <div className={`${(apiKeyFeedback.includes('cleared') || apiKeyFeedback.includes('empty')) ? 'bg-yellow-600' : 'bg-emerald-600'} text-white px-4 py-2 rounded shadow-lg`}>{apiKeyFeedback}</div>
              </div>
            )}
            <header className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm sticky top-0 z-10">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
                   <div className="flex flex-wrap justify-between items-center gap-4">
                        <div>
                             <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">VEO Prompt & Video Generator</h1>
                            <p className="text-indigo-600 dark:text-indigo-400 mt-1">Craft prompts, generate videos, or build illustrated stories.</p>
                        </div>
                        <div className="flex items-center gap-4">
                             <div className="flex-grow max-w-md">
                                <label htmlFor="api-key-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Gemini API Key
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        id="api-key-input"
                                        type="password"
                                        value={apiKeyInput}
                                        onChange={(e) => setApiKeyInput(e.target.value)}
                                        placeholder="Enter your Gemini API Key"
                                        className="flex-grow w-full bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                    <button onClick={handleSaveApiKey} className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm font-semibold">Save</button>
                                    <button onClick={handleClearApiKey} className="px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors text-sm font-semibold">Clear</button>
                                </div>
                                {/* Inline feedback replaced by toast */}
                            </div>
                            <button onClick={toggleTheme} className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors mt-6" aria-label="Toggle theme">
                                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                            </button>
                            <a
                              href={'https://saweria.co/bie7'}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm font-semibold"
                              title="Dukung server via Saweria"
                              onClick={() => { try { trackEvent('donate_click', { provider: 'saweria' }); } catch {} }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M11.645 20.91l-.007-.003-.022-.01a15.247 15.247 0 01-.383-.173 25.18 25.18 0 01-4.244-2.566C4.688 16.281 2.25 13.557 2.25 10.125 2.25 6.753 4.903 4.5 8 4.5c1.676 0 3.153.652 4.145 1.67C13.318 5.152 14.795 4.5 16.47 4.5c3.098 0 5.78 2.258 5.78 5.625 0 3.432-2.438 6.156-4.739 7.996a25.175 25.175 0 01-4.244 2.566 15.247 15.247 0 01-.383.173l-.022.01-.007.003a.75.75 0 01-.61 0z" /></svg>
                              Donate Saweria
                            </a>
                            {/* Total visits moved to bottom sticky */}
                            {(import.meta as any).env?.VITE_SHOW_DEVTOOLS === '1' && (
                                <a
                                    href="https://react.dev/link/react-devtools"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-6 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    React DevTools
                                </a>
                            )}
                        </div>
                   </div>
                     <nav className="mt-4 border-b border-gray-300 dark:border-gray-700">
                        <div className="flex space-x-2" role="tablist" aria-label="App Navigation">
                            <TabButton title="Video Prompt Gen" active={activeTab === 'prompt'} onClick={() => setActiveTab('prompt')} />
                            <TabButton title="Image Generator" active={activeTab === 'image'} onClick={() => setActiveTab('image')} />
                            <TabButton title="Video Generator" active={activeTab === 'video'} onClick={() => setActiveTab('video')} />
                            <TabButton title="Storybook Prompt Gen" active={activeTab === 'storybook_prompt'} onClick={() => setActiveTab('storybook_prompt')} />
                            <TabButton title="Storybook Builder" active={activeTab === 'storybook'} onClick={() => setActiveTab('storybook')} />
                        </div>
                    </nav>
                </div>
            </header>
            <main className="container mx-auto p-4 sm:p-6 lg:p-8">
                {activeTab === 'prompt' && (
                     <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* INPUTS COLUMN */}
                        <div className="overflow-y-auto" style={{maxHeight: 'calc(100vh - 120px)'}}>
                             <InputGroup title="Characters" actionButton={
                                <button onClick={addCharacter} className="flex items-center text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 transition-colors"><PlusIcon/> <span className="ml-2">Add Character</span></button>
                             }>
                                {promptData.characters.map((char, index) => (
                                    <div key={char.id} className="bg-gray-50/50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-300 dark:border-gray-700 space-y-4">
                                        <div className="flex justify-between items-center">
                                            <h3 className="font-semibold text-lg text-indigo-600 dark:text-indigo-400">Character {index + 1}</h3>
                                            <button onClick={() => deleteCharacter(char.id)} className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 p-1 rounded-full bg-red-500/10 hover:bg-red-500/20"><TrashIcon/></button>
                                        </div>
                                        {renderInput('Name', char.name, e => updateCharacter(char.id, 'name', e.target.value), 'text', 'e.g., John Doe')}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                {renderSelect('Race/Ethnicity', char.race, e => updateCharacter(char.id, 'race', e.target.value), RACES)}
                                                {char.race === 'Other (Custom)' && renderInput('Custom Race', char.customRace, e => updateCharacter(char.id, 'customRace', e.target.value), 'text', 'e.g., Elf, Cyborg')}
                                            </div>
                                            {renderSelect('Character Style', char.characterStyle, e => updateCharacter(char.id, 'characterStyle', e.target.value), CHARACTER_STYLES)}
                                            {renderSelect('Gender', char.gender, e => updateCharacter(char.id, 'gender', e.target.value), GENDERS)}
                                            {renderSelect('Age', char.age, e => updateCharacter(char.id, 'age', e.target.value), AGES)}
                                            {renderSelect('Outfit', char.outfit, e => updateCharacter(char.id, 'outfit', e.target.value), OUTFITS)}
                                            {renderSelect('Hairstyle', char.hairstyle, e => updateCharacter(char.id, 'hairstyle', e.target.value), HAIRSTYLES)}
                                            {renderSelect('Voice', char.voice, e => updateCharacter(char.id, 'voice', e.target.value), VOICES)}
                                        </div>
                                        {renderInput('Description / Action', char.description, e => updateCharacter(char.id, 'description', e.target.value), 'textarea', 'e.g., Pacing anxiously, looking at a watch')}
                                    </div>
                                ))}
                             </InputGroup>

                             <InputGroup title="Dialogues" actionButton={
                                <button onClick={addDialogue} className="flex items-center text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 transition-colors"><PlusIcon/> <span className="ml-2">Add Dialogue</span></button>
                             }>
                                 {promptData.dialogues.map((dialogue, index) => (
                                     <div key={dialogue.id} className="bg-gray-50/50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-300 dark:border-gray-700 space-y-3">
                                         <div className="flex justify-between items-center">
                                             <h3 className="font-semibold text-md text-indigo-600 dark:text-indigo-400">Dialogue Line {index + 1}</h3>
                                             <button onClick={() => deleteDialogue(dialogue.id)} className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 p-1 rounded-full bg-red-500/10 hover:bg-red-500/20"><TrashIcon/></button>
                                         </div>
                                         <select value={dialogue.characterId} onChange={e => updateDialogue(dialogue.id, 'characterId', e.target.value)} className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500">
                                             {promptData.characters.map((c, i) => <option key={c.id} value={c.id}>
                                                 {c.name ? `${c.name} (Character ${i+1})` : `Character ${i + 1}`}
                                                 </option>)}
                                         </select>
                                         {renderInput('Conversation Text', dialogue.text, e => updateDialogue(dialogue.id, 'text', e.target.value), 'textarea', 'e.g., "We need to go, now!"')}
                                     </div>
                                 ))}
                             </InputGroup>
                             
                             <InputGroup title="Environment & Camera">
                                 {renderInput('Environment Description', promptData.environment.description, e => updateEnvironment('description', e.target.value), 'textarea', 'e.g., A neon-lit alleyway at night, rain is falling')}
                                 {renderSelect('Lighting', promptData.environment.lighting, e => updateEnvironment('lighting', e.target.value), LIGHTING_STYLES)}
                                 {renderSelect('Camera Angle', promptData.environment.cameraAngle, e => updateEnvironment('cameraAngle', e.target.value), CAMERA_ANGLES)}
                                 {renderSelect('Shooting Style', promptData.environment.shootingStyle, e => updateEnvironment('shootingStyle', e.target.value), SHOOTING_STYLES)}
                                 {renderSelect('Other VEO3 Options', promptData.environment.otherOptions, e => updateEnvironment('otherOptions', e.target.value), OTHER_VEO_OPTIONS)}
                             </InputGroup>
                        </div>

                        {/* OUTPUTS COLUMN */}
                        <div className="flex flex-col gap-8 sticky top-[150px] h-fit">
                             <div className="h-[250px]"><OutputBlock title="Indonesian Prompt" content={generatedPrompts.indonesian} /></div>
                             <div className="h-[250px]"><OutputBlock title="English Prompt" content={generatedPrompts.english} /></div>
                             <div className="h-[250px]"><OutputBlock title="JSON Prompt" content={generatedPrompts.json} language="json"/></div>
                        </div>
                    </div>
                )}
                {/* Keep Image and Video tabs mounted to preserve state across tab switches */}
                <div className={activeTab === 'image' ? '' : 'hidden'} aria-hidden={activeTab !== 'image'}>
                    <ImageGenerator apiKey={apiKey} />
                </div>
                <div className={activeTab === 'video' ? '' : 'hidden'} aria-hidden={activeTab !== 'video'}>
                    <VideoGenerator apiKey={apiKey} />
                </div>
                {activeTab === 'storybook_prompt' && <StorybookPromptGenerator />}
                {activeTab === 'storybook' && <StorybookBuilder apiKey={apiKey} />}
            </main>
            {/* CountAPI UI removed: GA-only analytics */}
        </div>
    );
};

export default App;
