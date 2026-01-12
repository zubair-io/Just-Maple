import axios from 'axios';
import * as zlib from 'node:zlib';
import csv from 'csvtojson';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { BlobServiceClient } from '@azure/storage-blob';

const anthropic = new Anthropic({
    apiKey: config.claudeApiKey,
});

interface Lego {
    set: string;
    title: string;
    year: string;
    theme: string;
    parts: string;
    image: string;
}

// Lego themes array (same as AutumnBlaze)
export const LegoThemes = [
    { id: 1, name: 'Technic', parent_id: null },
    { id: 3, name: 'Competition', parent_id: 1 },
    { id: 4, name: 'Expert Builder', parent_id: 1 },
    { id: 16, name: 'RoboRiders', parent_id: 1 },
    { id: 17, name: 'Speed Slammers', parent_id: 1 },
    { id: 18, name: 'Star Wars', parent_id: 1 },
    { id: 19, name: 'Supplemental', parent_id: 1 },
    { id: 20, name: 'Throwbot Slizer', parent_id: 1 },
    { id: 21, name: 'Universal Building Set', parent_id: 1 },
    { id: 22, name: 'Creator', parent_id: null },
    { id: 34, name: 'Make & Create', parent_id: null },
    { id: 35, name: 'Bricks & More', parent_id: 34 },
    { id: 50, name: 'Town', parent_id: null },
    { id: 51, name: 'Arctic', parent_id: 50 },
    { id: 52, name: 'City', parent_id: null },
    // ... (truncated for brevity - full array would be here)
    // Include all LegoThemes from AutumnBlaze
];

async function fetchViaBrightData(url: string): Promise<string> {
    const proxyResponse = await axios.post(
        'https://api.brightdata.com/request?async=false',
        {
            zone: 'web_unlocker1',
            url: url,
            format: 'raw',
            method: 'GET',
            country: 'US',
        },
        {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${config.brightDataApiKey}`,
            },
        },
    );
    return proxyResponse.data;
}

async function enhanceDescriptionWithClaude(
    rawDescription: string,
    setNumber: string,
): Promise<any> {
    if (!rawDescription || !config.claudeApiKey) {
        return null;
    }

    try {
        console.log(`[Lego Service] Enhancing description with Claude for set ${setNumber}`);
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: `${legoDescriptionPrompt}\n\n${rawDescription}`,
                },
            ],
        });

        const textContent = message.content.find((block) => block.type === 'text');
        if (textContent && textContent.type === 'text') {
            return textToProseMirror(textContent.text);
        }
    } catch (claudeError: any) {
        console.error(
            `[Lego Service] Failed to enhance description with Claude for set ${setNumber}:`,
            claudeError.message,
        );
        return textToProseMirror(rawDescription);
    }

    return textToProseMirror(rawDescription);
}

const legoDescriptionPrompt = `Parse the following content from a LEGO product page and extract key information
to write a natural, engaging product description. The input may be a full HTML
page, HTML snippet, or plain text.

EXTRACT:
- Product name and set number
- Age range and piece count
- Price and availability
- Key features and scenes depicted
- Minifigures included (with names/variants if available)
- Special offers or gifts with purchase
- Customer ratings (if present)
- Thematic elements and story connections
- Dimensions or scale (if mentioned)

WRITE A DESCRIPTION THAT:
- Sounds like it was written by an enthusiastic LEGO fan or collector
- Captures the nostalgia and excitement of the theme
- Mentions specific scenes or moments that can be recreated
- Highlights unique or special elements (exclusive minifigures, detailed builds, rare pieces, etc.)
- Uses natural, conversational language without obvious AI patterns
- Includes practical details (piece count, age recommendation, price) woven naturally into the narrative
- Mentions any special promotions or limited-time offers
- Conveys why this set would appeal to fans of the source material
- Balances technical building details with emotional/nostalgic appeal

AVOID:
- Overly promotional or marketing language
- Repetitive phrases or obvious AI patterns (e.g., "delve into," "it's worth noting," "elevate your collection")
- Generic descriptions that could apply to any LEGO set
- Bullet points or lists (write in flowing paragraphs)
- Corporate speak or overly formal tone
- Claiming features or details not present in the source material

TONE: Write as if you're recommending this set to a friend who loves both LEGO
and the source material. Be genuine, specific, and passionate without being
hyperbolic.
`;

function textToProseMirror(text: string): any {
    // Simple ProseMirror conversion - splits into paragraphs
    const paragraphs = text
        .split(/\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    const content = paragraphs.map((paragraph) => ({
        type: 'paragraph',
        content: [
            {
                type: 'text',
                text: paragraph,
            },
        ],
    }));

    return {
        type: 'doc',
        content,
    };
}

async function uploadToHornbeam(filename: string, data: any): Promise<string> {
    if (!config.hornbeamConnectionString) {
        console.warn('[Lego Service] Hornbeam connection string not configured, skipping upload');
        return '';
    }

    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(
            config.hornbeamConnectionString,
        );
        const containerClient = blobServiceClient.getContainerClient('data');

        // Ensure container exists
        await containerClient.createIfNotExists({ access: 'blob' });

        const blockBlobClient = containerClient.getBlockBlobClient(filename);
        const content = JSON.stringify(data);

        await blockBlobClient.upload(content, content.length, {
            blobHTTPHeaders: {
                blobContentType: 'application/json',
            },
        });

        console.log(`[Lego Service] Uploaded ${filename} to Hornbeam`);
        return `${config.hornbeamBlobUrl}/${filename}`;
    } catch (error: any) {
        console.error('[Lego Service] Failed to upload to Hornbeam:', error.message);
        throw error;
    }
}

async function downloadLego(legoJsonName: string): Promise<{ body: Lego[] }> {
    const url = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';
    console.log('[Lego Service] Downloading Rebrickable CSV...');

    const response = await axios.get(url, { responseType: 'stream' });
    const gunzip = zlib.createGunzip();
    response.data.pipe(gunzip);

    let buffer = Buffer.alloc(0);
    const file: string = await new Promise((resolve, reject) => {
        gunzip.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
        });

        gunzip.on('end', () => {
            resolve(buffer.toString());
        });

        gunzip.on('error', reject);
    });

    const body = (await csv({
        noheader: false,
        headers: ['set', 'title', 'year', 'theme', 'parts', 'image'],
    }).fromString(file)) as Lego[];

    // Upload to Hornbeam for caching
    try {
        await uploadToHornbeam(legoJsonName, body);
    } catch (error) {
        console.error('[Lego Service] Failed to cache to Hornbeam, continuing anyway');
    }

    return { body };
}

export async function getLegos(): Promise<Lego[]> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const epoch = today.getTime();
    const legoJsonName = `lego-${epoch}.json`;

    try {
        // Try to fetch from Hornbeam cache first
        const response = await axios.get(`${config.hornbeamBlobUrl}/${legoJsonName}`);
        console.log('[Lego Service] Fetched from Hornbeam cache');
        return response.data;
    } catch (e) {
        // Cache miss - download fresh data
        console.log('[Lego Service] Cache miss, downloading fresh data');
        const { body } = await downloadLego(legoJsonName);
        return body;
    }
}

export async function fetchBricksetData(
    setNumber: string,
): Promise<{ upc?: string; ean?: string; description?: any }> {
    if (!config.brightDataApiKey) {
        console.warn('[Lego Service] BrightData API key not configured, skipping enrichment');
        return {};
    }

    try {
        console.log(
            `[Lego Service] Fetching Brick Economy page for set ${setNumber} via Bright Data`,
        );

        const html = await fetchViaBrightData(`https://www.brickeconomy.com/set/${setNumber}/`);

        const result: { upc?: string; ean?: string; description?: any } = {};

        // Extract UPC and EAN
        const upcMatch = html.match(/>UPC<\/div>\s*<div[^>]*>(\d+)<\/div>/);
        const eanMatch = html.match(/>EAN<\/div>\s*<div[^>]*>(\d+)<\/div>/);

        if (upcMatch && upcMatch[1]) {
            result.upc = upcMatch[1];
        }

        if (eanMatch && eanMatch[1]) {
            result.ean = eanMatch[1];
        }

        if (!result.upc && !result.ean) {
            console.warn(`[Lego Service] No UPC or EAN found for set ${setNumber}`);
            return {};
        }

        // Try to get description from LEGO.com first
        let description: any = null;

        try {
            const legoSetNumber = setNumber.replace(/-1$/, '');
            console.log(`[Lego Service] Fetching LEGO.com description for set ${legoSetNumber}`);

            const legoHtml = await fetchViaBrightData(
                `https://www.lego.com/en-us/product/${legoSetNumber}`,
            );

            const regex = /"featuresText":"((?:[^"\\]|\\.)*)"/;
            const match = legoHtml.match(regex);
            const legoDescription = match ? match[1] : null;

            if (legoDescription) {
                console.log(`[Lego Service] Found LEGO.com description for set ${setNumber}`);
                description = await enhanceDescriptionWithClaude(
                    `Text:\n${legoDescription}`,
                    setNumber,
                );
            }
        } catch (legoError) {
            console.log(
                `[Lego Service] Failed to fetch LEGO.com description for set ${setNumber}, will try Brick Economy fallback`,
            );
        }

        // Fallback to Brick Economy if LEGO.com failed
        if (!description) {
            const contentRegex = /<div id="setdescription_content">([\s\S]*?)<\/div>/;
            const descMatch = html.match(contentRegex);

            if (descMatch && descMatch[1]) {
                let descriptionHtml = descMatch[1] + '</div>';

                descriptionHtml = descriptionHtml.replace(
                    /<button[^>]*class="setdescription-close[^>]*>[\s\S]*?<\/button>/g,
                    '',
                );

                descriptionHtml = descriptionHtml.replace(
                    /<div class="mt-10 text-light text-small">[\s\S]*?<\/div>/g,
                    '',
                );

                descriptionHtml = descriptionHtml.trim();

                if (descriptionHtml) {
                    console.log(
                        `[Lego Service] Found Brick Economy description for set ${setNumber}`,
                    );
                    description = await enhanceDescriptionWithClaude(
                        `HTML:\n${descriptionHtml}`,
                        setNumber,
                    );
                }
            }
        }

        if (description) {
            result.description = description;
        }

        return result;
    } catch (error: any) {
        // Re-throw 429 errors to stop batch processing
        if (error.response?.status === 429 || error.statusCode === 429) {
            const rateLimitError: any = new Error('Rate limited');
            rateLimitError.statusCode = 429;
            throw rateLimitError;
        }

        console.error(
            `[Lego Service] Failed to fetch Brick Economy data for set ${setNumber}:`,
            error.message,
        );
        return {};
    }
}
