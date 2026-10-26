// Shared raw DevOps URL discovery, used before output projection and by renderer link chips. Parsing stays at display.
export const DEVOPS_URL_PATTERN = /https?:\/\/(?:dev\.azure\.com\/[A-Za-z0-9_.-]+|[A-Za-z0-9-]+\.visualstudio\.com)\/[^\s"'<>()[\]{}`\\|]*/gi;
export const devopsUrls = (text: string): string[] => [...new Set([...text.matchAll(DEVOPS_URL_PATTERN)].map(match => match[0]))];
