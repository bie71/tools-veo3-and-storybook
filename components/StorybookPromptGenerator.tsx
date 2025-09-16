import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StoryPromptData, StoryPlotPoint } from '../types';
import { STORYBOOK_AGES, STORYBOOK_ART_STYLES, STORYBOOK_CHARACTER_SPECIES, STORYBOOK_CHARACTER_PERSONALITIES, STORYBOOK_LOCATIONS, STORYBOOK_ATMOSPHERES } from '../constants';
import InputGroup from './InputGroup';
import OutputBlock from './OutputBlock';
import { PlusIcon, TrashIcon, QuillIcon } from './icons';
import { trackEvent } from '../analytics';

const StorybookPromptGenerator: React.FC = () => {
    const [promptData, setPromptData] = useState<StoryPromptData>({
        idea: '',
        ageGroup: STORYBOOK_AGES[0],
        artStyle: STORYBOOK_ART_STYLES[0],
        moral: '',
        character: { 
            name: '', 
            species: STORYBOOK_CHARACTER_SPECIES[0], 
            customSpecies: '',
            appearance: '', 
            personality: STORYBOOK_CHARACTER_PERSONALITIES[0], 
            customPersonality: '',
            goal: '' 
        },
        setting: { 
            location: STORYBOOK_LOCATIONS[0], 
            atmosphere: STORYBOOK_ATMOSPHERES[0] 
        },
        plotPoints: []
    });
    const [generatedPrompts, setGeneratedPrompts] = useState({
        english: '',
        indonesian: ''
    });
    const debounceRef = useRef<number | undefined>(undefined);

    const updateField = (section: keyof StoryPromptData, field: string, value: string) => {
        setPromptData(prev => ({
            ...prev,
            [section]: {
                // @ts-ignore
                ...prev[section],
                [field]: value
            }
        }));
    };
    
    const updateRootField = (field: keyof StoryPromptData, value: string) => {
        setPromptData(prev => ({ ...prev, [field]: value }));
    }

    const addPlotPoint = () => {
        const newPoint: StoryPlotPoint = { id: crypto.randomUUID(), text: '' };
        setPromptData(prev => ({ ...prev, plotPoints: [...prev.plotPoints, newPoint] }));
    };

    const updatePlotPoint = (id: string, text: string) => {
        setPromptData(prev => ({
            ...prev,
            plotPoints: prev.plotPoints.map(p => p.id === id ? { ...p, text } : p)
        }));
    };

    const deletePlotPoint = (id: string) => {
        setPromptData(prev => ({
            ...prev,
            plotPoints: prev.plotPoints.filter(p => p.id !== id)
        }));
    };

    const generatePrompt = useCallback(() => {
        const { idea, ageGroup, artStyle, moral, character, setting, plotPoints } = promptData;
        
        const species = character.species === 'Other (Custom)' ? character.customSpecies : character.species;
        const personality = character.personality === 'Other (Custom)' ? character.customPersonality : character.personality;
        const location = setting.location === 'Other (Custom)' ? (promptData.setting as any).customLocation : setting.location;
        const atmosphere = setting.atmosphere === 'Other (Custom)' ? (promptData.setting as any).customAtmosphere : setting.atmosphere;
        
        // English prompt
        let promptEn = `Create a children's storybook for ${ageGroup} in a ${artStyle} art style.`;
        if (moral) {
            promptEn += ` The story should teach a lesson about ${moral}.`;
        }
        promptEn += `\n\n**Story Idea:**\n${idea || 'A central theme or concept for the story.'}`;

        promptEn += `\n\n**Main Character:**`;
        promptEn += `\n- Name: ${character.name || 'Not specified'}`;
        promptEn += `\n- Species/Type: ${species || 'Not specified'}`;
        promptEn += `\n- Appearance: ${character.appearance || 'Not specified'}`;
        promptEn += `\n- Personality: ${personality || 'Not specified'}`;
        promptEn += `\n- Goal/Desire: ${character.goal || 'Not specified'}`;

        promptEn += `\n\n**Setting:**`;
        promptEn += `\n- Location: ${location || 'Not specified'}`;
        promptEn += `\n- Atmosphere: ${atmosphere || 'Not specified'}`;

        if (plotPoints.length > 0) {
            promptEn += `\n\n**Plot Outline:**`;
            plotPoints.forEach((p, i) => {
                if (p.text) promptEn += `\n${i + 1}. ${p.text}`;
            });
        }

        promptEn += `\n\nPlease generate the story text broken down into multiple pages, and for each page, provide a detailed illustration prompt that matches the text and the overall art style.`;

        // Indonesian prompt
        let promptId = `Buat buku cerita anak untuk ${ageGroup} dengan gaya seni ${artStyle}.`;
        if (moral) {
            promptId += ` Cerita harus menyampaikan pelajaran tentang ${moral}.`;
        }
        promptId += `\n\n**Ide Cerita:**\n${idea || 'Tema atau gagasan utama cerita.'}`;

        promptId += `\n\n**Tokoh Utama:**`;
        promptId += `\n- Nama: ${character.name || 'Tidak disebutkan'}`;
        promptId += `\n- Spesies/Tipe: ${species || 'Tidak disebutkan'}`;
        promptId += `\n- Penampilan: ${character.appearance || 'Tidak disebutkan'}`;
        promptId += `\n- Kepribadian: ${personality || 'Tidak disebutkan'}`;
        promptId += `\n- Tujuan/Keinginan: ${character.goal || 'Tidak disebutkan'}`;

        promptId += `\n\n**Latar:**`;
        promptId += `\n- Lokasi: ${location || 'Tidak disebutkan'}`;
        promptId += `\n- Suasana: ${atmosphere || 'Tidak disebutkan'}`;

        if (plotPoints.length > 0) {
            promptId += `\n\n**Alur Cerita:**`;
            plotPoints.forEach((p, i) => {
                if (p.text) promptId += `\n${i + 1}. ${p.text}`;
            });
        }

        promptId += `\n\nMohon hasilkan teks cerita yang dibagi menjadi beberapa halaman, dan untuk setiap halaman, berikan prompt ilustrasi yang detail yang sesuai dengan teks dan gaya seni keseluruhan.`;

        setGeneratedPrompts({ english: promptEn, indonesian: promptId });
    }, [promptData]);

    useEffect(() => {
        generatePrompt();
    }, [promptData, generatePrompt]);

    // Debounced tracking to avoid spamming GA on every keystroke
    useEffect(() => {
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
            try {
                if (generatedPrompts.english || generatedPrompts.indonesian) {
                    trackEvent('generate_story_prompt', {
                        age_group: promptData.ageGroup,
                        art_style: promptData.artStyle,
                        moral_present: !!promptData.moral,
                        plot_points: promptData.plotPoints.length,
                    });
                }
            } catch {}
        }, 800);
        return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    }, [generatedPrompts, promptData.ageGroup, promptData.artStyle, promptData.moral, promptData.plotPoints.length]);

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
        const onSel = (e: React.ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value as T | '__custom__';
            if (v === '__custom__') return (onChange as any)({ target: { value: '' } });
            onChange(e);
        };
        return (
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                <select value={isCustom ? ('__custom__' as any) : value} onChange={onSel} className="appearance-none w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500">
                    {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    <option value="__custom__">Custom…</option>
                </select>
                {isCustom && (
                    <input
                        type="text"
                        value={value as string}
                        onChange={(e) => (onChange as any)({ target: { value: e.target.value } })}
                        placeholder={`Custom `}
                        className="mt-2 w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                )}
            </div>
        );
    };
    
    return (
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* INPUTS COLUMN */}
            <div>
                <InputGroup title="Core Concept">
                    {renderInput('Story Idea', promptData.idea, e => updateRootField('idea', e.target.value), 'textarea', 'e.g., A shy firefly who is afraid of the dark')}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderSelect('Target Age Group', promptData.ageGroup, e => updateRootField('ageGroup', e.target.value), STORYBOOK_AGES)}
                        {renderSelect('Art Style', promptData.artStyle, e => updateRootField('artStyle', e.target.value), STORYBOOK_ART_STYLES)}
                    </div>
                    {renderInput('Moral or Lesson (Optional)', promptData.moral, e => updateRootField('moral', e.target.value), 'text', 'e.g., The importance of being brave')}
                </InputGroup>

                <InputGroup title="Main Character">
                     {renderInput('Name', promptData.character.name, e => updateField('character', 'name', e.target.value), 'text', 'e.g., Flicker')}
                     
                     {renderSelect('Species/Type', promptData.character.species, e => {
                         const val = e.target.value;
                         updateField('character', 'species', val);
                         if (val !== 'Other (Custom)') updateField('character', 'customSpecies', '');
                     }, STORYBOOK_CHARACTER_SPECIES)}
                     {promptData.character.species === 'Other (Custom)' && renderInput('Custom Species', promptData.character.customSpecies, e => updateField('character', 'customSpecies', e.target.value), 'text', 'e.g., Glimmering Nymph')}
                     
                     {renderInput('Appearance', promptData.character.appearance, e => updateField('character', 'appearance', e.target.value), 'textarea', 'e.g., Small, with big curious eyes and a soft yellow glow')}
                     
                     {renderSelect('Personality', promptData.character.personality, e => {
                         const val = e.target.value;
                         updateField('character', 'personality', val);
                         if (val !== 'Other (Custom)') updateField('character', 'customPersonality', '');
                     }, STORYBOOK_CHARACTER_PERSONALITIES)}
                     {promptData.character.personality === 'Other (Custom)' && renderInput('Custom Personality', promptData.character.customPersonality, e => updateField('character', 'customPersonality', e.target.value), 'text', 'e.g., Cautiously optimistic')}

                     {renderInput('Goal or Desire', promptData.character.goal, e => updateField('character', 'goal', e.target.value), 'textarea', 'e.g., To overcome his fear and join the other fireflies')}
                </InputGroup>

                <InputGroup title="Setting">
                     {renderSelect('Primary Location', promptData.setting.location, e => updateField('setting', 'location', e.target.value), STORYBOOK_LOCATIONS)}
                     {renderSelect('Atmosphere/Mood', promptData.setting.atmosphere, e => updateField('setting', 'atmosphere', e.target.value), STORYBOOK_ATMOSPHERES)}
                </InputGroup>

                <InputGroup title="Plot Outline" actionButton={
                    <button onClick={addPlotPoint} className="flex items-center text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 transition-colors"><PlusIcon/> <span className="ml-2">Add Point</span></button>
                }>
                    {promptData.plotPoints.map((point, index) => (
                        <div key={point.id} className="flex items-center gap-2">
                           <span className="text-gray-500 dark:text-gray-400 font-semibold">{index + 1}.</span>
                           <textarea 
                                value={point.text}
                                onChange={e => updatePlotPoint(point.id, e.target.value)}
                                placeholder={`Enter plot point ${index + 1}`}
                                className="flex-grow bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                rows={1}
                           />
                           <button onClick={() => deletePlotPoint(point.id)} className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 p-1 rounded-full bg-red-500/10 hover:bg-red-500/20"><TrashIcon/></button>
                        </div>
                    ))}
                </InputGroup>
            </div>

            {/* OUTPUT COLUMN */}
            <div className="sticky top-[150px] h-fit">
                {generatedPrompts.english || generatedPrompts.indonesian ? (
                     <div className="flex flex-col gap-6">
                        <div className="h-[300px]"><OutputBlock title="Storybook Prompt (Indonesian)" content={generatedPrompts.indonesian} /></div>
                        <div className="h-[300px]"><OutputBlock title="Storybook Prompt (English)" content={generatedPrompts.english} /></div>
                    </div>
                ) : (
                     <div className="text-center text-gray-400 dark:text-gray-500 m-auto p-8 bg-white/50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-lg">
                        <QuillIcon />
                        <p className="mt-2">Your generated story prompt will appear here.</p>
                    </div>
                )}
            </div>
         </div>
    );
};

export default StorybookPromptGenerator;
