import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error('Missing OPENAI_API_KEY environment variable');
}

export const openai = new OpenAI({ apiKey });
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';