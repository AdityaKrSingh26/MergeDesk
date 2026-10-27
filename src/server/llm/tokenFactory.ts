import OpenAI from "openai";

export const DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

export function createTokenFactoryClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.NEBIUS_API_KEY,
    baseURL: process.env.NEBIUS_BASE_URL || DEFAULT_NEBIUS_BASE_URL,
  });
}
