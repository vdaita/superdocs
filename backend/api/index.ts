// @ts-nocheck

import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { distance, closest } from 'fastest-levenshtein';
import { jwtVerify } from 'jose';
import { getFixedSearchReplace } from '../utils/diff';
import { AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT, PLAN_PROMPT, PLAN_PROMPT_BULLET_POINTS } from '../utils/prompts';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

// @ts-ignore
// import process from 'process';

// @ts-ignore
import { Transform, TransformCallback } from 'stream'; 

console.log("Hello via Node!");

export const config = {
    runtime: 'edge'
};

const together = new OpenAI({
    baseURL: "https://api.together.xyz/",
    apiKey: process.env.TOGETHER_API_KEY
});

const groq = new Groq(
    {
        apiKey: process.env.GROQ_API_KEY
    }
)
const openai = new OpenAI();
const googleGenAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

const geminiFlash = googleGenAI.getGenerativeModel({model: 'gemini-1.5-flash-latest', generationConfig: {
    "responseMimeType": "application/json"
}});

type EditInstruction = {
    instruction: string
    // filepath: string
    changesCompleted: boolean
    changeUpdate?: string
    changes?: Change[]
}

type Change = {
    filepath: string
    searchBlock: string
    replaceBlock: string
}

type NewFile = {
    filepath: string,
    code: string
}

type Snippet = {
    filepath: string
    code: string
    language: string
  }

type Update = {
    executionIndex: number,
    newEditInstruction: EditInstruction
}

// type Update = {
//     section: "plan" | "change"
//     planId: number
//     instructionId?: number
//     type: "update" | "completion"
//     content: string | Plan | Change
// }

const planSchema = z.object({
    message: z.string().describe("An markdown-formatted change to the user for general purposes (summarizing, general messages, explanation, etc.)"),
    editInstructions: z.array(z.string()).describe("A list of instructions that will be executed in parallel that should edit files.")
});

const CORS_HEADERS = {
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
    },
};

function parseBulletPointPlan(input: string) {
    // Split the input by newline characters
    const lines = input.split('\n');
    
    // Initialize variables for top message and submessages
    let topMessage = '';
    const subMessages: string[] = [];
    
    // Flag to identify if top message has been set
    let topMessageSet = false;
    
    // Iterate over each line
    lines.forEach(line => {
        if (line.startsWith('- ')) {
            // If the line starts with a hyphen, add it to submessages with bullet point
            subMessages.push('• ' + line.substring(2));
        } else {
            // If top message is not yet set, set it to the current line
            if (!topMessageSet) {
                topMessage = line;
                topMessageSet = true;
            } else {
                // If top message is already set, append the line to it with a space
                topMessage += ' ' + line;
            }
        }
    });

    return {
        topMessage,
        subMessages
    };
}

const POST = async (req: VercelRequest) => {
    // console.log("Full request: ", req);

    const url = new URL(req.url!);
    console.log("Received request to: ", req.url);

    if (req.method === "OPTIONS"){
        console.log("Options request received");
        const res = new Response('Departed', CORS_HEADERS);
        return res;
    }
    // console.log("Request body: ", req.body);
    const reqJson = await req.json();
    let snippets: Snippet[] = reqJson["snippets"];
    let filepaths: string[] = [];
    snippets.forEach((snippet) => { filepaths.push(snippet.filepath); });

    let textEncoder = new TextEncoder();
    
    let unifiedSnippets: Snippet[] = [];
    let files = new Map();
    filepaths.forEach((filepath) => {
        let codeChunks: string[] = [];
        let lang: string = "";            
        snippets.forEach((snippet) => {
            if(snippet.filepath === filepath) {
                codeChunks.push(snippet.code);
                lang = snippet.language;
            }
        });
        unifiedSnippets.push({
            filepath: filepath,
            code: codeChunks.join("\n----\n"),
            language: lang
        });
        files.set(filepath, codeChunks.join("\n----\n"));
    });

    let fileContextStr = "";
    unifiedSnippets.forEach((snippet) => {
        fileContextStr += `[${snippet.filepath}]\n \`\`\`\n${snippet.code}\n\`\`\`\n`
    });

    try {
        // console.log("Tries validating: ", reqJson);

        const user = await jwtVerify(
            reqJson["session"]["access_token"],
            new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
        );
        // console.log("User verified: ", user);
        // Either user is verified or this fails.
    } catch (e) {
        console.error("Token validation failed: ", e);
        throw "Token validation failed."; // Error out completely
    }

    const stream = new ReadableStream({
        async start(controller) {
            let textEncoder = new TextEncoder();
            
            let response = await openai.chat.completions.create({
                messages: [{
                    role: "system",
                    content: AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT
                }, {
                    role: "user",
                    content: `# File context:\n${fileContextStr}\n# Instruction\n${reqJson['request']}`
                }],
                model: "gpt-4o",
                stream: true
            });

            let responseText = "";

            for await(const chunk of response){
                responseText += chunk.choices[0]?.delta?.content || "";
                // console.log("Added and sent chunk");
                let encodedPlan = JSON.stringify({
                    type: "plan",
                    index: 0,
                    plan: {
                        message: responseText,
                        changes: []
                    }
                }) + "<SDSEP>";
                controller.enqueue(textEncoder.encode(encodedPlan));
            }

            let fixedSearchReplaces = getFixedSearchReplace(files, responseText);
            let changes: Change[] = [];
            fixedSearchReplaces.forEach((fsr) => {
                if(fsr.searchBlock.trim().length > 0 && fsr.replaceBlock.trim().length > 0){ // empty SRs are leaking
                    changes?.push({
                        filepath: fsr.filepath,
                        searchBlock: fsr.searchBlock,
                        replaceBlock: fsr.replaceBlock
                    });
                }
            });

            console.log("Sent final search-replacements");
            let encodedPlan = JSON.stringify({
                type: "plan", 
                index: 0,
                plan: {
                    message: responseText,
                    changes: changes
                }
            }) + "<SDSEP>";
            controller.enqueue(textEncoder.encode(encodedPlan));
            controller.close();
        }
    });

    return new Response(stream, CORS_HEADERS);
}

export default POST;