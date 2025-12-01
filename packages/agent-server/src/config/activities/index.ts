import type { ActivityConfig } from '@agentic/shared';
import { triviaActivity } from './trivia.js';
import { amaActivity } from './ama.js';
import { sportsActivity } from './sports.js';
import { gamingActivity } from './games.js';
import { merchActivity } from './merch.js';

const activities: Record<string, ActivityConfig> = {
    trivia: triviaActivity,
    ama: amaActivity,
    sports: sportsActivity,
    gaming: gamingActivity,
    merch: merchActivity,
};

export function getActivityConfig(id: string): ActivityConfig | undefined {
    return activities[id];
}

export function getAllActivities(): ActivityConfig[] {
    return Object.values(activities);
}
